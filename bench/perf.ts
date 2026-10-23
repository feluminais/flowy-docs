// node bench/perf.ts : what the Performance tab computes, for a run of L levels with 200 shapes and 300 lines each.
import { gen, rng, time, once, table, load } from './gen.ts'
import type { Level, Metrics, Pair, Run } from '../src/core/perf/types.ts'

const levels = await load<typeof import('../src/core/perf/levels.ts')>('src/core/perf/levels.ts')
const rollup = await load<typeof import('../src/core/perf/rollup.ts')>('src/core/perf/rollup.ts')
const traffic = await load<typeof import('../src/core/perf/traffic.ts')>('src/core/perf/traffic.ts')
const check = await load<typeof import('../src/core/perf/check.ts')>('src/core/perf/check.ts')
const perfview = await load<typeof import('../ui/src/perfview.ts')>('ui/src/perfview.ts')

const m = gen({ systems: 10, apps: 5, components: 9, linesPerShape: 2 })
const ids = Object.keys(m.objects)
const lineSet = m.connections.slice(0, 300)
function mkLevel(at: number, O: number, P: number, r: () => number): Level {
  const objects: Record<string, Metrics> = {}
  ids.slice(0, O).forEach(id => { objects[id] = { util: Math.min(1, (at / 1000) * (0.3 + r())), queue: Math.floor(r() * 10), errors: r() * 0.01 } })
  const connections: Pair[] = lineSet.slice(0, P).map(c => ({ from: c.from, to: c.to, rate: at * r(), p50: 20 + r() * 50, p95: 60 + r() * 100, bytes: 500, errors: r() * 0.01 }))
  return { load: at, overall: { rate: at, p50: 30, p95: 90, errors: 0.001 }, objects, connections }
}
const mkRun = (L: number): Run => {
  const r = rng(L * 7 + 200)
  return { name: 'r', unit: 'req/s', levels: Array.from({ length: L }, (_, i) => mkLevel((i + 1) * 10, 200, 300, r)) }
}

const Ls = [25, 50, 100, 200]
const rows: Record<string, number[]> = {}
const rec = (k: string, v: number) => (rows[k] ??= []).push(v)
const boxKeys = ['util', 'queue', 'errors'] as const
const lineKeys = ['rate', 'bytes', 'p50', 'p95', 'errors'] as const
for (const L of Ls) {
  const run = mkRun(L)
  const at = L * 5 + 3
  rec('interpolate at a load (each frame of a ramp)', time(() => levels.interpolate(run, at), 200, 100))
  rec('one frame of traffic (what the canvas draws)', time(() => traffic.traffic(m, run, at, 'root'), 200, 100))
  rec('a ramp of 120 frames', once(() => { for (let f = 0; f < 120; f++) traffic.traffic(m, run, 10 + (f / 120) * L * 10, 'root') }))
  rec('select a shape: its 3 readings, drawn twice', time(() => { for (let i = 0; i < 2; i++) for (const k of boxKeys) perfview.boxSeries(m, run, 'root', 'sys-0', k) }, 200, 20))
  rec('select a line: its 5 readings, drawn twice', time(() => { for (let i = 0; i < 2; i++) for (const k of lineKeys) perfview.lineSeries(m, run, 'root', lineSet[0].from, lineSet[0].to, k) }, 200, 20))
  rec('rollUpLoad of one level (not asked before)', time(() => rollup.rollUpLoad(m, { ...run.levels[0] }, 'root'), 200, 100))
  rec('checkRun', time(() => check.checkRun('r', run, m), 200, 20))
}
table('a run; levels =', Ls, rows)

// Four runs added together: the Strip and the curves follow one dial with the others held, and each tested load of it is a level to work out.
const added: Record<string, Run> = {}
const rows2: Record<string, number[]> = {}
for (const L of [10, 20, 40]) {
  const r = rng(L)
  const parts = ['a', 'b', 'c', 'd']
  for (const id of parts) added[id] = { name: id, unit: 'req/s', levels: Array.from({ length: L }, (_, i) => mkLevel((i + 1) * 10, 100, 120, r)) }
  const all = { ...added, sum: { name: 'sum', unit: '', adds: parts, levels: [] } as Run }
  const dials = (await load<typeof import('../src/core/perf/dials.ts')>('src/core/perf/dials.ts')).dialsOf(all, 'sum')!.dials
  const positions = dials.map(() => L / 2)
  ;(rows2['activeSeries: the curves with one dial moving'] ??= []).push(time(() => perfview.activeSeries(all, 'sum', dials, positions, 0), 300, 10))
  ;(rows2['one frame of trafficAt'] ??= []).push(time(() => traffic.trafficAt(m, all, 'sum', Object.fromEntries(dials.map(d => [d.id, d.values[L / 2]])), 'root'), 300, 20))
}
table('four runs added; levels in each =', [10, 20, 40], rows2)
