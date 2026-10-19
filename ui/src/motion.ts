/** Maths for drawing a step's beats (src/core/animation.ts). No DOM in here, so the node tests can run it. */

/** How long Autoplay rests after a step has finished moving, in ms. */
export const GAP = 900
/** How long Autoplay stays on a step that doesn't move, or when motion is reduced, in ms. */
export const DWELL = 2200

type Span = { at: number; dur: number }

/** How far through a beat the moment `t` is: 0 before it, 1 after it. */
export const progress = (b: Span, t: number): number => Math.min(1, Math.max(0, (t - b.at) / b.dur))

/** Whether the beat is running at `t`. */
export const active = (b: Span, t: number): boolean => t >= b.at && t < b.at + b.dur

/** Slow at both ends, fast in the middle: a blob eases into the pipe and out of it. */
export const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

/** 0 at the ends of a beat and 1 in the middle: a squash, or a blob stretched at full speed. */
export const bump = (p: number): number => Math.sin(Math.PI * p)

/** The tube fades in over the first 150 ms of its beat and out over the last 250. */
export const tubeOpacity = (b: Span, t: number): number => Math.min(1, Math.max(0, Math.min((t - b.at) / 150, (b.at + b.dur - t) / 250)))

/** How far along a line of length `len` a blob is at progress `p`, running forward or back. */
export const distance = (dir: 'fwd' | 'back' | undefined, p: number, len: number): number => (dir === 'back' ? 1 - ease(p) : ease(p)) * len

/**
 * The dash settings that draw one stretch of a path of length `len`: `window` long and centred on `pos`.
 * The gap is longer than the path, so the pattern never repeats on it.
 */
export const dashAround = (pos: number, len: number, window: number): { array: string; offset: number } => ({
  array: `${window} ${len * 2 + window}`,
  offset: -(pos - window / 2),
})

/** The biggest of some squashes, 0 for none. */
export const largest = (amounts: Iterable<number>): number => Math.max(0, ...amounts)

/** What a squash needs of a box's tile: somewhere to put a transform (an HTMLElement fits). This file is checked without the DOM. */
type Tile = { style: { transform: string } }

const squashes = new Map<Tile, Map<symbol, number>>()
/**
 * Squash the tile of a box by `amount` (0 to 1) on behalf of `who`. Several steps may squash one box at once (a fan-out has one
 * source; a step that is both its ends is two), so the box takes the largest of what is asked and a step with nothing to squash
 * never clears another's. An amount of 0 withdraws what `who` asked.
 */
export function squashTile(el: Tile, who: symbol, amount: number): void {
  let by = squashes.get(el)
  if (amount > 0) {
    if (!by) squashes.set(el, (by = new Map()))
    by.set(who, amount)
  } else if (by) {
    by.delete(who)
    if (by.size === 0) squashes.delete(el)
  }
  const x = by ? largest(by.values()) : 0
  el.style.transform = x > 0 ? `scale(${1 + 0.07 * x}, ${1 - 0.1 * x})` : ''
}
