import { evalFormula } from '../formula.ts'
import type { Model } from '../model.ts'
import { strain } from './analyse.ts'
import { dialsOf } from './dials.ts'
import { interpolate, levelAt } from './levels.ts'
import { amountOf, callSize } from './measure.ts'
import type { Measure } from './measure.ts'
import { rollUpLoad } from './rollup.ts'
import { formulaOf } from './sources.ts'
import type { BoxTraffic, LineTraffic, Metrics, Pair, Run, Setting, Source, Traffic } from './types.ts'
import type { Dial } from './types.ts'
import { add, defined, own, put, round2, settingFor } from './util.ts'

/** What the canvas draws for a run: lines, dots and their tuning. */

/** The radius of a dot, as a multiple of the usual one, is the square root of the `size` formula's area, kept between these: small enough to see, big enough not to cover a line. */
export const RADIUS_MIN = 0.5
export const RADIUS_MAX = 2.5

/**
 * Most dots a source puts on a line at once. A screen line is a hundred to three hundred pixels long and a dot is a few pixels across, so
 * past about this many they run together and stop being countable. Past it a line is scaled down and says so (see capCounts).
 */
export const AT_ONCE = 24

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/**
 * The dot counts of the sources on one line, scaled down by one common factor when the busiest passes AT_ONCE, so their ratio stays true.
 * Part 3a has one source on a line; the list is here for the several of Part 3b.
 */
export function capCounts(counts: number[]): { counts: number[]; capped: boolean } {
  const most = Math.max(0, ...counts)
  if (most <= AT_ONCE) return { counts, capped: false }
  // Multiply first so a count keeps the exact value it always had; a huge count would overflow to Infinity, and then dividing first is the way.
  return { counts: counts.map(c => { const v = (c * AT_ONCE) / most; return Number.isFinite(v) ? v : (c / most) * AT_ONCE }), capped: true }
}

/** The crossing time of a line in ms: what its expected call says, in steps from half a second to four. A line with no p50 is a middling trip. */
const travelOf = (p50: number | undefined): number => (p50 === undefined ? 1000 : Math.round(clamp(500 + 1000 * Math.log10(1 + p50 / 10), 500, 4000)))

/** How many dots a source's `dot` formula puts on a line that carried `rate` calls a second, or undefined when it puts none (no formula, a missing number, a negative result). */
function dotsFor(l: Pair, rate: number, source: Source | undefined): number | undefined {
  const dot = source?.dot ? formulaOf(source.dot) : undefined
  const count = dot ? evalFormula(dot, { rate, bytes: l.bytes, p50: l.p50 }) : undefined
  return count !== undefined && count >= 0 ? count : undefined
}

/**
 * A line that carried `rate` calls a second. Starting values, tuned on the lab's run in phase 3; a screen can't draw 1000 particles a second, so these are logarithmic and capped.
 * `wide` is the rate that sets its thickness (a source's share of a shared line is as thick as the whole line), and `counted` is the count and the cap when
 * several sources share the line and were scaled together (see sharedLines).
 */
function lineTraffic(l: Pair, rate: number, source: Source | undefined, wide = rate, counted?: { dots: number | undefined; capped: boolean }, measure: Measure = 'calls'): LineTraffic {
  const errors = round2(l.errors ?? 0)
  const base: LineTraffic = {
    from: l.from,
    to: l.to,
    width: round2(clamp(1.5 + 1.5 * Math.log10(1 + wide), 1.5, 6)),
    perSecond: rate > 0 ? round2(clamp(1.5 + 4 * Math.log10(1 + rate), 1.5, 14)) : 0,
    travelMs: travelOf(l.p50),
    failed: errors >= 0.01 ? Math.max(errors, 0.05) : errors,
  }
  if (source?.color !== undefined) base.color = source.color
  if (l.failure !== undefined) base.failure = l.failure
  // How many dots: the formula's count when it has a value (a missing number or a negative result leaves today's curve for this line).
  const count = counted ? counted.dots : dotsFor(l, rate, source)
  if (count !== undefined) {
    const { counts, capped } = counted ? { counts: [count], capped: counted.capped } : capCounts([count])
    // The count is dots on the line at once; the speed stays with p50, so dots start as often as they take to cross.
    base.perSecond = round2(counts[0] / (base.travelMs / 1000))
    base.dots = round2(counts[0])
    if (capped) base.capped = true
  }
  // Under Data the size of a call is already in the count and the thickness, so a dot's size says nothing more: dots are the usual size.
  const size = measure === 'calls' && source?.size ? formulaOf(source.size) : undefined
  const area = size ? evalFormula(size, { rate, bytes: l.bytes, p50: l.p50 }) : undefined
  if (area !== undefined && area >= 0) base.radius = round2(clamp(Math.sqrt(area), RADIUS_MIN, RADIUS_MAX))
  return base
}

/**
 * Everything the Performance tab draws for one view at one load, as plain numbers so a renderer needs no logic.
 * `boxes` has the strain (0 green to 1 red, left out when nothing was measured) and queue of each shape that was
 * measured or holds something that was; `lines` has the traffic on each line that has a rate. Shapes and lines
 * with nothing measured are left out: they stay neutral, never drawn as zero. `load` is clamped to the tested range.
 */
