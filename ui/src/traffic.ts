import type { Failure, LineTraffic } from '../../src/core/perf/types.ts'

/**
 * One particle on a line: how far along it is (0 to 1), and where it is done, if it is going to fail: a failed call is drawn
 * as a particle that fades and drops short of the end. 0 means it arrives. What "done" looks like depends on how the line says
 * its failing share fails (see moteLook): without a style it is where the particle fades away, for a lost call a little after
 * the place it pops, for a rejected one past the end of the line, after it has come back.
 */
export type Mote = { s: number; fails: number }

/** A line's particles and the part of the next one already due. */
export type Stream = { motes: Mote[]; due: number }

/** Most particles one line holds at once, so a slow, busy line stays cheap. */
export const MOST = 64

export const newStream = (): Stream => ({ motes: [], due: 0 })

/** How long a lost call's pop lasts, in the same units as `s` (a fraction of the line). */
export const POP = 0.08
/** How long a rejected call waits at the bar, and how far back along the line it comes before it is gone. */
export const HOLD = 0.05
export const BACK = 0.25
/** Where a rejected call is done: past the end by the wait and the way back. */
export const REJECTED_END = 1 + HOLD + BACK

/**
 * Move a line's particles on by `ms` and start the ones that are due, at the rate and speed this much traffic has. Taking the
 * numbers each time means a ramp changes them smoothly: what is already on the line keeps going and new particles use the new
 * speed. `rand` is 0 to 1; a failing particle is one in `failed` of them and gives out between 30% and 80% of the way (a rejected one
 * goes the whole way to the end, and comes back). The line's `perSecond` already says how many are on it at once (see traffic() in
 * core/perf.ts), so this never has to look at a cap: `MOST` is only the last safeguard against a number that got through.
 */
export function advance(stream: Stream, line: Pick<LineTraffic, 'perSecond' | 'travelMs' | 'failed' | 'failure'>, ms: number, rand: () => number): void {
  const step = ms / line.travelMs
  for (const m of stream.motes) m.s += step
  stream.motes = stream.motes.filter(m => m.s < (m.fails || 1))
  stream.due += (line.perSecond * ms) / 1000
  if (!Number.isFinite(stream.due)) stream.due = 0 // a number that is not one starts nothing, and doesn't stick
  // The whole particles that are due, no more than there is room for: a rate far past what a line can hold costs one step, not millions.
  const whole = Math.floor(stream.due)
  stream.due -= whole
  for (let i = Math.min(whole, MOST - stream.motes.length); i > 0; i--) stream.motes.push({ s: 0, fails: rand() < line.failed ? endOf(line.failure, rand) : 0 })
}

/** Where a failing particle is done, from how its line says it fails. The place it gives out or pops is drawn from `rand`, between 30% and 80% of the way. */
function endOf(failure: Failure | undefined, rand: () => number): number {
  if (failure === 'rejected') return REJECTED_END
  const gives = 0.3 + 0.5 * rand()
  return failure === 'lost' ? gives + POP : gives
}

/** How faint a particle is at its faintest, when it is well behind something: still there, so the flow reads, but a ghost. */
export const GHOST = 0.3

/**
 * How far behind something a particle is, 0 to 1, from how deep inside it the particle sits: 0 until it is `ramp` outside, 1 once it is `ramp`
 * inside, and in between a slope, so it fades as it goes behind and comes back as it comes out, never in a step.
 */
export const howBehind = (depth: number, ramp: number): number => Math.min(1, Math.max(0, (depth + ramp) / (2 * ramp)))

/** How a particle `behind` of the way draws: fainter, and a little smaller, as something does when it is further back. */
export const ghost = (behindBy: number): { alpha: number; scale: number } => ({ alpha: 1 - behindBy + behindBy * GHOST, scale: 1 - behindBy * 0.25 })

/**
 * How far into a shape that opens a particle is, 0 to 1: a line that ends at one runs on `after` into it, and one that starts at one runs in from `before`
 * inside (see `extend` in pathpoints.ts). `length` is how far along the whole run the particle is. It is 0 on the outline and while the particle is on the
 * line, and 1 once it is all the way in, where a particle that arrives is gone and one that leaves has not yet shown.
 */
export const wentIn = (length: number, total: number, { before, after }: { before: number; after: number }): number => {
  const out = before > 0 ? (before - length) / before : 0
  const into = after > 0 ? (length - (total - after)) / after : 0
  return Math.min(1, Math.max(0, out, into))
}

/** How a particle `into` a shape draws: it thins away and shrinks a little as it goes in, so it reads as passing through the outline. */
export const swallow = (into: number): { alpha: number; scale: number } => ({ alpha: 1 - into, scale: 1 - into * 0.25 })

/** How visible a particle is: full until it is nearly out, then fading, so one that fails dies away instead of vanishing. */
export const visibility = (m: Mote): number => (m.fails === 0 ? 1 : Math.min(1, Math.max(0, (m.fails - m.s) / 0.15)))

/**
 * How a particle draws now: where along the line it is (`at`, 0 to 1), whether it is in the danger tone, how visible it is, and for the styles
 * that have one, the pop of a lost call (`pop`, 0 as it bursts to 1 as it is gone, drawn as a ring where the call died) and the bar a rejected
 * call hits (`bar`, 0 to 1, how strongly it shows at the end of the line). All numbers, so the browser and the desktop app draw the same thing.
 * Without a style a failing particle is danger-toned from the start and fades; a lost one is an ordinary particle until it pops; a rejected one is
 * ordinary until it reaches the end, then turns danger-toned, waits at the bar and comes back, fading.
 */
export type MoteLook = { at: number; bad: boolean; alpha: number; pop?: number; bar?: number }

export function moteLook(m: Mote, failure: Failure | undefined): MoteLook {
  if (m.fails === 0) return { at: m.s, bad: false, alpha: 1 }
  if (failure === 'lost') {
    const dies = m.fails - POP
    if (m.s < dies) return { at: m.s, bad: false, alpha: 1 }
    return { at: dies, bad: true, alpha: 0, pop: Math.min(1, Math.max(0, (m.s - dies) / POP)) }
  }
  if (failure === 'rejected') {
    if (m.s <= 1) return { at: m.s, bad: false, alpha: 1, bar: Math.min(1, Math.max(0, 1 - (1 - m.s) / 0.1)) }
    if (m.s <= 1 + HOLD) return { at: 1, bad: true, alpha: 1, bar: 1 }
    const back = Math.min(1, Math.max(0, (m.s - 1 - HOLD) / BACK))
    return { at: 1 - back * BACK, bad: true, alpha: 1 - back, bar: 1 - back }
  }
  return { at: m.s, bad: true, alpha: visibility(m) }
}
