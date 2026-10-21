import type { Problem } from './check.ts'
import { evalFormula, linearInRate, parseFormula } from './formula.ts'
import type { Formula } from './formula.ts'
import { colorPair, isColor } from './look.ts'
import { getObject, ID_RULE, isMap, isValidId, orEmpty, ParseError, readYaml, ROOT } from './model.ts'
import type { Model } from './model.ts'
import { isStateName, STATE_LABELS, STATE_NAMES } from './states.ts'
import type { StateName, States } from './states.ts'
import { chain, placeEnds } from './views.ts'

/**
 * Load-test runs. A run is a test summarised: for each load level that was tested, what each object and each
 * connection measured. Flowy replays the numbers and never predicts: between two tested levels it interpolates,
 * and outside the tested range there is nothing to show. Pure, so the browser and the node side use the same code
 * (desktop/Flowy.Core/Perf.cs is to be a port of it, kept equal by fixtures).
 */

/** Everything a run can measure. On an object: util, queue, errors. On a connection or overall: rate, bytes (a call's size), p50, p95, errors. A missing number means "not measured", never zero. */
export type Metrics = { util?: number; queue?: number; errors?: number; rate?: number; bytes?: number; p50?: number; p95?: number }
/** How the failing share of a line fails, when it is said: a request that is lost on the way, or one that is turned away at the end. Without one, the generic fade. */
export type Failure = 'lost' | 'rejected'
export const FAILURES: readonly Failure[] = ['lost', 'rejected']
/**
 * What one connection measured, or one line in a view once connections are rolled up. `by` splits what a line carries between the sources of a run that has
 * several (see Run.sources): each source's own `rate`, `bytes`, `p50` and `errors`, so its dots can take its colour and scale. Left out of a line that doesn't say.
 */
export type Pair = Metrics & { from: string; to: string; failure?: Failure; by?: Record<string, Metrics> }
/**
 * What was measured at one load (or one time). A run tested with several sources has no single load: its levels carry `loads`, a load for each source (and `load` is
 * 0, unused). The levelAt of a run with several sources gives `loads` too, as the setting it was worked out at.
 */
export type Level = { load: number; loads?: Record<string, number>; overall: Metrics; objects: Record<string, Metrics>; connections: Pair[] }
/**
 * A formula as the run wrote it. Only the text is kept: a run travels to the browser as JSON, which drops anything but data, so the formula is read
 * from the text where it is used (see formulaOf). parseRun has already checked that the text reads.
 */
export type SourceFormula = { text: string }
/**
 * Where a run's requests come from, and how to draw them: the dots' colour (a colour name or hex, like a shape's), a formula for how many dots a
 * line shows at once and one for the area of a dot. Every key is optional. Part 3b will make a run hold a list of these; keep it a value of its own.
 */
export type Source = { color?: string; dot?: SourceFormula; size?: SourceFormula }
/**
 * What a run is measured over: the load put on the system (the default), or time. A time run's levels are points in time and its `events`
 * (a shape stopped, a restart begun) change shapes' states along the way. The number a level stands at is `load` in both, whatever the axis.
 */
export type Axis = 'load' | 'time'
export const AXES: readonly Axis[] = ['load', 'time']
/** Something that happens at a time in a time run: a shape goes into a state. `text` is empty when the run doesn't say; eventText then words it. */
export type RunEvent = { at: number; on: string; state: StateName; text: string }
/**
 * One of the sources of a run that was tested with several at once: a name, the unit of its load, the shape its requests enter at, and how to draw them
 * (the colour and the two formulas of a single run's `source:`, kept as a Source).
 */
export type SourceInfo = { name: string; entry?: string; unit: string; source?: Source }
/**
 * `axis` and `events` are left out of a run that has none, so a load run is exactly what it was before time runs existed (a time run says its axis;
 * its events are there when it has any). Read them through isTime and eventsOf. A run that has several sources of requests is one of two kinds, and a
 * single run has neither key: `adds` (the ids of the runs it adds, and no levels of its own) or `sources` (tested together: its levels form a grid, one load for
 * each source). Read what such a run means through dialsOf, never from these keys.
 */
export type Run = {
  name: string; about?: string; unit: string; entry?: string; source?: Source; axis?: Axis; events?: RunEvent[]
  adds?: string[]; sources?: Record<string, SourceInfo>; levels: Level[]
}

/** Whether the run is measured over time. */
export const isTime = (run: Run): boolean => run.axis === 'time'
const NO_EVENTS: readonly RunEvent[] = []
/** A run's events in time order (later in the file last among those at one time); none for a load run. */
export const eventsOf = (run: Run): readonly RunEvent[] => run.events ?? NO_EVENTS

const OBJECT_KEYS = ['util', 'queue', 'errors'] as const
const EDGE_KEYS = ['rate', 'bytes', 'p50', 'p95', 'errors'] as const
/** The lowest and highest a metric may be. */
const RANGE: Record<keyof Metrics, readonly [number, number]> = {
  util: [0, 1], errors: [0, 1], queue: [0, Infinity], rate: [0, Infinity], bytes: [0, Infinity], p50: [0, Infinity], p95: [0, Infinity],
}
const SOURCE_KEYS = ['color', 'dot', 'size'] as const
/** What a tested-together source may say: its own name, entry and unit, and the three of a single run's `source:`. */
const SOURCE_INFO_KEYS = ['name', 'entry', 'unit', ...SOURCE_KEYS] as const
/** The numbers a source may give for one line (`by`). */
const BY_KEYS = ['rate', 'bytes', 'p50', 'errors'] as const
/** Most runs one run may add, and most sources a run may be tested with. */
export const MOST_ADDED = 4
export const MOST_TESTED = 3
/**
 * The colours a source takes when it names none, in the order the sources are listed. Red is left out: it is the colour of a call that fails. A source that
 * names a colour keeps it, and one that doesn't takes the first of these that no other source draws in (see dialsOf).
 */
