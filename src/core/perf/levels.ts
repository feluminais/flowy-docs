import { dialsOf } from './dials.ts'
import { idleOf } from './idle.ts'
import type { Dial, Failure, Level, Metrics, Pair, Run, Setting } from './types.ts'
import { add, BY_KEYS, defined, EDGE_KEYS, either, keep, meanBytes, newMean, OBJECT_KEYS, own, put, settingFor, takeBytes } from './util.ts'

/** A run at a load or at a setting of its dials. */

type Series = [load: number, value: number][]
type SeriesOf = Partial<Record<keyof Metrics, Series>>

/** What a run says about each shape, line and the whole, level by level: the series interpolate reads, kept for as long as the run is. */
type RunIndex = {
  levels: Level[]
  objects: Map<string, SeriesOf>
  pairs: Map<string, { from: string; to: string; series: SeriesOf; failures: [load: number, failure: Failure][] }>
  overall: SeriesOf
}

const indexes = new WeakMap<Run, RunIndex>()

function addTo(into: SeriesOf, at: number, m: Metrics | undefined, keys: readonly (keyof Metrics)[]) {
  if (!m) return
  for (const key of keys) {
    const v = m[key]
    if (v !== undefined) (into[key] ??= []).push([at, v])
  }
}

const paired = new WeakMap<Level, Map<string, Pair>>()

/** The first connection of a level from one shape to another. */
function pairOf(level: Level, from: string, to: string): Pair | undefined {
  let byKey = paired.get(level)
  if (!byKey) {
    paired.set(level, (byKey = new Map()))
    for (const c of level.connections) {
      const key = JSON.stringify([c.from, c.to])
      if (!byKey.has(key)) byKey.set(key, c)
    }
  }
  return byKey.get(JSON.stringify([from, to]))
}

function indexOf(run: Run): RunIndex {
  let index = indexes.get(run)
  if (!index) {
    const idle = idleOf(run)
    const levels = idle ? [idle, ...run.levels] : run.levels
    index = { levels, objects: new Map(), pairs: new Map(), overall: {} }
    for (const l of levels) {
      for (const [id, m] of Object.entries(l.objects)) {
        let series = index.objects.get(id)
        if (!series) index.objects.set(id, (series = {}))
        addTo(series, l.load, m, OBJECT_KEYS)
      }
      const here = new Set<string>() // the first connection of a pair in a level is the one that counts
      for (const c of l.connections) {
        const key = JSON.stringify([c.from, c.to])
        if (here.has(key)) continue
        here.add(key)
        let pair = index.pairs.get(key)
        if (!pair) index.pairs.set(key, (pair = { from: c.from, to: c.to, series: {}, failures: [] }))
        addTo(pair.series, l.load, c, EDGE_KEYS)
        if (c.failure !== undefined) pair.failures.push([l.load, c.failure])
      }
      addTo(index.overall, l.load, l.overall, EDGE_KEYS)
    }
    indexes.set(run, index)
  }
  return index
}

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

/** `keys` of these series at `load`, each metric read on the levels that carry it. */
function metricsAt(series: SeriesOf, keys: readonly (keyof Metrics)[], load: number): Metrics {
  const out: Metrics = {}
  for (const key of keys) {
    const s = series[key]
    const v = s && valueAt(s, load)
    if (v !== undefined) out[key] = v
  }
  return out
}

/** How a connection's failing share fails at `load`: what the nearest level at or below it says, else the lowest level above that says one. Not interpolated: it is a kind, not a number. */
function failureAt(failures: [load: number, failure: Failure][], load: number): Failure | undefined {
  let below: Failure | undefined
  let above: Failure | undefined
  for (const [at, f] of failures) {
    if (at <= load) below = f
    else if (above === undefined) above = f
  }
  return below ?? above
}

/**
 * The run at any load from no load to the top tested one, as a Level. Below the first tested level it runs toward the idle level (see idleOf); a load outside that range is
 * clamped to the nearest end, so nothing is ever extrapolated. Each metric is interpolated on the levels that carry it; one that has no value at
 * that load is left out (not measured), never zero. A load that isn't a number is the lowest level.
 * What the run says about each shape and line is read once and kept with the run (see indexOf), so a frame only walks those series.
 */
