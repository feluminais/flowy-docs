import { colorPair } from '../../src/core/look.ts'
import type { Model } from '../../src/core/model.ts'
import { eventsOf, interpolate, isTime, levelAt, loadOfPosition, lockstepPositions, rollUp, settingAt } from '../../src/core/perf.ts'
import type { Dial, Knee, Level, LineTraffic, Metrics, Mode, Run, RunEvent, Setting } from '../../src/core/perf.ts'

export { isTime }

/** The maths and the words of the Performance tab, kept apart from the drawing so the node tests can run them. No DOM in here. */

/** How long Ramp takes to sweep from the first tested level to the last, whatever the number of levels. */
export const RAMP_MS = 30_000

/**
 * How often a ramp gives the screen a new position, in ms. A view of a hundred shapes takes about 25 ms to draw again, so drawing it on every frame
 * would leave no time for anything else; the particles still move on every frame, and the colours and thickness ease between positions.
 */
export const RAMP_STEP_MS = 50

/** The top of the slider: the position of the last level. A position is a place along the tested levels: 0 is the first, 1.5 halfway from the second to the third. */
export const top = (run: Run): number => run.levels.length - 1

export const clampPos = (run: Run, pos: number): number => Math.min(top(run), Math.max(0, Number.isFinite(pos) ? pos : 0))

/** The load at a position: a tested level's own load exactly, and a straight line between two. */
export function loadAt(run: Run, pos: number): number {
  const p = clampPos(run, pos)
  const i = Math.min(top(run) - 1, Math.floor(p))
  const [a, b] = [run.levels[i].load, run.levels[i + 1].load]
  return a + (b - a) * (p - i)
}

/** Whether a position is a tested level, not somewhere between two. */
export const isTested = (pos: number): boolean => Math.abs(pos - Math.round(pos)) < 1e-6

/**
 * The position of a time or load `x`, the other way round from loadAt: a tested level's own number is its whole position, and between two it is a straight line.
 * Outside the run it is the nearest end; a time that is not finite is the start, as for clampPos.
 */
export function posAt(run: Run, x: number): number {
  const { levels } = run
  if (!Number.isFinite(x) || x <= levels[0].load) return 0
  if (x >= levels[top(run)].load) return top(run)
  for (let i = 0; i < top(run); i++) {
    if (x < levels[i + 1].load) return i + (x - levels[i].load) / (levels[i + 1].load - levels[i].load)
  }
  return top(run)
}

/** The time or load at a position (the same as loadAt, named for the way round that goes with posAt). */
export const xOfPos = (run: Run, pos: number): number => loadAt(run, pos)

/** How wide a run is: from its first level's time or load to its last's. */
const span = (run: Run): number => run.levels[top(run)].load - run.levels[0].load

/** Where a time or load sits along the run, 0 to 1, by time or load itself and not by level. */
const along = (run: Run, x: number): number => (x - run.levels[0].load) / span(run)

/**
 * Where the slider's thumb is, 0 to 1 along it. A time run's slider is linear in time, so a level sits where its time is and an event on its own time. A load run's
 * is even, a step to each level, whatever the loads are.
 */
export function sliderFraction(run: Run, pos: number): number {
  if (isTime(run)) return Math.min(1, Math.max(0, along(run, xOfPos(run, pos))))
  return top(run) === 0 ? 0 : clampPos(run, pos) / top(run)
}

/** The events of a time run with where each sits along the slider, 0 to 1, in time order. Nothing for a load run. */
export function eventFractions(run: Run): { fraction: number; event: RunEvent }[] {
  if (!isTime(run)) return []
  return eventsOf(run).map(event => ({ fraction: Math.min(1, Math.max(0, along(run, event.at))), event }))
}

/** The events of a time run as the panel lists them, in time order: whether each has happened by `x`, and which is the latest that has. */
export function eventRows(run: Run, x: number): { event: RunEvent; passed: boolean; current: boolean }[] {
  const events = eventsOf(run)
  const done = events.filter(e => e.at <= x).length // in time order, so the ones that have happened come first
  return events.map((event, i) => ({ event, passed: i < done, current: i === done - 1 }))
}

/** What the slider's own numbers run between: a time run's are times, a load run's are positions. */
export const sliderRange = (run: Run): { min: number; max: number } => (isTime(run) ? { min: run.levels[0].load, max: run.levels[top(run)].load } : { min: 0, max: top(run) })

