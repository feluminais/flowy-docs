import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { Agent, request } from 'node:http'
import { join } from 'node:path'
import type { Level, Metrics, Pair } from '../../src/core/perf.ts'
import { runLevel } from './gen.ts'

const here = import.meta.dirname

type Started = {
  port: number
  /** Rejects if the process goes while it is meant to be running. */
  died: Promise<never>
  stop: () => Promise<void>
}

/**
 * A child process that prints `{"port":N}` as its first line. Its stdin is a pipe from here: closing it is how a child is
 * told to finish, and it is also how a child learns this process is gone (however it went), so a harness that is
 * killed leaves no gateway or lab running.
 */
async function start(file: string, env: Record<string, string>): Promise<Started> {
  const child: ChildProcess = spawn(process.execPath, ['--no-warnings', join(here, '../src', file)], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  child.stdin!.on('error', () => {}) // closing a pipe to a child that is already gone is not worth a crash
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  let stopping = false
  const died = new Promise<never>((_, reject) =>
    child.once('exit', code => {
      if (!stopping) reject(new Error(`${file} stopped on its own (exit code ${code})`))
    }),
  )
  died.catch(() => {}) // nobody may be waiting on it
  const port = await new Promise<number>((resolvePort, reject) => {
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${file} did not start in 10 s`))
    }, 10_000)
    child.once('exit', code => {
      clearTimeout(timer)
      reject(new Error(`${file} stopped with exit code ${code} before it was ready`))
    })
    let text = ''
    let found = false
    child.stdout!.on('data', chunk => {
      text += String(chunk)
      if (found || !text.includes('\n')) return
      found = true
      clearTimeout(timer)
      resolvePort((JSON.parse(text.split('\n')[0]) as { port: number }).port)
    })
  })
  return {
    port,
    died,
    stop: async () => {
      stopping = true
      if (child.exitCode === null && child.signalCode === null) {
        child.stdin!.end() // asks it to close its files and go
        const force = setTimeout(() => child.kill(), 5000)
        await exited
        clearTimeout(force)
      }
    },
  }
}

/**
 * Reads `/__stats` over one kept-alive connection that is opened before the load starts, so reading it never has to wait
 * for a busy lab to accept a new connection. A read starts a new interval in the lab, so a read that fails is not tried
 * again here: it fails the level, and the level is tried again from the start.
 */
function statsClient(base: string) {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 })
  const once = () =>
    new Promise<unknown>((resolve, reject) => {
      const req = request(new URL('/__stats', base), { agent, timeout: 10_000 }, res => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', chunk => (text += chunk))
        res.on('end', () => {
          try {
            resolve(JSON.parse(text))
          } catch (e) {
            reject(e)
          }
        })
        res.on('error', reject)
        res.on('close', () => {
          if (!res.complete) reject(new Error('the reply to /__stats was cut off'))
        })
      })
      req.on('error', reject)
      req.on('timeout', () => req.destroy(new Error('the lab did not answer /__stats in 10 s')))
      req.end()
    })
  return { read: once, close: () => agent.destroy() }
}

export type Plan = { warmup: number; duration: number; gatewayDelay: number; seed: number }

/**
 * Hold one load level against a fresh gateway and lab, and read what the lab measured. `dir` is a new, empty folder for
 * the lab's files: a fresh lab for every level means no level starts with the last one's backlog, cache or rows. The caller
 * removes it, because if this process is stopped it cannot.
 */
export async function measure(load: number, dir: string, plan: Plan): Promise<Level> {
  const abort = new AbortController()
  let gateway: Started | undefined
  let lab: Started | undefined
  let stats: ReturnType<typeof statsClient> | undefined
  try {
    gateway = await start('gateway.ts', { GATEWAY_DELAY_MS: String(plan.gatewayDelay) })
    lab = await start('server.ts', { LAB_DIR: dir, GATEWAY_URL: `http://127.0.0.1:${gateway.port}` })
    const base = `http://127.0.0.1:${lab.port}`
    stats = statsClient(base)
    await stats.read() // opens the connection while the lab is idle
    const reading = stats
    const running = runLevel({
      base, rate: load, warmup: plan.warmup, duration: plan.duration, seed: plan.seed, signal: abort.signal,
      afterWarmup: () => reading.read(), // read and thrown away: this is where measuring starts
      afterArrivals: () => reading.read(),
    })
    running.catch(() => {}) // if a process dies first, this is stopped below and its complaint is not wanted
    const result = await Promise.race([running, lab.died, gateway.died])
    const kept = result.afterArrivals as { objects: Record<string, Metrics>; connections: Pair[] }
    return { load, overall: result.overall, objects: kept.objects, connections: kept.connections }
  } finally {
    abort.abort()
    stats?.close()
    // A process that will not stop must not hide what was measured, or keep the other from being asked.
    await lab?.stop().catch(() => {})
    await gateway?.stop().catch(() => {})
  }
}