export function traffic(model: Model, run: Run, load: number, view: string, measure: Measure = 'calls', size?: number): Traffic {
  const { objects, lines } = rollUpLoad(model, interpolate(run, load), view)
  return { boxes: boxesOf(objects), lines: lines.flatMap(l => { const amount = amountOf(l, measure, size); return amount === undefined ? [] : [lineTraffic(l, amount, run.source, amount, undefined, measure)] }) }
}

/**
 * What each shape looks like: its strain (0 green to 1 red, left out when nothing was measured) and its queue. A shape that is added past capacity (0.7 and 0.6 make 1.3) is as
 * strained as one that is full: the colour stops at 1, and the readout says the rest.
 */
function boxesOf(objects: Record<string, Metrics>): Record<string, BoxTraffic> {
  const boxes: Record<string, BoxTraffic> = {}
  for (const [id, m] of Object.entries(objects)) {
    const s = strain(m)?.value
    if (s === undefined && m.queue === undefined) continue
    put(boxes, id, { ...(s === undefined ? {} : { strain: round2(Math.min(1, s)) }), queue: Math.round(m.queue ?? 0) })
  }
  return boxes
}

/** The colour of a line that no source is said to carry: neutral, so it is never mistaken for one of them. */
export const OTHER_COLOR = 'gray'

/**
 * The traffic on one rolled-up line of a run with several sources: an entry for each source that carries something on it, in the colour, scale and size of that source. The sources
 * on a line are scaled by one common factor when the busiest passes AT_ONCE, so a line of ten times the calls still reads as ten times the dots; they run a little apart, so two on one
 * path don't hide each other. The line is as thick as everything it carries. A line the run doesn't split by source draws as it would for a run with no source, in a neutral colour.
 */
function sharedLines(l: Pair, dials: Dial[], measure: Measure, size: number | undefined): LineTraffic[] {
  const split = dials.flatMap(d => {
    const by = own(l.by, d.id)
    return by === undefined ? [] : [{ dial: d, by }]
  })
  const whole = amountOf(l, measure, size)
  if (split.length === 0) return whole === undefined ? [] : [{ ...lineTraffic(l, whole, undefined, whole, undefined, measure), color: OTHER_COLOR }]
  // What each source carries, as a rate. Under Data a source's size of a call is its own, and the whole line's only when the source is the only one named.
  const alone = split.length === 1
  const carried = split.flatMap(s => { const a = amountOf({ ...(s.by.rate === undefined && alone ? { rate: l.rate } : { rate: s.by.rate }), bytes: s.by.bytes ?? (alone ? l.bytes : undefined) }, measure, size); return a === undefined ? [] : [a] })
  const total = whole ?? (carried.length > 0 ? carried.reduce(add) : undefined)
  if (total === undefined) return []
  // A source's own numbers are its own. What it doesn't give is the line's where that is fair: the whole line when it is the only source named, the expected call always (it sets
  // only how fast dots cross), and the failing share when no source gives one (then the line's is the best guess for each). Never another source's size or failing share.
  const anyErrors = split.some(s => s.by.errors !== undefined)
  const rows = split.flatMap(({ dial, by }) => {
    const pairBytes = by.bytes ?? (alone ? l.bytes : undefined)
    const rate = measure === 'calls' ? (by.rate ?? (alone ? total : undefined)) : amountOf({ rate: by.rate ?? (alone ? l.rate : undefined), bytes: pairBytes }, measure, size)
    if (rate === undefined) return []
    const pair: Pair = {
      from: l.from, to: l.to,
      ...defined({ rate, bytes: pairBytes, p50: by.p50 ?? l.p50, errors: by.errors ?? (alone || !anyErrors ? l.errors : undefined) }),
      ...(l.failure === undefined ? {} : { failure: l.failure }),
    }
    return [{ dial, pair, rate, count: dotsFor(pair, rate, dial.source) }]
  })
  const capped = capCounts(rows.flatMap(r => (r.count === undefined ? [] : [r.count])))
  let next = 0
  return rows.map((r, i) => {
    const counted = r.count === undefined ? undefined : { dots: capped.counts[next++], capped: capped.capped }
    return {
      ...lineTraffic(r.pair, r.rate, r.dial.source, total, counted, measure),
      color: r.dial.color, source: r.dial.id,
      ...(rows.length > 1 ? { offset: i - (rows.length - 1) / 2 } : {}),
    }
  })
}

/**
 * Everything the Performance tab draws for one view at a setting of a run's dials, as traffic is for one source: the same for a run with one source (it is traffic), and for runs
 * with several the boxes of the combined level (strain stops at 1 however far over capacity they are added) and a line for each source on each line.
 */
export function trafficAt(model: Model, runs: Record<string, Run>, id: string, setting: Setting, view: string, measure: Measure = 'calls'): Traffic {
  const found = dialsOf(runs, id)
  if (!found) return { boxes: {}, lines: [] }
  const size = measure === 'data' ? callSize(runs, id) : undefined
  if (found.mode === 'single') return traffic(model, runs[id], settingFor(setting, ''), view, measure, size)
  const { objects, lines } = rollUpLoad(model, levelAt(runs, id, setting), view)
  return { boxes: boxesOf(objects), lines: lines.flatMap(l => sharedLines(l, found.dials, measure, size)) }
}

