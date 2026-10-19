import type { LineTraffic } from '../../src/core/perf.ts'

/**
 * One particle on a line: how far along it is (0 to 1), and where it gives out, if it is going to: a failed call is drawn
 * as a particle that fades and drops short of the end. 0 means it arrives.
 */
export type Mote = { s: number; fails: number }

/** A line's particles and the part of the next one already due. */
export type Stream = { motes: Mote[]; due: number }

/** Most particles one line holds at once, so a slow, busy line stays cheap. */
export const MOST = 64

export const newStream = (): Stream => ({ motes: [], due: 0 })

/**
 * Move a line's particles on by `ms` and start the ones that are due, at the rate and speed this much traffic has. Taking the
 * numbers each time means a ramp changes them smoothly: what is already on the line keeps going and new particles use the new
 * speed. `rand` is 0 to 1; a failing particle is one in `failed` of them and drops out between 30% and 80% of the way.
 */
export function advance(stream: Stream, line: Pick<LineTraffic, 'perSecond' | 'travelMs' | 'failed'>, ms: number, rand: () => number): void {
  const step = ms / line.travelMs
  for (const m of stream.motes) m.s += step
  stream.motes = stream.motes.filter(m => m.s < (m.fails || 1))
  stream.due += (line.perSecond * ms) / 1000
  while (stream.due >= 1) {
    stream.due -= 1
    if (stream.motes.length < MOST) stream.motes.push({ s: 0, fails: rand() < line.failed ? 0.3 + 0.5 * rand() : 0 })
  }
}

/** How visible a particle is: full until it is nearly out, then fading, so one that fails dies away instead of vanishing. */
export const visibility = (m: Mote): number => (m.fails === 0 ? 1 : Math.min(1, Math.max(0, (m.fails - m.s) / 0.15)))