export const SOURCE_PALETTE: readonly string[] = ['blue', 'green', 'orange', 'indigo']
/** How much of a name a problem quotes, so a hostile key doesn't fill the problem list. */
const QUOTED = 40
const brief = (text: string): string => (text.length > QUOTED ? `${text.slice(0, QUOTED)}…` : text)

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

/** The `source:` block of a run. A problem is reported through `add` and what is wrong is left out; a block with nothing usable in it is no source. */
function readSource(raw: unknown, add: (message: string) => void): Source | undefined {
  const block = orEmpty(raw, undefined)
  if (block === undefined) return undefined
  if (!isMap(block)) {
    add('source must be a mapping of color, dot and size')
    return undefined
  }
  return readSourceKeys(block, SOURCE_KEYS, 'source', add)
}

/**
 * The colour and the two formulas in a mapping: a single run's `source:` block, or one of the sources of a run tested together (which also says its name, entry and
 * unit, so `allowed` is wider). `label` starts each problem. What is wrong is left out; a block with nothing usable in it is no source.
 */
function readSourceKeys(block: Record<string, unknown>, allowed: readonly string[], label: string, add: (message: string) => void): Source | undefined {
  for (const key of Object.keys(block)) if (!allowed.some(k => k === key)) add(`${label}: unknown key "${brief(key)}" (use ${allowed.join(', ')})`)
  const out: Source = {}
  const color = orEmpty(Object.hasOwn(block, 'color') ? block.color : undefined, undefined)
  if (color !== undefined) {
    if (typeof color === 'string' && isColor(color)) out.color = color
    else add(`${label}: color must be a colour name or a hex such as #1d9e75`)
  }
  const formula = (key: 'dot' | 'size', example: string): SourceFormula | undefined => {
    const text = orEmpty(Object.hasOwn(block, key) ? block[key] : undefined, undefined)
    if (text === undefined) return undefined
    if (typeof text !== 'string') {
      add(`${label}: ${key} must be a formula such as ${example}`)
      return undefined
    }
    const read = parseFormula(text)
    if ('problem' in read) {
      add(`${label}: ${key} ${read.problem}`) // a formula that can't be read leaves the default curve in its place
      return undefined
    }
    return { text }
  }
  const dot = formula('dot', 'rate / 50')
  if (dot) out.dot = dot
  const size = formula('size', 'bytes / 400')
  if (size) out.size = size
  return Object.keys(out).length === 0 ? undefined : out
}

/** Whether two colours draw the same: a name and its own hex are one colour. */
function sameColor(a: string, b: string): boolean {
  const [pa, pb] = [colorPair(a), colorPair(b)]
  return pa !== undefined && pb !== undefined && pa[0] === pb[0] && pa[1] === pb[1]
}

/** A problem for each pair of the colours (in the order they come) that draw the same, naming the sources by `names`. */
function sharedColors(colors: (string | undefined)[], names: string[], add: (message: string) => void) {
  colors.forEach((c, i) => {
    if (c === undefined) return
    const first = colors.findIndex(d => d !== undefined && sameColor(c, d))
    if (first !== i) add(`${names[first]} and ${names[i]} both draw in ${brief(c)}: give each its own colour`)
  })
}

/** Formulas already read, by their text, so a line that is drawn twenty times a second doesn't read its formula each time. Kept small: a run has two. */
const READ = new Map<string, Formula | undefined>()

/** The formula a source's text says, or undefined for a text that doesn't read (a run that was not through parseRun). */
function formulaOf(f: SourceFormula): Formula | undefined {
  if (!READ.has(f.text)) {
    if (READ.size >= 64) READ.clear()
    const read = parseFormula(f.text)
    READ.set(f.text, 'formula' in read ? read.formula : undefined)
  }
  return READ.get(f.text)
}

/** The `failure:` of a connection: lost or rejected, or nothing. Anything else is a problem. */
function readFailure(raw: unknown, where: string, add: (message: string) => void): Failure | undefined {
  const v = orEmpty(raw, undefined)
  if (v === undefined) return undefined
  const found = FAILURES.find(f => f === v)
  if (found === undefined) add(`${where}: failure must be ${FAILURES.join(' or ')}`)
  return found
}

const USE_STATE = `use ${STATE_NAMES.join(', ')}`

/**
 * The `events:` of a time run, in time order (a stable sort, so of two at one time the later in the file stays later). A problem is reported through `add`
 * and the event it is about is left out: one with no time inside the run (`range` is the first and last time), no shape or no state word. A text that is not
 * plain text only loses the text. The shape is not looked up here (checkRun does, once the model is known).
 */