/** The number the slider holds at a position (see sliderRange). */
export const sliderValue = (run: Run, pos: number): number => (isTime(run) ? xOfPos(run, pos) : clampPos(run, pos))

/** The position a dragged slider stands for. A time run goes where it is put, so an event can be stood on; a load run snaps to a tested level. */
export const slidePos = (run: Run, value: number): number => (isTime(run) ? posAt(run, value) : snap(run, value))

/** The position `ms` further on in a ramp (it stops at the last level). A time run goes on evenly in time, a load run evenly from level to level. */
export const rampPos = (run: Run, pos: number, ms: number): number =>
  isTime(run) ? posAt(run, xOfPos(run, pos) + (ms * span(run)) / RAMP_MS) : clampPos(run, pos + (ms * top(run)) / RAMP_MS)

/** Where a ramp starts: from the bottom when it is at the top already, else from where it is. */
export const rampFrom = (run: Run, pos: number): number => (pos >= top(run) ? 0 : pos)

/** The run the tab shows: the one asked for if there is such a run, else the first, else none (a run can come and go while the tab is open). */
export const activeRun = (runs: Record<string, Run>, id: string): string => (Object.hasOwn(runs, id) ? id : Object.keys(runs)[0] ?? '')

/** A position as the slider can hold it, snapped to a tested level. */
export const snap = (run: Run, pos: number): number => Math.round(clampPos(run, pos))

// ---- Numbers in words

const trim = (n: number, places: number): string => String(Number(n.toFixed(places)))

/** A latency: "4.2 ms", "180 ms", "2.4 s". */
export function fmtMs(ms: number): string {
  if (ms >= 1000) return `${trim(ms / 1000, 1)} s`
  return `${trim(ms, ms < 10 ? 1 : 0)} ms`
}
export const fmtPct = (share: number): string => `${trim(share * 100, share < 0.1 ? 1 : 0)}%`
export const fmtRate = (rate: number): string => `${trim(rate, rate < 10 ? 1 : 0)} calls a second`
/** The size of a call: "400 B", "1.5 KB", "2.4 MB" (a thousand to the step, like the numbers a formula is written in). */
export function fmtBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${trim(bytes / 1_000_000, bytes < 10_000_000 ? 1 : 0)} MB`
  if (bytes >= 1000) return `${trim(bytes / 1000, bytes < 10_000 ? 1 : 0)} KB`
  return `${trim(bytes, bytes < 10 ? 1 : 0)} B`
}
/** A load with its unit: "200 req/s". */
export const fmtLoad = (load: number, unit: string): string => `${trim(load, load < 10 ? 1 : 0)} ${unit}`

/** How each number is named and written in the panel, and how its curve is drawn: against zero or on a scale of powers of ten. A `max` fixes the top of the scale. */
export const METRICS: Record<keyof Metrics, { label: string; show: (v: number) => string; log?: boolean; max?: number }> = {
  util: { label: 'Busy', show: fmtPct, max: 1 },
  queue: { label: 'Waiting', show: v => String(Math.round(v)) },
  errors: { label: 'Failing', show: fmtPct },
  rate: { label: 'Calls', show: fmtRate },
  bytes: { label: 'Size of a call', show: fmtBytes },
  p50: { label: 'Expected call', show: fmtMs, log: true },
  p95: { label: 'Slowest 5%', show: fmtMs, log: true },
}
/** The numbers a shape can have, and a line, in the order the panel lists them. */
export const BOX_KEYS = ['util', 'queue', 'errors'] as const
export const LINE_KEYS = ['rate', 'bytes', 'p50', 'p95', 'errors'] as const

// ---- Curves

/** What a curve is drawn on: the lowest and highest value, and whether the way up is a power of ten each step. */
export type Scale = { lo: number; hi: number; log: boolean }
export type Area = { x: number; y: number; width: number; height: number }

/** A scale that holds every number in `values`. A log one runs from a power of ten below the smallest to one above the largest. */
export function scaleOf(values: readonly (number | undefined)[], options: { log?: boolean; from?: number; to?: number } = {}): Scale {
  const seen = values.filter((v): v is number => v !== undefined && Number.isFinite(v) && (!options.log || v > 0))
  if (options.log) {
    const lo = Math.floor(Math.log10(Math.min(...(seen.length ? seen : [1]))))
    const hi = Math.ceil(Math.log10(Math.max(...(seen.length ? seen : [10]))))
    return { lo, hi: hi === lo ? lo + 1 : hi, log: true }
  }
  const lo = options.from ?? 0
  const hi = options.to ?? Math.max(...(seen.length ? seen : [1]))
  return { lo, hi: hi === lo ? lo + 1 : hi, log: false }
}

const place = (scale: Scale, v: number): number => {
  const f = scale.log ? (Math.log10(Math.max(v, 10 ** scale.lo)) - scale.lo) / (scale.hi - scale.lo) : (v - scale.lo) / (scale.hi - scale.lo)
  return Math.min(1, Math.max(0, f))
}
/** Where level `i` of `n` sits across `box`: evenly spaced, so a run that goes 10, 25, 50, 100, 200, 400 reads as steps, not as a crowd and a gap. */
export const xAt = (box: Area, i: number, n: number): number => box.x + (n <= 1 ? 0 : (box.width * i) / (n - 1))
/** Where level `i` of a run sits across `box`: evenly for a load run, as xAt has it, and by its time for a time run. */
export const levelX = (run: Run, box: Area, i: number): number => (isTime(run) ? box.x + box.width * along(run, run.levels[i].load) : xAt(box, i, run.levels.length))
/** Where a position sits across `box`, for the cursor of a curve. */
export const cursorX = (run: Run, box: Area, pos: number): number => (isTime(run) ? box.x + box.width * sliderFraction(run, pos) : xAt(box, pos, run.levels.length))
export const yAt = (box: Area, scale: Scale, v: number): number => box.y + box.height * (1 - place(scale, v))

const round1 = (n: number) => Math.round(n * 10) / 10

/** A curve through the values as SVG path data, one point to each level, broken where a level has no number. Given a time run, the points sit at their times, not evenly. */
export function pathOf(values: readonly (number | undefined)[], scale: Scale, box: Area, run?: Run): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === undefined || !Number.isFinite(v)) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${round1(run && isTime(run) ? levelX(run, box, i) : xAt(box, i, values.length))} ${round1(yAt(box, scale, v))}`
    pen = true
  })
  return d
}

