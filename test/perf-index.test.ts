import assert from 'node:assert/strict'
import { test } from 'node:test'
import { idleOf } from '../src/core/perf/idle.ts'
import { interpolate } from '../src/core/perf/levels.ts'
import type { Failure, Level, Metrics, Pair, Run } from '../src/core/perf/types.ts'
import { EDGE_KEYS, OBJECT_KEYS, put } from '../src/core/perf/util.ts'

// The reference: interpolate as it was before runs were indexed, looking every shape and line up in every level for every metric.
type Series = [load: number, value: number][]

/** A series' value at `load`: exact at a point, a straight line between two, nothing outside the series. */
function valueAt(series: Series, load: number): number | undefined {
  if (series.length === 0 || load < series[0][0] || load > series[series.length - 1][0]) return undefined
  for (let i = 0; i < series.length; i++) {
    const [l1, v1] = series[i]
    if (load === l1) return v1
    if (load < l1) {
      const [l0, v0] = series[i - 1]
      return v0 + ((v1 - v0) * (load - l0)) / (l1 - l0)
    }
  }
  return undefined
}

/** `keys` of whatever `pick` finds at each level, each metric read on the levels that carry it. */
function metricsAt(levels: Level[], pick: (level: Level) => Metrics | undefined, keys: readonly (keyof Metrics)[], load: number): Metrics {
  const out: Metrics = {}
  for (const key of keys) {
    const series: Series = levels.flatMap(l => {
      const v = pick(l)?.[key]
      return v === undefined ? [] : [[l.load, v] as [number, number]]
    })
    const v = valueAt(series, load)
    if (v !== undefined) out[key] = v
  }
  return out
}

/** How a connection's failing share fails at `load`: what the nearest level at or below it says, else the lowest level above that says one. Not interpolated: it is a kind, not a number. */
function failureAt(levels: Level[], pick: (level: Level) => Pair | undefined, load: number): Failure | undefined {
  let below: Failure | undefined
  let above: Failure | undefined
  for (const l of levels) {
    const f = pick(l)?.failure
    if (f === undefined) continue
    if (l.load <= load) below = f
    else if (above === undefined) above = f
  }
  return below ?? above
}

/**
 * The run at any load from no load to the top tested one, as a Level. Below the first tested level it runs toward the idle level (see idleOf); a load outside that range is
 * clamped to the nearest end, so nothing is ever extrapolated. Each metric is interpolated on the levels that carry it; one that has no value at
 * that load is left out (not measured), never zero. A load that isn't a number is the lowest level.
 * Known limit: every pair is looked up in every level for each metric; fine for a run of a few dozen
 * connections, index the pairs once if the tab calls this on every frame.
 */
function legacyInterpolate(run: Run, load: number): Level {
  const idle = idleOf(run)
  const levels = idle ? [idle, ...run.levels] : run.levels
  const at = Number.isFinite(load) ? Math.min(levels[levels.length - 1].load, Math.max(levels[0].load, load)) : run.levels[0].load

  const objects: Record<string, Metrics> = {}
  for (const id of new Set(levels.flatMap(l => Object.keys(l.objects)))) {
    const m = metricsAt(levels, l => (Object.hasOwn(l.objects, id) ? l.objects[id] : undefined), OBJECT_KEYS, at)
    if (Object.keys(m).length > 0) put(objects, id, m)
  }

  const pairs = new Map<string, [string, string]>()
  for (const l of levels) for (const c of l.connections) pairs.set(JSON.stringify([c.from, c.to]), [c.from, c.to])
  const connections: Pair[] = []
  for (const [from, to] of pairs.values()) {
    const pick = (l: Level) => l.connections.find(c => c.from === from && c.to === to)
    const m = metricsAt(levels, pick, EDGE_KEYS, at)
    const failure = failureAt(levels, pick, at)
    if (Object.keys(m).length > 0) connections.push({ from, to, ...m, ...(failure === undefined ? {} : { failure }) })
  }

  return { load: at, overall: metricsAt(levels, l => l.overall, EDGE_KEYS, at), objects, connections }
}

const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296

/** A run with holes: shapes and lines that come and go between levels, metrics left out, a line twice in a level, failures on some. */
function wobbly(seed: number): Run {
  const r = rng(seed)
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  const metrics = (keys: readonly (keyof Metrics)[]): Metrics => Object.fromEntries(keys.flatMap(k => (r() < 0.75 ? [[k, Math.round(r() * 1000) / 10]] : [])))
  const levels: Level[] = []
  let load = r() < 0.3 ? 0 : 5 + Math.floor(r() * 20)
  for (let i = 0; i < 2 + Math.floor(r() * 6); i++) {
    load += 5 + Math.floor(r() * 30)
    const objects: Record<string, Metrics> = {}
    for (const id of ids) if (r() < 0.7) objects[id] = metrics(OBJECT_KEYS)
    const connections: Pair[] = []
    for (let n = 0; n < 8; n++) {
      const from = ids[Math.floor(r() * ids.length)]
      const to = ids[Math.floor(r() * ids.length)]
      if (r() < 0.7) connections.push({ from, to, ...metrics(EDGE_KEYS), ...(r() < 0.3 ? { failure: (r() < 0.5 ? 'lost' : 'rejected') as Failure } : {}) })
    }
    levels.push({ load, overall: metrics(EDGE_KEYS), objects, connections })
  }
  return { name: 'r', unit: 'req/s', levels }
}

test('interpolate reads a run the way it did before runs were indexed', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const run = wobbly(seed)
    const top = run.levels[run.levels.length - 1].load
    const loads = [-5, 0, 1, top, top + 10, NaN, ...run.levels.map(l => l.load), ...run.levels.map(l => l.load + 0.5), top / 2, top / 3]
    for (const load of loads) {
      assert.deepStrictEqual(interpolate(run, load), legacyInterpolate(run, load), `seed ${seed}, load ${load}`)
    }
  }
})

test('an idle level is part of what interpolate reads, and is gone for a run that starts at 0', () => {
  const run = wobbly(7)
  assert.equal(idleOf(run)?.load, run.levels[0].load > 0 ? 0 : undefined)
  assert.equal(interpolate(run, 0).load, 0)
})