function readEvents(raw: unknown, range: readonly [number, number], unit: string, add: (message: string) => void): RunEvent[] {
  const list = orEmpty(raw, [])
  if (!Array.isArray(list)) {
    add('events must be a list')
    return []
  }
  const out: RunEvent[] = []
  list.forEach((e: unknown, i) => {
    const where = `event ${i + 1}`
    if (!isMap(e)) return add(`${where} must be a mapping of at, on, state and text`)
    let ok = true
    const at = num(e.at)
    if (at === undefined) {
      add(`${where}: at must be a number`)
      ok = false
    } else if (at < range[0] || at > range[1]) {
      add(`${where}: at ${at} is outside the run (${range[0]} to ${range[1]} ${unit})`)
      ok = false
    }
    const on = e.on
    if (typeof on !== 'string' || on === '') {
      add(`${where}: on must name a shape`)
      ok = false
    }
    const state = e.state
    if (typeof state !== 'string') {
      add(`${where}: state needs a state word (${USE_STATE})`)
      ok = false
    } else if (!isStateName(state)) {
      add(`${where}: unknown state "${brief(state)}" (${USE_STATE})`)
      ok = false
    }
    const said = orEmpty(e.text, undefined)
    if (said !== undefined && typeof said !== 'string') add(`${where}: text must be plain text`)
    if (ok && at !== undefined && typeof on === 'string' && isStateName(state)) out.push({ at, on, state, text: typeof said === 'string' ? said.trim() : '' })
  })
  return out.sort((a, b) => a.at - b.at)
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
  const axisText = orEmpty(doc.axis, undefined)

  // A run that adds others is a list of runs and nothing else: no levels of its own, no source (each run it adds has its own).
  const addsText = orEmpty(doc.adds, undefined)
  if (addsText !== undefined) {
    if (!Array.isArray(addsText)) throw new ParseError(file, '"adds" must be a list of run ids')
    const adds = readAdds(id, file, addsText, add)
    for (const own of ['levels', 'sources', 'source'] as const) if (orEmpty(doc[own], undefined) !== undefined) add(`a run that adds others has no ${own} of its own`)
    if (axisText === 'time') add('a run that adds others is measured over load, not time')
    return { run: { name: name ?? id, ...(about === undefined ? {} : { about }), unit: '', adds, levels: [] }, problems }
  }

  // A run tested with several sources at once: its levels name a load for each.
  const sourcesText = orEmpty(doc.sources, undefined)
  const sources = sourcesText === undefined ? undefined : readSources(file, sourcesText, add)
  const unit = word('unit')
  const entry = word('entry')
  if (sources !== undefined) {
    if (entry !== undefined) add('entry is for a single run: a run with sources gives each source its own entry')
    if (orEmpty(doc.source, undefined) !== undefined) add('source is for a single run: a run with sources gives each source its own color, dot and size')
    if (axisText === 'time') add('a run with sources is measured over load, not time')
  }
  const source = sources === undefined ? readSource(doc.source, add) : undefined
  const axis: Axis = sources === undefined ? AXES.find(a => a === axisText) ?? 'load' : 'load' // a run says what it is measured over, or is a load run
  if (sources === undefined && axisText !== undefined && !AXES.some(a => a === axisText)) add(`axis must be ${AXES.join(' or ')}`)
  // The key a level carries its number under, and the other one, which is the commonest slip: a time run written with load, or a load run with at.
  const key = axis === 'time' ? 'at' : 'load'
  const other = axis === 'time' ? 'load' : 'at'

  const rawLevels = orEmpty(doc.levels, [])
  if (!Array.isArray(rawLevels)) throw new ParseError(file, '"levels" must be a list')
  if (rawLevels.length < 2) throw new ParseError(file, 'needs at least two levels, so there is something to play between')

  const readLevel = (raw: unknown, i: number): Level => {
    const at = `level ${i + 1}`
    if (!isMap(raw)) throw new ParseError(file, `${at} must be a mapping`)
    if (raw[other] !== undefined) add(`${at}: a ${axis} run uses ${key}, not ${other}`)
    const loadText = raw[key] ?? raw[other] // the wrong key is told off above and still gives the number, so the run plays
    // A run with sources names a load for each (and has no single one); any other run has one number.
    const loads = sources === undefined ? undefined : readLoads(file, at, loadText, sources)
    const load = loads === undefined ? num(loadText) : 0
    if (load === undefined || load < 0)
      throw new ParseError(file, isMap(loadText) ? `${at}: ${key} is a mapping of sources, but the run has no sources` : `${at}: ${key} must be a number, 0 or more`)
    const lead = loads === undefined ? `${key} ${load}` : describeLoads(loads)
    const where = (what: string) => `${lead}, ${what}`

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
      const label = where(`${from} → ${to}`)
      const failure = readFailure(c.failure, label, add)
      const by = readBy(c.by, sources, label, add)
      connections.push({ from, to, ...readMetrics(EDGE_KEYS, c, label, add), ...(failure === undefined ? {} : { failure }), ...(by === undefined ? {} : { by }) })
    })
    return { load, ...(loads === undefined ? {} : { loads }), overall, objects, connections }
  }

  const read = rawLevels.map(readLevel)
  if (sources === undefined) {
    read.forEach((l, i) => {
      if (i > 0 && l.load <= read[i - 1].load)
        throw new ParseError(file, `level ${i + 1}: ${key} ${l.load} must be above ${read[i - 1].load} (levels go up in ${axis})`)
    })
  }
  const levels = sources === undefined ? read : gridOf(file, sources, read)
  // Events belong to a time run. On a load run they are a problem and are not read.
  const rawEvents = orEmpty(doc.events, undefined)
  if (axis === 'load' && rawEvents !== undefined) add('events are only for a time run (set axis: time)')
  const runUnit = sources === undefined ? unit ?? (axis === 'time' ? 's' : 'load') : '' // a run with sources has no unit of its own: each source has one
  const events = axis === 'time' ? readEvents(rawEvents, [levels[0].load, levels[levels.length - 1].load], runUnit, add) : []
  return {
    run: {
      name: name ?? id, ...(about === undefined ? {} : { about }), unit: runUnit, ...(entry === undefined || sources !== undefined ? {} : { entry }), ...(source === undefined ? {} : { source }),
      ...(axis === 'time' ? { axis } : {}), ...(events.length === 0 ? {} : { events }), ...(sources === undefined ? {} : { sources }), levels,
    },
    problems,
  }
}