/** The power-of-ten gridlines of a log scale, with their words: "10 ms", "1 s". */
export function gridOf(scale: Scale, box: Area): { y: number; label: string }[] {
  const out: { y: number; label: string }[] = []
  for (let e = scale.lo; e <= scale.hi; e++) out.push({ y: round1(yAt(box, scale, 10 ** e)), label: fmtMs(10 ** e) })
  return out
}

/** How near two labels may be along a time run's slider (a fraction of its width) before the later one is left out. */
const LABEL_GAP = 0.08

/**
 * The levels that get a label: every one, or every few when there would be too many to read. The last is always named. In a time run levels can sit close
 * together, so one that would land on the label before it is left out, and the last takes the place of those it would cover.
 */
function labelled(run: Run, most: number): number[] {
  const n = run.levels.length
  const every = Math.ceil(n / most)
  const wanted = run.levels.flatMap((_, i) => (i % every === 0 || i === n - 1 ? [i] : []))
  if (!isTime(run)) return wanted
  const at = (i: number) => along(run, run.levels[i].load)
  const shown: number[] = []
  for (const i of wanted) {
    if (shown.length > 0 && at(i) - at(shown[shown.length - 1]) < LABEL_GAP) {
      if (i !== n - 1) continue
      while (shown.length > 1 && at(i) - at(shown[shown.length - 1]) < LABEL_GAP) shown.pop()
    }
    shown.push(i)
  }
  return shown
}

/** The labels under the levels: every level's load, or every few when there would be too many to read. */
export function levelLabels(run: Run, box: Area, most = 8): { x: number; label: string }[] {
  return labelled(run, most).map(i => ({ x: round1(levelX(run, box, i)), label: String(run.levels[i].load) }))
}

/** The labels under the slider: a level's time or load at its place along it (0 to 1), thinned the way levelLabels is. */
export function tickLabels(run: Run, most = 8): { fraction: number; label: string }[] {
  return labelled(run, most).map(i => ({ fraction: isTime(run) ? along(run, run.levels[i].load) : top(run) === 0 ? 0 : i / top(run), label: String(run.levels[i].load) }))
}

// ---- Readings

/** What each tested level says about an object, key by key, as the view draws it (a shape that holds others takes the worst of what is inside). */
export function boxSeries(model: Model, run: Run, view: string, id: string, key: keyof Metrics): (number | undefined)[] {
  return boxSeriesIn(model, run.levels, view, id, key)
}