export function interpolate(run: Run, load: number): Level {
  const { levels, objects: byObject, pairs, overall } = indexOf(run)
  const at = Number.isFinite(load) ? Math.min(levels[levels.length - 1].load, Math.max(levels[0].load, load)) : run.levels[0].load

  const objects: Record<string, Metrics> = {}
  for (const [id, series] of byObject) {
    const m = metricsAt(series, OBJECT_KEYS, at)
    if (Object.keys(m).length > 0) put(objects, id, m)
  }

  const connections: Pair[] = []
  for (const { from, to, series, failures } of pairs.values()) {
    const m = metricsAt(series, EDGE_KEYS, at)
    const failure = failureAt(failures, at)
    if (Object.keys(m).length > 0) connections.push({ from, to, ...m, ...(failure === undefined ? {} : { failure }) })
  }

  return { load: at, overall: metricsAt(overall, EDGE_KEYS, at), objects, connections }
}

/** What several parts carry together on a line or overall: rates added, the worst latency and failing share, and the size of a call weighted by rate. */
function foldEdges(items: Metrics[]): Metrics {
  let sum: Metrics = {}
  const mean = newMean()
  for (const m of items) {
    sum = defined({ rate: either(sum.rate, m.rate, add), p50: either(sum.p50, m.p50, Math.max), p95: either(sum.p95, m.p95, Math.max), errors: either(sum.errors, m.errors, Math.max) })
    takeBytes(mean, m)
  }
  return defined({ ...sum, bytes: meanBytes(mean) })
}

/**
 * Runs added together: every part is the level its run has at its own load, and what they say about one shape or line is put together. A shape's utilisation and queue add (they may
 * pass 1: it reads as over capacity), its failing share is the worst; a line's rate adds, its latency and failing share are the worst, the size of a call is the mean weighted
 * by rate, and `by` keeps what each part carried so its dots can be drawn in its colour and scale. This is an estimate: queues grow faster than a sum, so it looks calmer
 * than the system would near its limit.
 */
function addLevels(parts: { id: string; level: Level }[], loads: Setting): Level {
  const objects: Record<string, Metrics> = {}
  for (const { level } of parts) {
    for (const [oid, m] of Object.entries(level.objects)) {
      const so = Object.hasOwn(objects, oid) ? objects[oid] : {}
      put(objects, oid, defined({ util: either(so.util, m.util, add), errors: either(so.errors, m.errors, Math.max), queue: either(so.queue, m.queue, add) }))
    }
  }
  const lines = new Map<string, { from: string; to: string; carried: { id: string; pair: Pair }[] }>()
  for (const { id, level } of parts) {
    for (const pair of level.connections) {
      const key = JSON.stringify([pair.from, pair.to])
      const line = lines.get(key) ?? { from: pair.from, to: pair.to, carried: [] }
      lines.set(key, line)
      line.carried.push({ id, pair })
    }
  }
  const connections = [...lines.values()].map(({ from, to, carried }): Pair => {
    const failures = [...new Set(carried.flatMap(({ pair }) => (pair.failure === undefined ? [] : [pair.failure])))]
    const by: Record<string, Metrics> = {}
    for (const { id, pair } of carried) {
      const m = defined({ rate: pair.rate, bytes: pair.bytes, p50: pair.p50, errors: pair.errors })
      if (Object.keys(m).length > 0) put(by, id, m)
    }
    return { from, to, ...foldEdges(carried.map(c => c.pair)), ...(failures.length === 1 ? { failure: failures[0] } : {}), ...(Object.keys(by).length > 0 ? { by } : {}) }
  })
  return { load: 0, loads, overall: foldEdges(parts.map(p => p.level.overall)), objects, connections }
}

/**
 * A run tested together at a setting: the tested combinations around it, blended in proportion (a straight line along each source, so at the middle of a cell the mean of its
 * corners). Nothing outside the grid is shown: a setting past an end is that end. A number comes out only when every corner that counts carries it, and a corner the setting is
 * not in (weight 0) doesn't count, so a tested combination is exactly what was measured. How a failing share fails is the nearest corner's, as it is a kind, not a number.
 */