/**
 * The runs a run that adds others lists. A slip is a problem and what is wrong is left out: an item that isn't a run id, the run itself, an id listed twice, more than MOST_ADDED
 * (the rest are left out). Fewer than two left can't be played, so that is a ParseError. Whether the runs exist is for checkRuns, which sees the other runs.
 */
function readAdds(id: string, file: string, list: unknown[], add: (message: string) => void): string[] {
  const out: string[] = []
  list.forEach((v, i) => {
    if (typeof v !== 'string' || v.trim() === '') return add(`adds: item ${i + 1} must be a run id`)
    const run = v.trim()
    if (run === id) return add(`adds: ${id} can't add itself`)
    if (out.includes(run)) return add(`adds: ${brief(run)} is listed twice`)
    out.push(run)
  })
  if (out.length > MOST_ADDED) {
    add(`adds: at most ${MOST_ADDED} runs, so ${out.slice(MOST_ADDED).map(brief).join(', ')} left out`)
    out.length = MOST_ADDED
  }
  if (out.length < 2) throw new ParseError(file, `adds needs two to ${MOST_ADDED} runs, not ${out.length}`)
  return out
}

/**
 * The `sources:` of a run tested together: 2 to MOST_TESTED, each a mapping with a name, a unit, an entry and the colour and formulas of a single run's source. A slip in one is a
 * problem and is left out of it. What can't be played is a ParseError: not a mapping, the wrong count, an id that isn't one, a source that isn't a mapping.
 */
function readSources(file: string, raw: unknown, add: (message: string) => void): Record<string, SourceInfo> {
  if (!isMap(raw)) throw new ParseError(file, '"sources" must map each source id to its name, unit and entry')
  const ids = Object.keys(raw)
  if (ids.length < 2 || ids.length > MOST_TESTED) throw new ParseError(file, `sources needs two to ${MOST_TESTED} sources, not ${ids.length}`)
  const out: Record<string, SourceInfo> = {}
  for (const sid of ids) {
    if (!isValidId(sid)) throw new ParseError(file, `source "${brief(sid)}" is not a valid id: the id must ${ID_RULE}`)
    const block = orEmpty(raw[sid], {})
    if (!isMap(block)) throw new ParseError(file, `source ${sid} must be a mapping of name, unit and entry`)
    const label = `source ${sid}`
    const source = readSourceKeys(block, SOURCE_INFO_KEYS, label, add)
    const text = (key: 'name' | 'unit' | 'entry'): string | undefined => {
      const v = orEmpty(Object.hasOwn(block, key) ? block[key] : undefined, undefined)
      if (v === undefined) return undefined
      if (typeof v !== 'string') {
        add(`${label}: ${key} must be plain text`)
        return undefined
      }
      return v.trim() === '' ? undefined : v
    }
    const name = text('name')
    if (name === undefined) add(`${label}: name is missing`)
    const entry = text('entry')
    put(out, sid, { name: name ?? sid, ...(entry === undefined ? {} : { entry }), unit: text('unit') ?? 'load', ...(source === undefined ? {} : { source }) })
  }
  sharedColors(ids.map(sid => out[sid].source?.color), ids.map(sid => out[sid].name), add)
  return out
}

/** The load a level of a run tested together names for each source. Anything else is a ParseError: a level that can't be placed on the grid. */
function readLoads(file: string, at: string, raw: unknown, sources: Record<string, SourceInfo>): Record<string, number> {
  const ids = Object.keys(sources)
  if (!isMap(raw)) throw new ParseError(file, `${at}: load must give a number for each source (${ids.join(', ')})`)
  for (const sid of Object.keys(raw)) if (!Object.hasOwn(sources, sid)) throw new ParseError(file, `${at}: load names "${brief(sid)}", which is not a source (${ids.join(', ')})`)
  const out: Record<string, number> = {}
  for (const sid of ids) {
    const n = num(Object.hasOwn(raw, sid) ? raw[sid] : undefined)
    if (n === undefined || n < 0) throw new ParseError(file, `${at}: load: ${sid} must be a number, 0 or more`)
    put(out, sid, n)
  }
  return out
}

/** The loads of a level, in words: "orders 100 and pings 50". */
const describeLoads = (loads: Record<string, number>): string => Object.entries(loads).map(([sid, n]) => `${sid} ${n}`).join(' and ')

