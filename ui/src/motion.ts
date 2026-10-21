import { TINTS } from '../../src/core/animation.ts'
import { colorPair } from '../../src/core/look.ts'

/** Maths for drawing a step's beats (src/core/animation.ts). No DOM in here, so the node tests can run it. */

/** How long Autoplay rests after a step has finished moving, in ms. */
export const GAP = 900
/** How long Autoplay stays on a step that doesn't move, or when motion is reduced, in ms. */
export const DWELL = 2200

/** How long a step that moves rests between plays while you stay on it, in ms. */
export const REST = 2500

type Span = { at: number; dur: number }

/** Half the thickness of what runs along a line: the blob. */
const PIPE_HALF = 15
/** The clear space between the blob and a label moved off its path. */
const LABEL_GAP = 6

/**
 * Where to move a line's label so it sits beside the blob's path along the line, not under the blob: perpendicular to the line, on the
 * upper side (the right side of a vertical line), far enough that a label of `chars` characters clears the blob at any slope.
 * `dx` and `dy` run from one end of the line to the other.
 */
export function labelOffset(dx: number, dy: number, chars: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy)
  if (len === 0) return { x: 0, y: -(PIPE_HALF + LABEL_GAP + 10) }
  let nx = dy / len
  let ny = -dx / len
  if (ny > 0 || (ny === 0 && nx < 0)) {
    nx = -nx
    ny = -ny
  }
  const far = PIPE_HALF + LABEL_GAP + Math.abs(nx) * (chars * 3 + 6) + Math.abs(ny) * 10
  return { x: nx * far || 0, y: ny * far || 0 } // || 0: no negative zero
}

/** How long one round takes when several steps play together: the longest of them, then a rest, so they all start again at once. */
export const cyclePeriod = (totals: Iterable<number>): number => Math.max(0, ...totals) + REST

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

/** How much of its strength a lit line keeps once a step has timed out. */
export const LIT_FLOOR = 0.25

/**
 * How strong the lit lines of a stop are at `t`: full until a `fade` beat starts, falling to LIT_FLOOR over it, and staying there after it
 * (the line is dim until the step is left). The strongest fade of several wins; beats with no `fade` leave it at 1.
 */
export const litOpacity = (beats: readonly (Span & { do: string })[], t: number): number =>
  1 - (1 - LIT_FLOOR) * Math.max(0, ...beats.filter(b => b.do === 'fade').map(b => progress(b, t)))

/**
 * How far along a line of length `len` a blob is at progress `p`, running forward or back. `span` is the stretch of the line it runs
 * between, as fractions of it (the whole line when left out): forward runs from `start` to `end`, back from `end` to `start`, and a blob whose
 * `start` is its `end` waits where it is.
 */
export const distance = (dir: 'fwd' | 'back' | undefined, p: number, len: number, span: { start?: number; end?: number } = {}): number => {
  const start = span.start ?? 0
  const end = span.end ?? 1
  return (start + (end - start) * (dir === 'back' ? 1 - ease(p) : ease(p))) * len
}

/** The colour of a slot of TINTS, as a CSS colour for either theme: a request that meets an outcome in a burst. The slot wraps round. */
export function tintColor(slot: number): string {
  const [light, dark] = colorPair(TINTS[((slot % TINTS.length) + TINTS.length) % TINTS.length])!
  return `light-dark(${light}, ${dark})`
}

/**
 * The unit normal of a line that points to its lower side: away from where its label sits (see labelOffset), so a note or a marker
 * beside the line never meets the label. `dx` and `dy` run from one end of the line to the other.
 */
export function lowerSide(dx: number, dy: number): { x: number; y: number } {
  const up = labelOffset(dx, dy, 0)
  const len = Math.hypot(up.x, up.y)
  return { x: -up.x / len || 0, y: -up.y / len || 0 } // || 0: no negative zero
}

/** How far a note sits from the line: clear of a puff or a clock of radius about 26 around the spot it is about. */
const NOTE_GAP = 32
/** Where to put a note of `chars` characters, from the spot it is about: on the lower side of the line, further for a long note on a steep line. */
export function noteSpot(dx: number, dy: number, chars: number): { x: number; y: number } {
  const n = lowerSide(dx, dy)
  const far = NOTE_GAP + Math.abs(n.x) * (chars * 3.2 + 6) + Math.abs(n.y) * 6
  return { x: n.x * far || 0, y: n.y * far || 0 }
}

/** The size of the dashed marker of a party that is not in the model, for its name. */
export const markerSize = (name: string): { width: number; height: number } => ({ width: Math.round(name.length * 7.5 + 28), height: 28 })
/** The clear space between the pipe and the marker beside it. */
const MARKER_GAP = 26
/** Where the middle of a marker of this size sits, from the point on the line it hangs from: on the lower side, clear of the blob that runs along the line. */
export function markerSpot(dx: number, dy: number, size: { width: number; height: number }): { x: number; y: number } {
  const n = lowerSide(dx, dy)
  const far = MARKER_GAP + Math.abs(n.x) * (size.width / 2) + Math.abs(n.y) * (size.height / 2)
  return { x: n.x * far || 0, y: n.y * far || 0 }
}

type Point = { x: number; y: number }
type Box = { x: number; y: number; width: number; height: number }
/** Where a straight run from `from` to the middle of a box first meets the box's edge, so a blob taken in by a box stops at its edge. From inside the box it is the middle. */
export function entryPoint(from: Point, box: Box): Point {
  const middle = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const inside = from.x >= box.x && from.x <= box.x + box.width && from.y >= box.y && from.y <= box.y + box.height
  if (inside) return middle
  // The fraction of the run at which each axis enters the box; the run enters when both have.
  const enter = (a: number, to: number, lo: number, size: number): number => {
    if (to === a) return 0
    const t0 = (lo - a) / (to - a)
    const t1 = (lo + size - a) / (to - a)
    return Math.min(t0, t1)
  }
  const t = Math.min(1, Math.max(enter(from.x, middle.x, box.x, box.width), enter(from.y, middle.y, box.y, box.height), 0))
  return { x: from.x + (middle.x - from.x) * t, y: from.y + (middle.y - from.y) * t }
}

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
