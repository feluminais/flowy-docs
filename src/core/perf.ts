import type { Problem } from './check.ts'
import { getObject, isMap, orEmpty, ParseError, readYaml, ROOT } from './model.ts'
import type { Model } from './model.ts'
import { chain, placeEnds } from './views.ts'

/**
 * Load-test runs. A run is a test summarised: for each load level that was tested, what each object and each
 * connection measured. Flowy replays the numbers and never predicts: between two tested levels it interpolates,
 * and outside the tested range there is nothing to show. Pure, so the browser and the node side use the same code
 * (desktop/Flowy.Core/Perf.cs is to be a port of it, kept equal by fixtures).
 */

/** Everything a run can measure. On an object: util, queue, errors. On a connection or overall: rate, p50, p95, errors. A missing number means "not measured", never zero. */
export type Metrics = { util?: number; queue?: number; errors?: number; rate?: number; p50?: number; p95?: number }
/** What one connection measured, or one line in a view once connections are rolled up. */
export type Pair = Metrics & { from: string; to: string }
export type Level = { load: number; overall: Metrics; objects: Record<string, Metrics>; connections: Pair[] }
export type Run = { name: string; about?: string; unit: string; entry?: string; levels: Level[] }

const OBJECT_KEYS = ['util', 'queue', 'errors'] as const
const EDGE_KEYS = ['rate', 'p50', 'p95', 'errors'] as const
/** The lowest and highest a metric may be. */
const RANGE: Record<keyof Metrics, readonly [number, number]> = {
  util: [0, 1], errors: [0, 1], queue: [0, Infinity], rate: [0, Infinity], p50: [0, Infinity], p95: [0, Infinity],
}