/**
 * The levels of a run tested together as a full grid: every load that any level names for a source, with every load of the others. Each source needs two loads, a combination may be
 * listed once, and a combination that is not listed is the one problem, naming the first in grid order (the first source changes slowest). The levels come back in that order.
 */
function gridOf(file: string, sources: Record<string, SourceInfo>, levels: Level[]): Level[] {
  const ids = Object.keys(sources)
  const loadsOf = (l: Level): Record<string, number> => l.loads ?? {}
  const values = ids.map(sid => [...new Set(levels.map(l => loadsOf(l)[sid]))].sort((a, b) => a - b))
  ids.forEach((sid, i) => {
    if (values[i].length < 2) throw new ParseError(file, `source ${sid} needs at least two loads, so there is something to play between`)
  })
  const keyOf = (loads: Record<string, number>): string => JSON.stringify(ids.map(sid => loads[sid]))
  const listed = new Map<string, number>()
  levels.forEach((l, i) => {
    const key = keyOf(loadsOf(l))
    const first = listed.get(key)
    if (first !== undefined) throw new ParseError(file, `level ${i + 1}: ${describeLoads(loadsOf(l))} is listed twice (level ${first + 1} has it)`)
    listed.set(key, i)
  })
  const ordered: Level[] = []
  const walk = (i: number, picked: number[]): void => {
    if (i === ids.length) {
      const loads: Record<string, number> = {}
      ids.forEach((sid, j) => put(loads, sid, picked[j]))
      const at = listed.get(keyOf(loads))
      if (at === undefined) throw new ParseError(file, `no level for ${describeLoads(loads)}: a run tested together needs every load of each source with every load of the others`)
      ordered.push(levels[at])
      return
    }
    for (const v of values[i]) walk(i + 1, [...picked, v])
  }
  walk(0, [])
  return ordered
}

/**
 * The `by:` of a connection: what each source of a run with sources carries on that line, as its own rate, bytes, p50 and errors. A slip is a problem and is left out: `by` in a run
 * without sources, one that isn't a mapping, a source it doesn't have, a key that isn't one of the four. A source with no usable number is left out.
 */
