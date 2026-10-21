import type { Model } from '../../src/core/model.ts'
import { interpolate, rollUp } from '../../src/core/perf.ts'
import type { Metrics, Run } from '../../src/core/perf.ts'

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

/** The position `ms` further on in a ramp (it stops at the last level). */
export const rampPos = (run: Run, pos: number, ms: number): number => clampPos(run, pos + (ms * top(run)) / RAMP_MS)

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
export const LINE_KEYS = ['rate', 'p50', 'p95', 'errors'] as const

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
export const yAt = (box: Area, scale: Scale, v: number): number => box.y + box.height * (1 - place(scale, v))

const round1 = (n: number) => Math.round(n * 10) / 10

/** A curve through the values as SVG path data, one point to each level, broken where a level has no number. */
export function pathOf(values: readonly (number | undefined)[], scale: Scale, box: Area): string {
  let d = ''
  let pen = false
  values.forEach((v, i) => {
    if (v === undefined || !Number.isFinite(v)) {
      pen = false
      return
    }
    d += `${pen ? 'L' : 'M'}${round1(xAt(box, i, values.length))} ${round1(yAt(box, scale, v))}`
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

/** The labels under the levels: every level's load, or every few when there would be too many to read. */
export function levelLabels(run: Run, box: Area, most = 8): { x: number; label: string }[] {
  const n = run.levels.length
  const every = Math.ceil(n / most)
  return run.levels.flatMap((l, i) => (i % every === 0 || i === n - 1 ? [{ x: round1(xAt(box, i, n)), label: String(l.load) }] : []))
}

// ---- Readings

/** What each tested level says about an object, key by key, as the view draws it (a shape that holds others takes the worst of what is inside). */
export function boxSeries(model: Model, run: Run, view: string, id: string, key: keyof Metrics): (number | undefined)[] {
  return run.levels.map(l => {
    const { objects } = rollUp(model, l, view)
    return Object.hasOwn(objects, id) ? objects[id][key] : undefined
  })
}

/** The same for the line a view draws between two shapes. */
export function lineSeries(model: Model, run: Run, view: string, from: string, to: string, key: keyof Metrics): (number | undefined)[] {
  return run.levels.map(l => rollUp(model, l, view).lines.find(p => p.from === from && p.to === to)?.[key])
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