/** Sets an own property, so an id like "__proto__" is data and never the prototype. */
function put<T>(target: Record<string, T>, key: string, value: T) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** A number written in a file. Files hold text, so "0.35" is read here. */
const num = (v: unknown): number | undefined => {
  if (typeof v !== 'string' || v.trim() === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** The numbers `keys` name in `raw`. A value that isn't a number, or is out of range, is reported through `add` and left out. */
function readMetrics(keys: readonly (keyof Metrics)[], raw: Record<string, unknown>, where: string, add: (message: string) => void): Metrics {
  const out: Metrics = {}
  for (const key of keys) {
    const v = raw[key]
    if (v === undefined) continue
    const n = num(v)
    const [lo, hi] = RANGE[key]
    if (n === undefined) add(`${where}: ${key} must be a number`)
    else if (n < lo || n > hi) add(`${where}: ${key} must be ${hi === Infinity ? `${lo} or more` : `between ${lo} and ${hi}`}`)
    else out[key] = n
  }
  if (out.p50 !== undefined && out.p95 !== undefined && out.p95 < out.p50) add(`${where}: p95 is below p50`)
  return out
}

/**
 * Read one run file (`perf/<id>.yaml`). Throws a ParseError for a file that can't be played: bad YAML, the wrong shape,
 * fewer than two levels, loads that don't go up. A number that is wrong is a problem instead, and is left out of the run.
 */
export function parseRun(id: string, text: string): { run: Run; problems: Problem[] } {
  const file = `perf/${id}.yaml`
  const problems: Problem[] = []
  const add = (message: string) => problems.push({ file, message })
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "name", "unit" and "levels"')

  const word = (key: string): string | undefined => {
    const v = doc[key]
    if (v === undefined) return undefined
    if (typeof v !== 'string') throw new ParseError(file, `"${key}" must be plain text, not a list or a mapping`)
    return v.trim() === '' ? undefined : v
  }
  const name = word('name')
  if (name === undefined) add('name is missing')
  const about = word('about')
  const unit = word('unit')
  const entry = word('entry')

  const rawLevels = orEmpty(doc.levels, [])
  if (!Array.isArray(rawLevels)) throw new ParseError(file, '"levels" must be a list')
  if (rawLevels.length < 2) throw new ParseError(file, 'needs at least two levels, so there is something to play between')

  const readLevel = (raw: unknown, i: number): Level => {
    const at = `level ${i + 1}`
    if (!isMap(raw)) throw new ParseError(file, `${at} must be a mapping`)
    const load = num(raw.load)
    if (load === undefined || load < 0) throw new ParseError(file, `${at}: load must be a number, 0 or more`)
    const where = (what: string) => `load ${load}, ${what}`

    const rawOverall = orEmpty(raw.overall, {})
    if (!isMap(rawOverall)) throw new ParseError(file, `${at}: overall must be a mapping of numbers`)
    const overall = readMetrics(EDGE_KEYS, rawOverall, where('overall'), add)

    const rawObjects = orEmpty(raw.objects, {})
    if (!isMap(rawObjects)) throw new ParseError(file, `${at}: objects must map ids to numbers`)
    const objects: Record<string, Metrics> = {}
    for (const [oid, m] of Object.entries(rawObjects)) {
      const entryMap = orEmpty(m, {})
      if (!isMap(entryMap)) throw new ParseError(file, `${at}: ${oid} must be a mapping of numbers`)
      put(objects, oid, readMetrics(OBJECT_KEYS, entryMap, where(oid), add))
    }

    const rawPairs = orEmpty(raw.connections, [])
    if (!Array.isArray(rawPairs)) throw new ParseError(file, `${at}: connections must be a list`)
    const seen = new Set<string>()
    const connections: Pair[] = []
    rawPairs.forEach((c: unknown, j) => {
      if (!isMap(c)) throw new ParseError(file, `${at}: connection ${j + 1} must be a mapping`)
      const { from, to } = c
      if (typeof from !== 'string' || from === '' || typeof to !== 'string' || to === '')
        throw new ParseError(file, `${at}: connection ${j + 1} needs a "from" and a "to"`)
      const key = JSON.stringify([from, to])
      if (seen.has(key)) {
        add(`${where(`${from} → ${to}`)}: listed twice`)
        return
      }
      seen.add(key)
      connections.push({ from, to, ...readMetrics(EDGE_KEYS, c, where(`${from} → ${to}`), add) })
    })
    return { load, overall, objects, connections }
  }

  const levels = rawLevels.map(readLevel)
  levels.forEach((l, i) => {
    if (i > 0 && l.load <= levels[i - 1].load)
      throw new ParseError(file, `level ${i + 1}: load ${l.load} must be above ${levels[i - 1].load} (levels go up in load)`)
  })
  return { run: { name: name ?? id, ...(about === undefined ? {} : { about }), unit: unit ?? 'load', ...(entry === undefined ? {} : { entry }), levels }, problems }
}

/**
 * What a run says that the model doesn't back up: an `entry` or an object that isn't there, a connection that
 * isn't one of the model's. Each is reported once, however many levels repeat it. The numbers can't quietly
 * point at things that are gone, the rule `code` paths already follow.
 */
export function checkRun(id: string, run: Run, model: Model): Problem[] {
  const file = `perf/${id}.yaml`
  const problems: Problem[] = []
  const said = new Set<string>()
  const once = (message: string) => {
    if (said.has(message)) return
    said.add(message)
    problems.push({ file, message })
  }
  if (run.entry !== undefined && !getObject(model, run.entry)) once(`entry "${run.entry}" is not an object`)
  for (const level of run.levels) {
    for (const oid of Object.keys(level.objects)) if (!getObject(model, oid)) once(`unknown object "${oid}"`)
    for (const { from, to } of level.connections) {
      const unknown = [from, to].filter(end => !getObject(model, end))
      for (const end of unknown) once(`unknown object "${end}"`)
      if (unknown.length === 0 && !model.connections.some(c => c.from === from && c.to === to)) once(`${from} → ${to} is not a connection in the model`)
    }
  }
  return problems
}

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

/**
 * The run at any load inside the tested range, as a Level. A load outside it is clamped to the nearest end, so
 * nothing is ever extrapolated. Each metric is interpolated on the levels that carry it; one that has no value at
 * that load is left out (not measured), never zero. A load that isn't a number is the lowest level.
 * Known limit: every pair is looked up in every level for each metric; fine for a run of a few dozen
 * connections, index the pairs once if the tab calls this on every frame.
 */
export function interpolate(run: Run, load: number): Level {
  const { levels } = run
  const at = Number.isFinite(load) ? Math.min(levels[levels.length - 1].load, Math.max(levels[0].load, load)) : levels[0].load

  const objects: Record<string, Metrics> = {}
  for (const id of new Set(levels.flatMap(l => Object.keys(l.objects)))) {
    const m = metricsAt(levels, l => (Object.hasOwn(l.objects, id) ? l.objects[id] : undefined), OBJECT_KEYS, at)
    if (Object.keys(m).length > 0) put(objects, id, m)
  }

  const pairs = new Map<string, [string, string]>()
  for (const l of levels) for (const c of l.connections) pairs.set(JSON.stringify([c.from, c.to]), [c.from, c.to])
  const connections: Pair[] = []
  for (const [from, to] of pairs.values()) {
    const m = metricsAt(levels, l => l.connections.find(c => c.from === from && c.to === to), EDGE_KEYS, at)
    if (Object.keys(m).length > 0) connections.push({ from, to, ...m })
  }

  return { load: at, overall: metricsAt(levels, l => l.overall, EDGE_KEYS, at), objects, connections }
}

/**
 * How strained an object is, 0 to 1: its utilisation, or its error share counted twenty times (5% failing is as bad as
 * full), whichever is worse. Undefined when neither was measured. `share` is the raw number that decided it.
 */
export function strain(m: Metrics): { value: number; by: 'util' | 'errors'; share: number } | undefined {
  if (m.util === undefined && m.errors === undefined) return undefined
  const util = m.util ?? 0
  const errors = m.errors ?? 0
  const fromErrors = Math.min(1, errors * 20)
  return m.util !== undefined && util >= fromErrors ? { value: util, by: 'util', share: util } : { value: fromErrors, by: 'errors', share: errors }
}

/** One of two numbers when only one exists, else `f` of both. */
const either = (x: number | undefined, y: number | undefined, f: (a: number, b: number) => number): number | undefined =>
  x === undefined ? y : y === undefined ? x : f(x, y)
const add = (a: number, b: number) => a + b

/** `m` without the keys that have no number. */
const defined = (m: Metrics): Metrics => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined))