function readBy(raw: unknown, sources: Record<string, SourceInfo> | undefined, where: string, add: (message: string) => void): Record<string, Metrics> | undefined {
  const block = orEmpty(raw, undefined)
  if (block === undefined) return undefined
  if (sources === undefined) {
    add(`${where}: by is for a run with sources`)
    return undefined
  }
  if (!isMap(block)) {
    add(`${where}: by must map a source to its numbers`)
    return undefined
  }
  const out: Record<string, Metrics> = {}
  for (const [sid, v] of Object.entries(block)) {
    if (!Object.hasOwn(sources, sid)) {
      add(`${where}: by names "${brief(sid)}", which is not a source`)
      continue
    }
    const entry = orEmpty(v, {})
    if (!isMap(entry)) {
      add(`${where}: by ${sid} must be a mapping of numbers`)
      continue
    }
    for (const key of Object.keys(entry)) if (!BY_KEYS.some(k => k === key)) add(`${where}: by ${sid}: unknown key "${brief(key)}" (use ${BY_KEYS.join(', ')})`)
    const m = readMetrics(BY_KEYS, entry, `${where}, ${sid}`, add)
    if (Object.keys(m).length > 0) put(out, sid, m)
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * What a run says about other runs, which one run alone can't see: each run an adder lists must be a load run of its own (not missing, not a run over time, not another
 * adder, not tested with several sources), and two of them may not draw in one colour. An adder with fewer than two runs it can add can't be played: the loader leaves it out
 * (see dialsOf). Each problem names the run it is about.
 */
export function checkRuns(runs: Record<string, Run>): Problem[] {
  const problems: Problem[] = []
  for (const [id, run] of Object.entries(runs)) {
    if (run.adds === undefined) continue
    const add = (message: string) => problems.push({ file: `perf/${id}.yaml`, message })
    const good: string[] = []
    for (const part of run.adds) {
      const why = whyNotAdded(runs, part)
      if (why === undefined) good.push(part)
      else add(`adds "${brief(part)}", ${why}`)
    }
    if (good.length < 2) add("can't be played: fewer than two of the runs it adds can be added")
    else sharedColors(good.map(part => runs[part].source?.color), good.map(part => runs[part].name), add)
  }
  return problems
}

/** Why a run can't be one of those an adder adds, or undefined when it can: it is a load run with levels of its own, and one source. */
function whyNotAdded(runs: Record<string, Run>, id: string): string | undefined {
  if (!Object.hasOwn(runs, id)) return 'which is not a run'
  const run = runs[id]
  if (run.adds !== undefined) return 'which adds runs itself'
  if (run.sources !== undefined) return 'which is tested with several sources'
  if (isTime(run)) return 'which is a run over time'
  return undefined
}

/**
 * A dial: one thing the load can be turned up on. A run with one source has one (its `id` is ''); a run that adds others has one for each run it adds (the id of that run); a run
 * tested together has one for each of its sources. `values` are the loads that were tested, going up; `color` is the colour its dots are drawn in, from its source or else from
 * the palette.
 */
export type Dial = { id: string; name: string; unit: string; values: number[]; source?: Source; color: string }
/** Which kind of run it is: one source, several added from separate runs, or several tested together. */
export type Mode = 'single' | 'added' | 'tested'

/**
 * The colour of each source: the one it names, else the first of the palette that no other source draws in, in the order the sources come. (Two sources that name the same colour are
 * a problem the checks report; they keep it.) A source nobody names a colour for is never red, the colour of a failing call.
 */
function colorsOf(sources: (Source | undefined)[]): string[] {
  const taken: string[] = sources.flatMap(s => (s?.color === undefined ? [] : [s.color]))
  const free = SOURCE_PALETTE.filter(c => !taken.some(t => sameColor(t, c)))
  let next = 0
  return sources.map(s => s?.color ?? free[Math.min(next++, free.length - 1)] ?? SOURCE_PALETTE[0])
}

/**
 * What a run is turned up on. A run with one source is one dial; a run that adds others is one dial for each run it can add (at least two, else the run can't be played and this
 * is undefined); a run tested together is one for each source. Undefined too for an id that isn't a run. The loads of a dial are the tested ones, so a position on it can be
 * any fraction of an index into them.
 */
export function dialsOf(runs: Record<string, Run>, id: string): { mode: Mode; dials: Dial[] } | undefined {
  if (!Object.hasOwn(runs, id)) return undefined
  const run = runs[id]
  const loads = (r: Run): number[] => r.levels.map(l => l.load)
  if (run.adds !== undefined) {
    const parts = run.adds.filter(part => whyNotAdded(runs, part) === undefined)
    if (parts.length < 2) return undefined
    const colors = colorsOf(parts.map(part => runs[part].source))
    return { mode: 'added', dials: parts.map((part, i) => ({ id: part, name: runs[part].name, unit: runs[part].unit, values: loads(runs[part]), ...(runs[part].source ? { source: runs[part].source } : {}), color: colors[i] })) }
  }
  if (run.sources !== undefined) {
    const ids = Object.keys(run.sources)
    const colors = colorsOf(ids.map(sid => run.sources![sid].source))
    return {
      mode: 'tested',
      dials: ids.map((sid, i) => {
        const info = run.sources![sid]
        const values = [...new Set(run.levels.map(l => l.loads?.[sid] ?? 0))].sort((a, b) => a - b)
        return { id: sid, name: info.name, unit: info.unit, values, ...(info.source ? { source: info.source } : {}), color: colors[i] }
      }),
    }
  }
  return { mode: 'single', dials: [{ id: '', name: run.name, unit: run.unit, values: loads(run), ...(run.source ? { source: run.source } : {}), color: run.source?.color ?? SOURCE_PALETTE[0] }] }
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
  for (const [sid, info] of Object.entries(run.sources ?? {})) if (info.entry !== undefined && !getObject(model, info.entry)) once(`source ${sid}: entry "${info.entry}" is not an object`)
  for (const level of run.levels) {
    for (const oid of Object.keys(level.objects)) if (!getObject(model, oid)) once(`unknown object "${oid}"`)
    for (const { from, to } of level.connections) {
      const unknown = [from, to].filter(end => !getObject(model, end))
      for (const end of unknown) once(`unknown object "${end}"`)
      if (unknown.length === 0 && !model.connections.some(c => c.from === from && c.to === to)) once(`${from} → ${to} is not a connection in the model`)
    }
  }
  // A shape deleted after the run was written shows up here at the next load, never as a crash: runs are outside the edit pipeline.
  for (const e of eventsOf(run)) if (!getObject(model, e.on)) once(`unknown object "${e.on}"`)
  return problems
}

/** The events at or before time `x`, in time order. None for a load run, and for a time that is not a number. */
export function eventsPassed(run: Run, x: number): RunEvent[] {
  return eventsOf(run).filter(e => e.at <= x)
}

/**
 * Where each shape a time run has an event for stands at time `x`: the latest event at or before it, and of two at one time the later in the file.
 * Running is an entry like the others, so the shape shows itself and not what is inside it (see marksOf). A shape with no event yet is not in it.
 * Nothing is stored between times, so any time can be asked for in any order.
 */
export function runStates(run: Run, x: number): States {
  const out: States = {}
  for (const e of eventsPassed(run, x)) Object.defineProperty(out, e.on, { value: e.state, enumerable: true, writable: true, configurable: true })
  return out
}

/** What an event says: its own text, else the shape and the state the way a person reads them ("Stripe: Stopped"). `nameOf` turns a shape id into the name a reader sees. */
export const eventText = (e: RunEvent, nameOf: (id: string) => string): string => (e.text !== '' ? e.text : `${nameOf(e.on)}: ${STATE_LABELS[e.state]}`)

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
    const pick = (l: Level) => l.connections.find(c => c.from === from && c.to === to)
    const m = metricsAt(levels, pick, EDGE_KEYS, at)
    const failure = failureAt(levels, pick, at)
    if (Object.keys(m).length > 0) connections.push({ from, to, ...m, ...(failure === undefined ? {} : { failure }) })
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
  const sizes = new Map<string, Sizes>()
  for (const c of level.connections) {
    if (!model.connections.some(m => m.from === c.from && m.to === c.to)) continue
    const ends = placeEnds(model, view, c.from, c.to)
    if (!ends) continue
    const key = JSON.stringify(ends)
    const so = lines.get(key)
    const size = sizes.get(key) ?? { weighted: 0, weight: 0, sum: 0, n: 0, failures: [] }
    sizes.set(key, size)
    if (c.bytes !== undefined) {
      size.sum += c.bytes
      size.n++
      if (c.rate !== undefined) {
        size.weighted += c.bytes * c.rate
        size.weight += c.rate
      }
    }
    if (c.failure !== undefined && !size.failures.includes(c.failure)) size.failures.push(c.failure)
    lines.set(key, {
      from: ends[0], to: ends[1],
      ...defined({ rate: either(so?.rate, c.rate, add), p50: either(so?.p50, c.p50, Math.max), p95: either(so?.p95, c.p95, Math.max), errors: either(so?.errors, c.errors, Math.max) }),
    })
  }
  return { objects, lines: [...lines].map(([key, line]) => withSizes(line, sizes.get(key)!)) }
}

