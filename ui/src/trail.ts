import type { Flow } from '../../src/core/model.ts'
import { stopsOf } from '../../src/core/structure.ts'

/**
 * The trail Open flow leaves behind: where the reader was in each flow they left to read another. It lives in memory only (the address
 * names the flow playing, not the way there), so a reload drops it. The functions return new trails and change nothing in place.
 */

/** A place in a flow: the flow and the stop the player was at. */
export type Spot = { flow: string; step: number }

/** The trail after leaving `here` to open another flow. */
export const openFlow = (trail: readonly Spot[], here: Spot): Spot[] => [...trail, here]

/** The place the last flow was opened from, and the trail without it; undefined when there is nowhere to go back to. */
export function closeFlow(trail: readonly Spot[]): { back: Spot; trail: Spot[] } | undefined {
  const back = trail.at(-1)
  return back === undefined ? undefined : { back, trail: trail.slice(0, -1) }
}

/**
 * The browser's Back or Forward landed on the flow `named`. When that is the flow the trail's last place is in, the reader returns to the
 * stop they left, so Back and the player's own "back" agree; otherwise the flow opens at its first stop, as Back always has, and the trail is dropped.
 */
export function followBack(trail: readonly Spot[], named: string): { step: number; trail: Spot[] } {
  const top = trail.at(-1)
  return top?.flow === named ? { step: top.step, trail: trail.slice(0, -1) } : { step: 0, trail: [] }
}

/**
 * What the player's Back button says: the flow the last place of the trail is in (its id when it is gone) and the stop to return to, counted from 1. A flow that got shorter
 * under a live reload gives its last stop.
 */
export function cameFrom(flows: Record<string, Flow>, trail: readonly Spot[]): { name: string; step: number } | undefined {
  const last = trail.at(-1)
  if (last === undefined) return undefined
  const left = Object.hasOwn(flows, last.flow) ? flows[last.flow] : undefined
  return { name: left?.name ?? last.flow, step: Math.min(last.step, left ? stopsOf(left).length - 1 : last.step) + 1 }
}