/**
 * A level as one view draws it. Each object takes the worst of what it holds and of itself (highest util and errors,
 * queues added; if a run measures both a shape and what is inside it, the queue counts twice, so measure one). Each
 * line the view draws takes the connections that land on it: rates added, worst latency, worst errors. A connection
 * the model doesn't have is left out. Objects are the same in every view; lines depend on `view`.
 */
export function rollUp(model: Model, level: Level, view: string): { objects: Record<string, Metrics>; lines: Pair[] } {
  const objects: Record<string, Metrics> = {}
  for (const [id, m] of Object.entries(level.objects)) {
    if (!getObject(model, id)) continue
    for (const holder of chain(model, id)) {
      if (holder === ROOT) continue
      const so = Object.hasOwn(objects, holder) ? objects[holder] : {}
      put(objects, holder, defined({ util: either(so.util, m.util, Math.max), errors: either(so.errors, m.errors, Math.max), queue: either(so.queue, m.queue, add) }))
    }
  }

  const lines = new Map<string, Pair>()
  for (const c of level.connections) {
    if (!model.connections.some(m => m.from === c.from && m.to === c.to)) continue
    const ends = placeEnds(model, view, c.from, c.to)
    if (!ends) continue
    const key = JSON.stringify(ends)
    const so = lines.get(key)
    lines.set(key, {
      from: ends[0], to: ends[1],
      ...defined({ rate: either(so?.rate, c.rate, add), p50: either(so?.p50, c.p50, Math.max), p95: either(so?.p95, c.p95, Math.max), errors: either(so?.errors, c.errors, Math.max) }),
    })
  }
  return { objects, lines: [...lines.values()] }
}