/** The same for the line a view draws between two shapes. */
export function lineSeries(model: Model, run: Run, view: string, from: string, to: string, key: keyof Metrics): (number | undefined)[] {
  return lineSeriesIn(model, run.levels, view, from, to, key)
}

/** An object's number at each of these levels (the levels of a run, or of a run with several sources along one dial: see activeSeries). */
export function boxSeriesIn(model: Model, levels: readonly Level[], view: string, id: string, key: keyof Metrics): (number | undefined)[] {
  return levels.map(l => {
    const { objects } = rollUp(model, l, view)
    return Object.hasOwn(objects, id) ? objects[id][key] : undefined
  })
}

/** The same for the line a view draws between two shapes. */
export function lineSeriesIn(model: Model, levels: readonly Level[], view: string, from: string, to: string, key: keyof Metrics): (number | undefined)[] {
  return levels.map(l => rollUp(model, l, view).lines.find(p => p.from === from && p.to === to)?.[key])
}

/** An object's numbers at a load, or undefined when nothing was measured on it. */
export function boxAt(model: Model, run: Run, view: string, id: string, load: number): Metrics | undefined {
  const { objects } = rollUp(model, interpolate(run, load), view)
  return Object.hasOwn(objects, id) ? objects[id] : undefined
}

/** A line's numbers at a load. */
export function lineAt(model: Model, run: Run, view: string, from: string, to: string, load: number): Metrics | undefined {
  return rollUp(model, interpolate(run, load), view).lines.find(p => p.from === from && p.to === to)
}

// ---- Colour and key

/** A source's colour as CSS: a named colour in both themes through light-dark(), a hex as it is. Undefined for text that is neither. */
export function sourceCss(color: string | undefined): string | undefined {
  const pair = colorPair(color)
  return pair === undefined ? undefined : pair[0] === pair[1] ? pair[0] : `light-dark(${pair[0]}, ${pair[1]})`
}

/**
 * Which kinds of failing call are on the lines now, for the key to draw: the usual fade (for a line that fails without saying how, and also while
 * no line fails, so the key of a run that sets nothing is as it was), a lost call, a rejected one.
 */
export function failureMarks(lines: readonly Pick<LineTraffic, 'failed' | 'failure'>[]): { fade: boolean; lost: boolean; rejected: boolean } {
  const failing = lines.filter(l => l.failed > 0)
  return {
    fade: failing.length === 0 || failing.some(l => l.failure === undefined),
    lost: failing.some(l => l.failure === 'lost'),
    rejected: failing.some(l => l.failure === 'rejected'),
  }
}

// ---- Several dials

/**
 * Where each dial of a run stands, one position for each, in dial order. A position is a place along that dial's tested loads: 0 is the first, 1.5 halfway from the second to the third
 * (the same as a single run's position). A run with one source has one dial.
 */
export type Positions = number[]

/** The top of a dial's slider: the position of its last tested load. */
export const dialTop = (d: Dial): number => d.values.length - 1

export const clampDial = (d: Dial, pos: number): number => Math.min(dialTop(d), Math.max(0, Number.isFinite(pos) ? pos : 0))

/** The setting that puts every dial at its position (see settingAt). */
export const settingOf = (dials: readonly Dial[], positions: Positions): Setting => settingAt(dials, positions)

/** The position of a load along a dial, the other way round from loadOfPosition: a tested load is its whole position, and between two it is a straight line. Outside the loads it is the nearest end. */
export function positionOf(d: Dial, x: number): number {
  const top = dialTop(d)
  if (!Number.isFinite(x) || x <= d.values[0]) return 0
  if (x >= d.values[top]) return top
  for (let i = 0; i < top; i++) if (x < d.values[i + 1]) return i + (x - d.values[i]) / (d.values[i + 1] - d.values[i])
  return top
}

/** The positions of a setting, one for each dial; a dial it doesn't name is at its lowest load. */
export const positionsOf = (dials: readonly Dial[], setting: Setting): Positions => dials.map(d => positionOf(d, Object.hasOwn(setting, d.id) ? setting[d.id] : Number.NaN))

/**
 * Where the tab opens: at the first struggle when every dial rises together (the knee's step, each dial along its own loads), else every dial at its top, as a single run opens.
 * `knee` is what kneeOf found for the run, if anything.
 */