/** What the connections that land on one line say about the size of a call and how its failing share fails, as rollUp collects them. */
type Sizes = { weighted: number; weight: number; sum: number; n: number; failures: Failure[] }

/**
 * A rolled-up line with its size of a call and how it fails. Bytes is the mean of the connections that give one, weighted by their rates
 * (a connection with no rate has no weight; with no rates at all it is the plain mean). The failure style is the one the connections that name one
 * agree on; if they differ there is none, and a connection that names none doesn't veto.
 */
function withSizes(line: Pair, size: Sizes): Pair {
  const bytes = size.weight > 0 ? size.weighted / size.weight : size.n > 0 ? size.sum / size.n : undefined
  const { from, to, rate, p50, p95, errors } = line
  return { from, to, ...defined({ rate, bytes, p50, p95, errors }), ...(size.failures.length === 1 ? { failure: size.failures[0] } : {}) }
}

/** A shape this strained is "struggling" (see knee). */
export const KNEE_STRAIN = 0.85
/** Overall p95 this many times the lowest level's counts as latency giving way. */
export const KNEE_LATENCY = 3

/** Where a run first struggles: a tested level, and either the object that is worst there or, with none to blame, the latency. */
export type Knee =
  | { index: number; load: number; by: { id: string; kind: 'util' | 'errors'; share: number } }
  | { index: number; load: number; latency: { from: number; to: number } }

/**
 * The first tested level where an object's strain reaches KNEE_STRAIN, naming the worst one there; failing that, the
 * first where overall p95 is KNEE_LATENCY times the lowest level's. Undefined when the run never struggles. It looks
 * at the objects that were measured, not at what holds them: the object to name is the one that was measured.
 */
export function knee(run: Run): Knee | undefined {
  const base = run.levels[0].overall.p95
  for (const [index, level] of run.levels.entries()) {
    let worst: { id: string; kind: 'util' | 'errors'; share: number; value: number } | undefined
    for (const [id, m] of Object.entries(level.objects)) {
      const s = strain(m)
      if (s && (worst === undefined || s.value > worst.value)) worst = { id, kind: s.by, share: s.share, value: s.value }
    }
    if (worst && worst.value >= KNEE_STRAIN) return { index, load: level.load, by: { id: worst.id, kind: worst.kind, share: worst.share } }
    const p95 = level.overall.p95
    if (base !== undefined && base > 0 && p95 !== undefined && p95 >= KNEE_LATENCY * base) return { index, load: level.load, latency: { from: base, to: p95 } }
  }
  return undefined
}

const pct = (n: number) => `${Math.round(n * 100)}%`

/** The sentence under the Performance tab's strip, for both readers. `nameOf` turns an object id into the name a reader sees. */
export function kneeText(run: Run, k: Knee, nameOf: (id: string) => string): string {
  const at = `${k.load} ${run.unit}`
  if ('by' in k) return `First struggles at ${at}: ${nameOf(k.by.id)} ${k.by.kind === 'util' ? `at ${pct(k.by.share)} of capacity` : `failing ${pct(k.by.share)} of calls`}`
  return `First struggles at ${at}: the slowest 5% of calls go from ${Math.round(k.latency.from)} ms to ${Math.round(k.latency.to)} ms`
}

export type BoxTraffic = { strain?: number; queue: number }
/**
 * How a line looks: how thick, how many particles a second, how long one takes to cross (ms), and the share of them that fail.
 * What a run's source adds is left out when it adds nothing, so a run without one is described as it always was: `color` (as written),
 * `radius` (times the usual dot's radius), `capped` (the count was scaled down to fit the screen), `failure` (how the failing share fails)
 * and `dots` (how many are on the line at once, once the `dot` formula has decided and the cap has had its say).
 */
export type LineTraffic = {
  from: string; to: string; width: number; perSecond: number; travelMs: number; failed: number
  color?: string; radius?: number; capped?: true; failure?: Failure; dots?: number
}
export type Traffic = { boxes: Record<string, BoxTraffic>; lines: LineTraffic[] }

/**
 * Most dots a source puts on a line at once. A screen line is a hundred to three hundred pixels long and a dot is a few pixels across, so
 * past about this many they run together and stop being countable. Past it a line is scaled down and says so (see capCounts).
 */
export const AT_ONCE = 24
/** The radius of a dot, as a multiple of the usual one, is the square root of the `size` formula's area, kept between these: small enough to see, big enough not to cover a line. */
export const RADIUS_MIN = 0.5
export const RADIUS_MAX = 2.5

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The dot counts of the sources on one line, scaled down by one common factor when the busiest passes AT_ONCE, so their ratio stays true.
 * Part 3a has one source on a line; the list is here for the several of Part 3b.
 */