function blendGrid(run: Run, dials: Dial[], setting: Setting): Level {
  const loads: Setting = {}
  const cells = dials.map(d => {
    const x = keep(d, settingFor(setting, d.id))
    put(loads, d.id, x)
    const last = d.values.length - 1
    if (x >= d.values[last]) return { lo: last - 1, t: 1 }
    let lo = 0
    while (x >= d.values[lo + 1]) lo++
    return { lo, t: (x - d.values[lo]) / (d.values[lo + 1] - d.values[lo]) }
  })
  const tested = new Map(run.levels.map(l => [JSON.stringify(dials.map(d => l.loads?.[d.id])), l] as const))
  const corners: { w: number; level: Level }[] = []
  for (let mask = 0; mask < 1 << dials.length; mask++) {
    let w = 1
    const picked = dials.map((d, i) => {
      const up = (mask >> i) & 1
      w *= up ? cells[i].t : 1 - cells[i].t
      return d.values[cells[i].lo + up]
    })
    const level = tested.get(JSON.stringify(picked))
    if (w !== 0 && level) corners.push({ w, level })
  }
  const blend = (pick: (l: Level) => Metrics | undefined, keys: readonly (keyof Metrics)[]): Metrics => {
    const out: Metrics = {}
    if (corners.length === 0) return out
    for (const key of keys) {
      let total = 0
      let all = true
      for (const { w, level } of corners) {
        const v = pick(level)?.[key]
        if (v === undefined) {
          all = false
          break
        }
        total += w * v
      }
      if (all) out[key] = total
    }
    return out
  }

  const objects: Record<string, Metrics> = {}
  for (const oid of new Set(corners.flatMap(c => Object.keys(c.level.objects)))) {
    const m = blend(l => own(l.objects, oid), OBJECT_KEYS)
    if (Object.keys(m).length > 0) put(objects, oid, m)
  }
  const pairs = new Map<string, [string, string]>()
  for (const { level } of corners) for (const c of level.connections) pairs.set(JSON.stringify([c.from, c.to]), [c.from, c.to])
  const connections: Pair[] = []
  for (const [from, to] of pairs.values()) {
    const pick = (l: Level) => pairOf(l, from, to)
    const m = blend(pick, EDGE_KEYS)
    const by: Record<string, Metrics> = {}
    for (const d of dials) {
      const b = blend(l => own(pick(l)?.by, d.id), BY_KEYS)
      if (Object.keys(b).length > 0) put(by, d.id, b)
    }
    let failure: Failure | undefined
    let heaviest = 0
    for (const { w, level } of corners) {
      const f = pick(level)?.failure
      if (f !== undefined && w > heaviest) {
        heaviest = w
        failure = f
      }
    }
    if (Object.keys(m).length > 0 || Object.keys(by).length > 0)
      connections.push({ from, to, ...m, ...(failure === undefined ? {} : { failure }), ...(Object.keys(by).length > 0 ? { by } : {}) })
  }
  return { load: 0, loads, overall: blend(l => l.overall, EDGE_KEYS), objects, connections }
}

/**
 * The run at a setting, as a Level, whatever kind of run it is: one source is interpolate; runs added are each interpolated at their own load and put together; a run tested together
 * is blended inside its grid. A load past a dial's tested range is that end, and one that isn't a number is the lowest. A run that can't be played (dialsOf says so) is an empty level.
 * A level of several sources has `loads`, the setting it was worked out at.
 */
export function levelAt(runs: Record<string, Run>, id: string, setting: Setting): Level {
  const found = dialsOf(runs, id)
  if (!found) return { load: 0, overall: {}, objects: {}, connections: [] }
  if (found.mode === 'single') return interpolate(runs[id], settingFor(setting, ''))
  if (found.mode === 'tested') return blendGrid(runs[id], found.dials, setting)
  const loads: Setting = {}
  const parts = found.dials.map(d => {
    const x = keep(d, settingFor(setting, d.id))
    put(loads, d.id, x)
    return { id: d.id, level: interpolate(runs[d.id], x) }
  })
  return addLevels(parts, loads)
}
