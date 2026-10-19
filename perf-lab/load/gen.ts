import { Agent, request } from 'node:http'
import { performance } from 'node:perf_hooks'
import type { Metrics } from '../../src/core/perf.ts'
import { percentile } from '../src/stats.ts'

export type Kind = 'catalog' | 'order' | 'upload' | 'download' | 'report'
/** What a visitor does, as shares of all requests. */
export const MIX: readonly (readonly [Kind, number])[] = [['catalog', 0.6], ['order', 0.2], ['upload', 0.1], ['download', 0.05], ['report', 0.05]]

/** A small seeded random number generator (mulberry32): the same seed gives the same load every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** When requests arrive, in ms from the start: a Poisson process at `rate` a second for `seconds`, so they come in the clumps real traffic does. */
export function arrivals(rate: number, seconds: number, rand: () => number): number[] {
  const out: number[] = []
  let t = 0
  for (;;) {
    t += (-Math.log(1 - rand()) / rate) * 1000
    if (t >= seconds * 1000) return out
    out.push(t)
  }
}

/** One kind of request, chosen by the shares in `mix`. */
export function pick(mix: readonly (readonly [Kind, number])[], rand: () => number): Kind {
  let r = rand()
  for (const [kind, share] of mix) {
    r -= share
    if (r < 0) return kind
  }
  return mix[mix.length - 1][0]
}

const UPLOAD = Buffer.alloc(200_000, 7)

export type LevelOptions = {
  /** Where the lab listens, e.g. http://127.0.0.1:4800. */
  base: string
  /** Requests a second to aim for. */
  rate: number
  /** Seconds at that rate before measuring starts. */
  warmup: number
  /** Seconds measured. */
  duration: number
  seed: number
  /** Called once the warm-up is over (the lab's numbers so far are thrown away), and once the measured time is over (they are kept). */
  afterWarmup: () => Promise<unknown>
  afterArrivals: () => Promise<unknown>
  /** Stops the level early: nothing more is sent, and runLevel throws. */
  signal?: AbortSignal
}

/** Requests in flight beyond this are counted as failed, so a stalled server can't run the generator out of memory. */
const MAX_IN_FLIGHT = 2000
/** After the last request is sent, how long to wait for the rest to come back. */
const DRAIN_MS = 10_000

/**
 * Hold one load level. The load is open-loop: each request is sent at its scheduled time whether or not earlier ones
 * have come back, and its time is counted from when it was scheduled, so a server that falls behind shows it. A
 * closed loop (send the next when the last returns) would slow down with the server and hide the problem.
 */
export async function runLevel(o: LevelOptions): Promise<{ overall: Metrics; afterArrivals: unknown }> {
  const rand = rng(o.seed)
  const total = o.warmup + o.duration
  const times = arrivals(o.rate, total, rand)
  const plan = times.map(() => ({ kind: pick(MIX, rand), page: 1 + Math.floor(60 * rand() ** 3), amount: 5 + Math.floor(rand() * 95) }))
  const agent = new Agent({ keepAlive: true, maxSockets: MAX_IN_FLIGHT })
  const latencies: number[] = []
  let failed = 0
  const pending = new Map<Promise<void>, { measured: boolean; scheduled: number }>()
  /** A promise whose failure is reported where it is awaited, not as an unhandled rejection in between. */
  const settled = <T>(p: Promise<T>): Promise<T> => {
    p.catch(() => {})
    return p
  }

  const send = (method: string, path: string, body?: Buffer | string): Promise<number> =>
    new Promise((resolve, reject) => {
      const req = request(new URL(path, o.base), { method, agent, timeout: DRAIN_MS }, res => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 500))
        res.on('error', reject)
        res.on('close', () => {
          if (!res.complete) reject(new Error('the response was cut off'))
        })
      })
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('timed out')))
      req.end(body)
    })

  const issue = (i: number): Promise<number> => {
    const { kind, page, amount } = plan[i]
    switch (kind) {
      case 'catalog': return send('GET', `/catalog?page=${page}`)
      case 'order': return send('POST', '/orders', JSON.stringify({ amount }))
      case 'upload': return send('POST', '/uploads', UPLOAD)
      case 'download': return send('GET', '/files/seed')
      case 'report': return send('GET', '/reports')
    }
  }

  const start = performance.now()
  let afterArrivals: Promise<unknown> | undefined
  let warmedUp: Promise<unknown> | undefined
  let next = 0
  await new Promise<void>(done => {
    const tick = () => {
      if (o.signal?.aborted) return done()
      const elapsed = performance.now() - start
      while (next < times.length && times[next] <= elapsed) {
        const i = next++
        const measured = times[i] >= o.warmup * 1000
        const scheduled = start + times[i]
        if (pending.size >= MAX_IN_FLIGHT) {
          if (measured) {
            latencies.push(performance.now() - scheduled)
            failed++
          }
          continue
        }
        const p: Promise<void> = issue(i).then(
          status => {
            if (measured) {
              latencies.push(performance.now() - scheduled)
              if (status >= 500) failed++
            }
          },
          () => {
            if (measured) {
              latencies.push(performance.now() - scheduled)
              failed++
            }
          },
        ).finally(() => pending.delete(p))
        pending.set(p, { measured, scheduled })
      }
      if (!warmedUp && elapsed >= o.warmup * 1000) warmedUp = settled(o.afterWarmup())
      if (elapsed >= total * 1000) {
        afterArrivals ??= settled(o.afterArrivals())
        if (next >= times.length) return done()
      }
      setTimeout(tick, 1)
    }
    tick()
  })
  o.signal?.throwIfAborted()
  await warmedUp
  const kept = await afterArrivals
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([Promise.allSettled([...pending.keys()]), new Promise(resolve => (timer = setTimeout(resolve, DRAIN_MS)))])
  clearTimeout(timer)
  const end = performance.now()
  for (const { measured, scheduled } of pending.values()) {
    if (!measured) continue
    latencies.push(end - scheduled) // still out after the wait: lost, and as slow as the wait
    failed++
  }
  agent.destroy()

  const sorted = latencies.sort((a, b) => a - b)
  return {
    overall: { rate: sorted.length / o.duration, p50: percentile(sorted, 50) ?? 0, p95: percentile(sorted, 95) ?? 0, errors: sorted.length === 0 ? 0 : failed / sorted.length },
    afterArrivals: kept,
  }
}