export function capCounts(counts: number[]): { counts: number[]; capped: boolean } {
  const most = Math.max(0, ...counts)
  if (most <= AT_ONCE) return { counts, capped: false }
  return { counts: counts.map(c => (c * AT_ONCE) / most), capped: true }
}

/** The crossing time of a line in ms: what its expected call says, in steps from half a second to four. A line with no p50 is a middling trip. */
const travelOf = (p50: number | undefined): number => (p50 === undefined ? 1000 : Math.round(clamp(500 + 1000 * Math.log10(1 + p50 / 10), 500, 4000)))

/** A line that carried `rate` calls a second. Starting values, tuned on the lab's run in phase 3; a screen can't draw 1000 particles a second, so these are logarithmic and capped. */
function lineTraffic(l: Pair, rate: number, source: Source | undefined): LineTraffic {
  const errors = round2(l.errors ?? 0)
  const base: LineTraffic = {
    from: l.from,
    to: l.to,
    width: round2(clamp(1.5 + 1.5 * Math.log10(1 + rate), 1.5, 6)),
    perSecond: rate > 0 ? round2(clamp(1.5 + 4 * Math.log10(1 + rate), 1.5, 14)) : 0,
    travelMs: travelOf(l.p50),
    failed: errors >= 0.01 ? Math.max(errors, 0.05) : errors,
  }
  if (source?.color !== undefined) base.color = source.color
  if (l.failure !== undefined) base.failure = l.failure
  const vars = { rate, bytes: l.bytes, p50: l.p50 }
  // How many dots: the formula's count when it has a value (a missing number or a negative result leaves today's curve for this line).
  const dot = source?.dot ? formulaOf(source.dot) : undefined
  const count = dot ? evalFormula(dot, vars) : undefined
  if (count !== undefined && count >= 0) {
    const { counts, capped } = capCounts([count])
    // The count is dots on the line at once; the speed stays with p50, so dots start as often as they take to cross.
    base.perSecond = round2(counts[0] / (base.travelMs / 1000))
    base.dots = round2(counts[0])
    if (capped) base.capped = true
  }
  const size = source?.size ? formulaOf(source.size) : undefined
  const area = size ? evalFormula(size, vars) : undefined
  if (area !== undefined && area >= 0) base.radius = round2(clamp(Math.sqrt(area), RADIUS_MIN, RADIUS_MAX))
  return base
}

/**
 * Everything the Performance tab draws for one view at one load, as plain numbers so a renderer needs no logic.
 * `boxes` has the strain (0 green to 1 red, left out when nothing was measured) and queue of each shape that was
 * measured or holds something that was; `lines` has the traffic on each line that has a rate. Shapes and lines
 * with nothing measured are left out: they stay neutral, never drawn as zero. `load` is clamped to the tested range.
 */
export function traffic(model: Model, run: Run, load: number, view: string): Traffic {
  const { objects, lines } = rollUp(model, interpolate(run, load), view)
  const boxes: Record<string, BoxTraffic> = {}
  for (const [id, m] of Object.entries(objects)) {
    const s = strain(m)?.value
    if (s === undefined && m.queue === undefined) continue
    put(boxes, id, { ...(s === undefined ? {} : { strain: round2(s) }), queue: Math.round(m.queue ?? 0) })
  }
  return { boxes, lines: lines.flatMap(l => (l.rate === undefined ? [] : [lineTraffic(l, l.rate, run.source)])) }
}

/** The number in a scale, as short as it reads: 50, 0.5, 12.5, with the float noise of a division (3.0000000000000004) rounded off. */
const plain = (n: number): string => String(Number(n.toPrecision(6)))

/**
 * "1 dot = 50 calls/s" for a run whose `dot` formula is a constant times the rate and nothing else; undefined for any other, because a scale in
 * words that is not true for every line is worse than none. Also undefined for a scale nobody reads (under a thousandth of a call or over a billion).
 */
export function scaleText(run: Run): string | undefined {
  const dot = run.source?.dot ? formulaOf(run.source.dot) : undefined
  const k = dot ? linearInRate(dot) : undefined
  if (k === undefined) return undefined
  const calls = 1 / k
  return calls >= 0.001 && calls < 1e9 ? `1 dot = ${plain(calls)} calls/s` : undefined
}

/**
 * The pieces the Performance key draws for a run's source, from the lines on screen now: its name and the colour of its dots; the scale in words when
 * the formula is a plain ratio of the rate and a line follows it; whether any dot is bigger or smaller than usual; whether any line is scaled down to
 * fit. Undefined when the run sets no source or no line is on screen, so the key shows only what the picture shows.
 */
export function sourceKey(run: Run, lines: LineTraffic[]): { name: string; color?: string; scale?: string; bigger: boolean; scaledDown: boolean } | undefined {
  if (!run.source || lines.length === 0) return undefined
  const scale = lines.some(l => l.dots !== undefined) ? scaleText(run) : undefined
  return {
    name: run.name,
    ...(run.source.color === undefined ? {} : { color: run.source.color }),
    ...(scale === undefined ? {} : { scale }),
    bigger: lines.some(l => l.radius !== undefined),
    scaledDown: lines.some(l => l.capped === true),
  }
}