export function openingPositions(dials: readonly Dial[], knee?: Pick<Knee, 'index'>): Positions {
  return knee === undefined ? dials.map(dialTop) : lockstepPositions(dials, knee.index)
}

/** `positions` with the dial `active` at `pos` (kept inside the dial); the others stay where they are. */
export const placeActive = (dials: readonly Dial[], positions: Positions, active: number, pos: number): Positions =>
  positions.map((p, i) => (i === active ? clampDial(dials[i], pos) : p))

/** The whole-number position one step on from `pos` in `direction` (1 or -1): the next tested load, or the one before, even when `pos` is between two. */
export const stepFrom = (pos: number, direction: 1 | -1): number => (direction === 1 ? Math.floor(pos + 1e-6) + 1 : Math.ceil(pos - 1e-6) - 1)

/** `positions` with the dial `active` one tested load further on (it stops at either end). Arrow keys. */
export const stepActive = (dials: readonly Dial[], positions: Positions, active: number, direction: 1 | -1): Positions =>
  placeActive(dials, positions, active, Math.round(clampDial(dials[active], stepFrom(positions[active], direction))))

/** `positions` with the dial `active` at its first or last tested load. Home and End. */
export const edgeActive = (dials: readonly Dial[], positions: Positions, active: number, edge: 'start' | 'end'): Positions =>
  placeActive(dials, positions, active, edge === 'start' ? 0 : dialTop(dials[active]))

/** `positions` with the dial `active` `ms` further on in a ramp (it stops at its last tested load). The others are held. */
export const rampActive = (dials: readonly Dial[], positions: Positions, active: number, ms: number): Positions =>
  placeActive(dials, positions, active, positions[active] + (ms * dialTop(dials[active])) / RAMP_MS)

/** Where a ramp of the dial `active` starts: from its bottom when it is at the top already, else from where it is. */
export const rampFromActive = (dials: readonly Dial[], positions: Positions, active: number): Positions =>
  positions[active] >= dialTop(dials[active]) ? placeActive(dials, positions, active, 0) : positions

/**
 * The level at each tested load of the dial `active`, with the others held where they stand: what the Strip and the small curves plot, as a single run plots the levels it was
 * tested at. One level for each load of the dial, in order.
 */
export function activeSeries(runs: Record<string, Run>, id: string, dials: readonly Dial[], positions: Positions, active: number): Level[] {
  const held = settingOf(dials, positions)
  const dial = dials[Math.min(dials.length - 1, Math.max(0, active))]
  return dial.values.map(v => levelAt(runs, id, { ...held, [dial.id]: v }))
}

/** The dials that are held while the Strip and the curves follow `active`, each with its name and where it stands in words: "Courier pings held at 100 pings/s". */
export function heldText(dials: readonly Dial[], positions: Positions, active: number): string[] {
  return dials.flatMap((d, i) => (i === active ? [] : [`${d.name} held at ${fmtLoad(loadOfPosition(d.values, positions[i]), d.unit)}`]))
}

/** The labels under a dial's slider: its tested loads at their places along it (0 to 1), every one, or every few when there would be too many to read. The last is always named. */
export function dialTicks(d: Dial, most = 8): { fraction: number; label: string }[] {
  const n = d.values.length
  const every = Math.ceil(n / most)
  return d.values.flatMap((v, i) => (i % every === 0 || i === n - 1 ? [{ fraction: n === 1 ? 0 : i / (n - 1), label: String(v) }] : []))
}

/** The tested loads either side of a position (the same when it is on one), for "Between 600 and 900, estimated". */
export function bracketOf(d: Dial, pos: number): { lower: number; upper: number; tested: boolean } {
  const top = dialTop(d)
  const p = clampDial(d, pos)
  return { lower: d.values[Math.min(top - 1, Math.floor(p))], upper: d.values[Math.min(top, Math.floor(p) + 1)], tested: isTested(p) }
}

/** What the panel says once, near the top, about how the sources were measured: nothing for a single run. */
export const modeLabel = (mode: Mode): string | undefined => (mode === 'added' ? 'Added from separate runs' : mode === 'tested' ? 'Tested together' : undefined)

/** What a shape's readout says when runs that were added made it pass its capacity, which one run never does: nothing for a share that is 1 or under, or for runs tested together. */
export const overText = (mode: Mode, util: number | undefined): string | undefined => (mode === 'added' && util !== undefined && util > 1 ? 'Added use is over 100%' : undefined)
