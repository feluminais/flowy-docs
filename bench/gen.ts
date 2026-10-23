// Synthetic models and timing helpers for the benchmarks in this folder.
import type { Model, FlowyObject, Connection, Flow, Step, Analysis } from '../src/core/model.ts'
import { emptyModel } from '../src/core/model.ts'

export function rng(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

export type GenOpts = {
  systems: number; apps: number; components: number; // shapes ~ systems * (2 + apps + apps*components) + actors
  linesPerShape?: number; flows?: number; stepsPerFlow?: number; modes?: number; savedLayout?: boolean
}

export function gen(o: GenOpts, seed = 1): Model {
  const r = rng(seed)
  const m = emptyModel()
  const objects: Record<string, FlowyObject> = {}
  const leaves: string[] = []
  const top: string[] = []
  const put = (id: string, type: FlowyObject['type'], inn?: string, extra: Record<string, unknown> = {}) => {
    objects[id] = { type, name: `Thing ${id}`, ...(inn ? { in: inn } : {}), tech: 'Node', description: `d ${id}`, ...extra } as FlowyObject
  }
  for (let a = 0; a < Math.max(1, Math.floor(o.systems / 5)); a++) put(`actor-${a}`, 'actor')
  for (let s = 0; s < o.systems; s++) {
    const sid = `sys-${s}`
    put(sid, 'system'); top.push(sid)
    put(`${sid}-db`, 'store', sid); leaves.push(`${sid}-db`)
    for (let a = 0; a < o.apps; a++) {
      const aid = `${sid}-app-${a}`
      put(aid, 'app', sid)
      if (o.components === 0) leaves.push(aid)
      for (let c = 0; c < o.components; c++) { const cid = `${aid}-c${c}`; put(cid, 'component', aid); leaves.push(cid) }
    }
  }
  m.objects = objects
  const n = Object.keys(objects).length
  const conns: Connection[] = []
  const all = Object.keys(objects)
  const lines = Math.floor((o.linesPerShape ?? 2) * n)
  for (let i = 0; i < lines; i++) {
    const from = leaves[Math.floor(r() * leaves.length)]
    let to = all[Math.floor(r() * all.length)]
    if (to === from) to = leaves[(leaves.indexOf(from) + 1) % leaves.length]
    conns.push(r() < 0.3 ? { from, to, label: `call ${i % 17}` } : { from, to })
  }
  // dedupe exact duplicates so check() stays about as quiet as a real model
  const seen = new Set<string>(); m.connections = conns.filter(c => { const k = `${c.from}|${c.to}|${c.label ?? ''}`; if (seen.has(k) || c.from === c.to) return false; seen.add(k); return true })

  const flows: Record<string, Flow> = {}
  for (let f = 0; f < (o.flows ?? 0); f++) {
    const steps: Step[] = []
    for (let i = 0; i < (o.stepsPerFlow ?? 20); i++) {
      const a = top[Math.floor(r() * top.length)]
      let b = top[Math.floor(r() * top.length)]
      if (a === b) b = top[(top.indexOf(a) + 1) % top.length]
      const st: Step = { from: a, to: b, text: `Step ${i}` }
      if (i % 3 === 0) st.animation = 'call'
      if (i % 11 === 0) st.states = { [a]: 'degraded' }
      steps.push(st)
    }
    flows[`flow-${f}`] = { name: `Flow ${f}`, view: 'root', steps }
  }
  m.flows = flows
  const failures: Record<string, Analysis> = {}
  if ((o.modes ?? 0) > 0) {
    const modes: Analysis['modes'] = {}
    for (let i = 0; i < o.modes!; i++) {
      const on = leaves[Math.floor(r() * leaves.length)]
      modes[`mode-${i}`] = i % 4 === 0 && m.connections.length ? { mode: `m${i}`, from: m.connections[i % m.connections.length].from, to: m.connections[i % m.connections.length].to, severity: String(1 + (i % 10)), occurrence: '4', detection: '5' }
        : { mode: `m${i}`, on, severity: String(1 + (i % 10)), occurrence: '4', detection: '5', effect: 'x' }
    }
    failures['fa'] = { name: 'FA', modes }
  }
  m.failures = failures
  if (o.savedLayout) {
    const lay: Record<string, [number, number]> = {}
    all.forEach((id, i) => { lay[id] = [(i % 30) * 220, Math.floor(i / 30) * 100] })
    m.layout = { root: lay }
  }
  return m
}

export function time(fn: () => unknown, minMs = 150, maxReps = 200): number {
  fn() // warm
  const t: number[] = []
  const start = performance.now()
  while (performance.now() - start < minMs && t.length < maxReps) {
    const a = performance.now(); fn(); t.push(performance.now() - a)
  }
  t.sort((x, y) => x - y)
  return t[Math.floor(t.length / 2)]
}
// one cold run (no warmup): for caches / big one-offs
export function once(fn: () => unknown): number { const a = performance.now(); fn(); return performance.now() - a }

export const fmt = (n: number) => (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2))
export function exponent(a: number, b: number, nA: number, nB: number) { return Math.log(b / a) / Math.log(nB / nA) }

/**
 * The code under test lives in the checkout `FLOWY_ROOT` names (default: this one), so one script can time main and a branch:
 * `FLOWY_ROOT=/path/to/other/checkout node bench/views.ts`.
 */
export async function load<T>(path: string): Promise<T> {
  const { pathToFileURL } = await import('node:url')
  const { resolve } = await import('node:path')
  const root = process.env.FLOWY_ROOT ?? resolve(import.meta.dirname, '..')
  return (await import(pathToFileURL(resolve(root, path)).href)) as T
}

/** Prints rows of timings by size, with the growth exponent in the last column (1 is linear, 2 is quadratic). */
export function table(head: string, xs: number[], rows: Record<string, number[]>) {
  console.log(`\n${head}`.padEnd(66) + xs.map(x => String(x).padStart(9)).join('') + '   exp')
  for (const [k, v] of Object.entries(rows)) console.log(k.padEnd(65) + v.map(x => fmt(x).padStart(9)).join('') + `   ${exponent(v[0], v[v.length - 1], xs[0], xs[xs.length - 1]).toFixed(2)}`)
}
