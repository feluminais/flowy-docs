import { performance } from 'node:perf_hooks'
import type { Metrics, Pair } from '../../src/core/perf/types.ts'

/** The nearest-rank percentile (0 to 100) of numbers already sorted ascending, or undefined for none. */
export function percentile(sorted: readonly number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined
  return sorted[Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length))) - 1]
}

export type Clock = () => number

/**
 * How much of a resource was in use: the time-weighted number of things in flight, over what the resource could
 * have held. `take` reads the share since the last `take` and starts a new interval.
 */
export class Busy {
  private inFlight = 0
  private area = 0
  private last: number
  private since: number
  private now: Clock
  constructor(now: Clock = () => performance.now()) {
    this.now = now
    this.last = this.since = now()
  }
  private move(): void {
    const t = this.now()
    this.area += this.inFlight * (t - this.last)
    this.last = t
  }
  enter(): void {
    this.move()
    this.inFlight++
  }
  leave(): void {
    this.move()
    this.inFlight--
  }
  /** Share of `capacity` things held at once that was used since the last take, 0 to 1. */
  take(capacity: number): number {
    this.move()
    const span = this.last - this.since
    const share = span > 0 ? this.area / (capacity * span) : 0
    this.area = 0
    this.since = this.last
    return Math.min(1, share)
  }
}

/** Calls from one object to another: how long each took and whether it worked. */
export class Edge {
  private ms: number[] = []
  private failed = 0
  record(ms: number, ok = true): void {
    this.ms.push(ms)
    if (!ok) this.failed++
  }
  /** Time an async call; one that throws counts as failed and still throws. */
  async track<T>(fn: () => Promise<T>): Promise<T> {
    const t = performance.now()
    try {
      const result = await fn()
      this.record(performance.now() - t)
      return result
    } catch (e) {
      this.record(performance.now() - t, false)
      throw e
    }
  }
  /** What was recorded since the last take, as run-file numbers over `seconds`, or undefined when nothing was. */
  take(seconds: number): Metrics | undefined {
    if (this.ms.length === 0) return undefined
    const sorted = this.ms.sort((a, b) => a - b)
    const out = { rate: sorted.length / seconds, p50: percentile(sorted, 50)!, p95: percentile(sorted, 95)!, errors: this.failed / sorted.length }
    this.ms = []
    this.failed = 0
    return out
  }
}

/** How many of some things went wrong. */
export class Ratio {
  private n = 0
  private bad = 0
  hit(ok: boolean): void {
    this.n++
    if (!ok) this.bad++
  }
  /** The share that failed since the last take, or undefined when there was nothing. */
  take(): number | undefined {
    if (this.n === 0) return undefined
    const share = this.bad / this.n
    this.n = this.bad = 0
    return share
  }
}

/** Everything the lab measures, in the shape of one level of a run file. */
export class Stats {
  private edges = new Map<string, [string, string, Edge]>()
  private probes: [string, 'util' | 'queue' | 'errors', () => number | undefined][] = []
  private at = performance.now()

  /** The calls from `from` to `to`, made once and kept. */
  edge(from: string, to: string): Edge {
    const key = `${from}>${to}`
    let found = this.edges.get(key)
    if (!found) {
      found = [from, to, new Edge()]
      this.edges.set(key, found)
    }
    return found[2]
  }

  /** A number read off an object each time a snapshot is taken. `read` should start its own new interval. */
  probe(id: string, key: 'util' | 'queue' | 'errors', read: () => number | undefined): void {
    this.probes.push([id, key, read])
  }

  /** What was measured since the last snapshot (or the start), and a new interval begins. */
  snapshot(): { objects: Record<string, Metrics>; connections: Pair[] } {
    const t = performance.now()
    const seconds = Math.max(0.001, (t - this.at) / 1000)
    this.at = t
    const objects: Record<string, Metrics> = {}
    for (const [id, key, read] of this.probes) {
      const v = read()
      if (v !== undefined) (objects[id] ??= {})[key] = v
    }
    const connections: Pair[] = []
    for (const [from, to, edge] of this.edges.values()) {
      const m = edge.take(seconds)
      if (m) connections.push({ from, to, ...m })
    }
    return { objects, connections }
  }
}
