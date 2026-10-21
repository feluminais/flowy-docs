import type { Problem } from '../problem.ts'
import { FILE_KINDS, pathOf } from '../filekinds.ts'
import { parseFormula } from '../formula.ts'
import { isColor } from '../look.ts'
import { ID_RULE, isValidId, orEmpty, ParseError } from '../model.ts'
import { readYaml } from '../yamltext.ts'
import { isMap } from '../text.ts'
import { isStateName, STATE_NAMES } from '../states.ts'
import { AXES, FAILURES } from './types.ts'
import type { Axis, Failure, Level, Metrics, Pair, Run, RunEvent, Source, SourceFormula, SourceInfo } from './types.ts'
import { BY_KEYS, brief, EDGE_KEYS, OBJECT_KEYS, put } from './util.ts'
import { sharedColors } from './sources.ts'

/** Reading and validating a run file (`perf/<id>.yaml`). */

/** The lowest and highest a metric may be. */
const RANGE: Record<keyof Metrics, readonly [number, number]> = {
  util: [0, 1], errors: [0, 1], queue: [0, Infinity], rate: [0, Infinity], bytes: [0, Infinity], p50: [0, Infinity], p95: [0, Infinity],
}
const SOURCE_KEYS = ['color', 'dot', 'size'] as const
/** What a tested-together source may say: its own name, entry and unit, and the three of a single run's `source:`. */
const SOURCE_INFO_KEYS = ['name', 'entry', 'unit', ...SOURCE_KEYS] as const
/** Most runs one run may add, and most sources a run may be tested with. */
export const MOST_ADDED = 4
export const MOST_TESTED = 3

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
  const file = pathOf(FILE_KINDS.run, id)
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
    add(`adds: at most four runs, so ${out.slice(MOST_ADDED).map(brief).join(', ')} left out`)
    out.length = MOST_ADDED
  }
  if (out.length < 2) throw new ParseError(file, `adds needs two to four runs, not ${out.length}`)
  return out
}

/**
 * The `sources:` of a run tested together: 2 to MOST_TESTED, each a mapping with a name, a unit, an entry and the colour and formulas of a single run's source. A slip in one is a
 * problem and is left out of it. What can't be played is a ParseError: not a mapping, the wrong count, an id that isn't one, a source that isn't a mapping.
 */
function readSources(file: string, raw: unknown, add: (message: string) => void): Record<string, SourceInfo> {
  if (!isMap(raw)) throw new ParseError(file, '"sources" must map each source id to its name, unit and entry')
  const ids = Object.keys(raw)
  if (ids.length < 2 || ids.length > MOST_TESTED) throw new ParseError(file, `sources needs two or three sources, not ${ids.length}`)
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
