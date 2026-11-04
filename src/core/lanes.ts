import type { Point } from './heads.ts'
import type { Strand } from './views.ts'

/**
 * The lines of one pair of shapes where a project draws a line for each connection (`pairs: separate`, see View.strands): where each one runs. They run as parallel lanes,
 * `PITCH` apart and centred on the line between the two shapes, from nothing but the order of the connections in the file and the geometry of the two shapes. Nothing is saved
 * per line. Both readers draw from this one module (the desktop app has a twin of it, held equal by desktop/fixtures).
 *
 * Only straight lanes so far: a pair of two or more lines is drawn straight in every line style (a pair with one line is drawn as it always was, see ui/src/lanes.ts).
 *
 * The module uses `+ - * /`, `sqrt` and comparisons only, and every number it hands out is rounded with `round3`, so the C# twin gets the same numbers: no `hypot`, trigonometry
 * or `pow` (test/lanes-core.test.ts looks for them).
 */

/** A box on the canvas: where it is and how big. */
export type Rect = Point & { width: number; height: number }

/** A shape's outline as a convex polygon in the box's own 200×72 area, or empty for the rectangle (see ShapeDef.edge). */
export type Outline = readonly (readonly [number, number])[]

/**
 * Where a ray from `from` (the centre of `r` when left out) towards (dx, dy) meets the shape's outline: the rectangle's border when `edge` is empty, else the first side of
 * the polygon it crosses. Dividing by zero gives infinity, which Math.min ignores. The ray starts inside the shape.
 */
export function leaveAt(r: Rect, edge: Outline, dx: number, dy: number, from?: Point): Point {
  const cx = from?.x ?? r.x + r.width / 2
  const cy = from?.y ?? r.y + r.height / 2
  if (edge.length === 0) {
    if (from === undefined) {
      const k = Math.min(r.width / 2 / Math.abs(dx), r.height / 2 / Math.abs(dy)) // how far along the line the box's border is
      return { x: cx + dx * k, y: cy + dy * k }
    }
    const reach = (low: number, high: number, at: number, step: number): number => (step > 0 ? (high - at) / step : step < 0 ? (low - at) / step : Infinity)
    const k = Math.min(reach(r.x, r.x + r.width, cx, dx), reach(r.y, r.y + r.height, cy, dy))
    return { x: cx + dx * k, y: cy + dy * k }
  }
  let best = Infinity
  edge.forEach(([px, py], i) => {
    const [qx, qy] = edge[(i + 1) % edge.length]
    const ex = qx - px
    const ey = qy - py
    const den = dx * ey - dy * ex
    if (den === 0) return // the ray runs along this side
    const t = ((r.x + px - cx) * ey - (r.y + py - cy) * ex) / den
    const s = ((r.x + px - cx) * dy - (r.y + py - cy) * dx) / den
    if (t > 0 && s >= 0 && s <= 1 && t < best) best = t
  })
  return best === Infinity ? { x: cx, y: cy } : { x: cx + dx * best, y: cy + dy * best }
}

/** A number to three decimals, the way both readers round: half up, whatever the sign (`Math.round` and C#'s `Math.Round` differ on halves). */
export const round3 = (x: number): number => Math.floor(x * 1000 + 0.5) / 1000

/** The distance between lanes side by side, in pixels. */
export const PITCH = 12
/** The extra space between the lanes that run one way and the lanes that run the other. */
export const GUTTER = 6
/** How far inside a shape's outline the outermost lane stays. */
export const MARGIN = 10
/** Most lanes drawn for one pair; more are folded into trunks by direction and kind (a later phase). */
export const MOST = 8
/** Number of segments a lane that is displaced is drawn in (it has one more point than that). */
export const SAMPLES = 24
/** The pitch in the middle of a pair that is spread, at most. */
export const SPREAD_PITCH = 22
/** How far from a lane a pointer still means that lane, at most, in screen pixels (see nearestStrand: the same distance at any zoom). */
export const REACH = 7
/**
 * The words on the two buttons that move a connection in the order of its pair's lines (Move up, Move down), and the reason on one that cannot move: the first line cannot move up,
 * the last cannot move down, and a line with no other line going its way (`alone`) can move neither. The buttons stay and grey out with the reason, they are never hidden. Both
 * readers say them; the desktop has the same table.
 */
export const MOVE_WORDS = { up: 'Move up', down: 'Move down', first: 'Already first', last: 'Already last', alone: 'Only line this way' } as const

/**
 * The width, in screen pixels, of the strip a line takes clicks in where its pair has several lines: the reach on each side of it. A lone line keeps React Flow's usual 20.
 * It is 14, not the 12 of the lanes' rest pitch: the strip only says which lines to ask `nearestStrand` about, and that function accepts a pointer up to `REACH` from a lane, so
 * a 12 px strip would turn away pointers 6 to 7 px off a lane that the desktop (which has no strips, only `nearestStrand`) accepts.
 */
export const HIT_WIDTH = 2 * REACH

/** How long a pair takes to spread, and to close again, in milliseconds. Reduced motion snaps. */
export const SPREAD_MS = 160

/** How faded the other lanes of a pair are while one of them is pointed at (the lane pointed at is drawn above them, in the accent). */
export const SIBLING_OPACITY = 0.85

/**
 * How far a pair has gone from one pose towards the other after `ms` more milliseconds: `progress` is 0 for rest and 1 for spread, and it moves to `goal` (0 or 1) at the same speed
 * either way, so a pair that is turned round half way goes back from where it is, with no jump.
 */
export function spreadProgress(progress: number, goal: number, ms: number): number {
  const step = ms / SPREAD_MS
  return goal > progress ? Math.min(goal, progress + step) : Math.max(goal, progress - step)
}

/** The `s` of a pose for a pair that is `progress` of the way to spread: slow at both ends and quick between, so the lanes do not start or stop with a jolt. */
export const easedSpread = (progress: number): number => progress * progress * (3 - 2 * progress)

/** What a pair of lanes is doing: `s` is how far it is spread (0 to 1), and `lam[j]` how lit its lane j is (0 to 1; the lane around which the others part). */
export type Pose = { readonly s: number; readonly lam: readonly number[] }

/** Nothing selected and nothing playing. */
export const REST: Pose = Object.freeze({ s: 0, lam: Object.freeze([]) })

/** The pair is selected, or a shape on it, or keyboard focus is on one of its lines: the lanes widen to a pitch that fits their labels. */
export const SPREAD: Pose = Object.freeze({ s: 1, lam: Object.freeze([]) })

/** A box with the id its lane belongs to: the lanes of a pair are laid out from the shape with the smaller id (the way `lineKey` orders a pair). */
export type LaneBox = { id: string; rect: Rect; edge: Outline }

/** Where a line sits among the lines of its pair: `lane` counts from 0 of `lanes`, and the first `back` of them run from the pair's later id to its earlier. */
export type Slot = { lane: number; lanes: number; back: number }

/**
 * The slot of each strand of a view, by strand id. The lanes of a pair come in the order View.strands has them: first the ones that run from the pair's later id to its
 * earlier, then the others, so `back` is how many of the first kind there are.
 */
export function slotsOf(strands: readonly Strand[]): Map<string, Slot> {
  const back = new Map<string, number>()
  for (const s of strands) if (s.from > s.to) back.set(s.pair, (back.get(s.pair) ?? 0) + 1)
  return new Map(strands.map(s => [s.id, { lane: s.lane, lanes: s.lanes, back: back.get(s.pair) ?? 0 }]))
}

/** The centre of a box. */
const centreOf = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })

/** The line between two shapes of a pair: A is the one with the smaller id, `u` points from A to B, `n` is `u` turned a quarter clockwise on the screen (to the right of the way from A to B). */
type Frame = { a: LaneBox; b: LaneBox; ca: Point; cb: Point; length: number; u: Point; n: Point }

function frameOf(one: LaneBox, other: LaneBox): Frame {
  const [a, b] = one.id < other.id ? [one, other] : [other, one]
  const [ca, cb] = [centreOf(a.rect), centreOf(b.rect)]
  const dx = cb.x - ca.x
  const dy = cb.y - ca.y
  const length = Math.sqrt(dx * dx + dy * dy)
  const u = length < 1e-6 ? { x: 1, y: 0 } : { x: dx / length, y: dy / length }
  return { a, b, ca, cb, length, u, n: { x: -u.y, y: u.x } }
}

/** How far from the centre of `box` its outline is along `n` and against it, the nearer of the two. */
function halfRoom(box: LaneBox, n: Point): number {
  const c = centreOf(box.rect)
  const along = (sign: number) => {
    const p = leaveAt(box.rect, box.edge, n.x * sign, n.y * sign)
    const dx = p.x - c.x
    const dy = p.y - c.y
    return Math.sqrt(dx * dx + dy * dy)
  }
  return Math.min(along(1), along(-1))
}

/** The smaller half-room of the two shapes of a pair across their lanes: how far each outline is from the line between the centres, along its normal, the nearer side of the nearer shape. */
export function roomOf(one: LaneBox, other: LaneBox): number {
  const { a, b, n } = frameOf(one, other)
  return Math.min(halfRoom(a, n), halfRoom(b, n))
}

/** The gutter between the lanes of the two directions: only where there are lanes both ways. */
const gutterOf = (slot: Slot): number => (slot.back > 0 && slot.lanes - slot.back > 0 ? GUTTER : 0)

/** The room for lanes across a pair: twice the smaller half-room of the two shapes along `n`, less the margin each side. */
export function usableOf(half: number): number {
  return 2 * (half - MARGIN)
}

/** How many lanes fit across `half` (the smaller half-room of the two shapes), at the usual pitch, and no more than `MOST`. At least one. */
export function laneCapacity(half: number, bothWays: boolean): number {
  const fit = Math.floor((usableOf(half) - (bothWays ? GUTTER : 0)) / PITCH) + 1
  return Math.max(1, Math.min(MOST, fit))
}

/** The pitch for a pair: the usual one, or less when more lanes than fit across `half` are drawn, so every lane still meets the outline (until trunks fold them, see MOST). */
export function pitchFor(half: number, slot: Slot): number {
  if (slot.lanes < 2) return PITCH
  return Math.max(0, Math.min(PITCH, (usableOf(half) - gutterOf(slot)) / (slot.lanes - 1)))
}

/** How far lane `slot.lane` sits to the right of the line between the centres (along `n`): the lanes are centred on it, in two groups with the gutter between. */
export function offsetOf(slot: Slot, pitch = PITCH): number {
  const gutter = gutterOf(slot)
  const side = gutter === 0 ? 0 : slot.lane < slot.back ? -gutter / 2 : gutter / 2
  return (slot.lane - (slot.lanes - 1) / 2) * pitch + side
}

/** How far the middle of a lane is moved at fraction `t` of the way along: 1 in the middle, and 0 with no slope at both ends, so nothing near a shape moves. */
export const bulge = (t: number): number => {
  const m = t * (1 - t)
  return 16 * m * m
}

/** A lane: the SVG path from its first shape to its second, the points it is made of (the flattened path), and its anchor, the middle of the line, where its label sits. */
export type Lane = { path: string; x: number; y: number; points: Point[] }

const pointText = (p: Point): string => `${p.x} ${p.y}`
const roundedPoint = (x: number, y: number): Point => ({ x: round3(x), y: round3(y) })

/**
 * The lane `slot` of the pair between `source` and `target`, drawn from `source` to `target`, in `pose`. A lane at rest is the straight line between the two points where its
 * line (parallel to the line between the centres) meets the two outlines. A lane in another pose is the same line moved sideways by a field that is 0 at both ends and largest in
 * the middle, written as 24 short curves, so the shapes and the heads never move:
 *   moved(t) = bulge(t) * ((f - 1) * s * offset + a * sum over lit lanes j of lam[j] * sign(lane - j))
 * `f` widens the middle to a pitch of at most `SPREAD_PITCH`; `a` opens a gap beside a lit lane. Every lane is moved by the same field in its own place, and the offset and the
 * second term only grow with the lane's place, so the lanes keep their order: they never cross.
 */
export function laneGeometry(source: LaneBox, target: LaneBox, slot: Slot, pose: Pose = REST): Lane {
  const frame = frameOf(source, target)
  const { a, b, ca, cb, u, n } = frame
  const half = Math.min(halfRoom(a, n), halfRoom(b, n))
  const pitch = pitchFor(half, slot)
  const offset = offsetOf(slot, pitch)
  const exitA = leaveAt(a.rect, a.edge, u.x, u.y, { x: ca.x + n.x * offset, y: ca.y + n.y * offset })
  const exitB = leaveAt(b.rect, b.edge, -u.x, -u.y, { x: cb.x + n.x * offset, y: cb.y + n.y * offset })
  const [from, to] = source === a ? [exitA, exitB] : [exitB, exitA]
  const start = roundedPoint(from.x, from.y)
  const end = roundedPoint(to.x, to.y)
  const sideways = displacement(slot, pose, frame.length, pitch)
  const rest = (): Lane => ({ path: `M${pointText(start)}L${pointText(end)}`, x: round3((start.x + end.x) / 2), y: round3((start.y + end.y) / 2), points: [start, end] })
  if (sideways === 0) return rest()
  // The same field for every lane: the middle of this lane is `sideways` along `n`, and the points before and after it follow bulge(t).
  const points: Point[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES
    const moved = bulge(t) * sideways
    points.push(i === 0 ? start : i === SAMPLES ? end : roundedPoint(start.x + (end.x - start.x) * t + n.x * moved, start.y + (end.y - start.y) * t + n.y * moved))
  }
  let path = `M${pointText(points[0])}`
  for (let i = 1; i < SAMPLES; i++) {
    const next = points[i + 1]
    path += `Q${pointText(points[i])} ${pointText(roundedPoint((points[i].x + next.x) / 2, (points[i].y + next.y) / 2))}`
  }
  path += `L${pointText(points[SAMPLES])}`
  const middle = points[SAMPLES / 2]
  return { path, x: middle.x, y: middle.y, points }
}

/** The sign of `x`: -1, 0 or 1. */
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0)

/**
 * How far the middle of lane `slot.lane` is moved along `n` in `pose`, for a pair whose shapes are `length` apart and whose lanes are `pitch` apart: the widening of a spread
 * pair plus the gap opened beside each lit lane. 0 for a pair at rest, and for a single line.
 */
export function displacement(slot: Slot, pose: Pose, length: number, pitch: number): number {
  if (slot.lanes < 2 && pose.lam.every(l => l === 0)) return 0
  const offset = offsetOf(slot, pitch)
  let widest = 0
  for (let k = 0; k < slot.lanes; k++) widest = Math.max(widest, Math.abs(offsetOf({ ...slot, lane: k }, pitch)))
  const spread = Math.min(SPREAD_PITCH / pitch, 1 + (0.2 * length) / (widest + PITCH))
  const gap = Math.min(18, 0.2 * length)
  let parted = 0
  pose.lam.forEach((lit, j) => {
    parted += lit * sign(slot.lane - j)
  })
  return (spread - 1) * pose.s * offset + gap * parted
}

/** A lane to be hit-tested: the points of its path at the pose on show, and the pair and the place among the pair's lanes it belongs to. */
export type HitLane = { id: string; pair: string; lane: number; points: readonly Point[] }

/** The distance from `at` to the polyline `points`, and the nearest point on it. */
function nearestOn(points: readonly Point[], at: Point): { distance: number; point: Point } {
  let best = { distance: Infinity, point: points[0] }
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]]
    const dx = q.x - p.x
    const dy = q.y - p.y
    const lengthSquared = dx * dx + dy * dy
    const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - p.x) * dx + (at.y - p.y) * dy) / lengthSquared))
    const point = { x: p.x + dx * along, y: p.y + dy * along }
    const ex = at.x - point.x
    const ey = at.y - point.y
    const distance = Math.sqrt(ex * ex + ey * ey)
    if (distance < best.distance) best = { distance, point }
  }
  if (points.length === 1) {
    const ex = at.x - points[0].x
    const ey = at.y - points[0].y
    best = { distance: Math.sqrt(ex * ex + ey * ey), point: points[0] }
  }
  return best
}

/**
 * The lane a pointer at `at` means, or undefined when it is near none: the lane whose line is nearest, within `min(REACH, half the space to its nearest neighbour in the pair + 1)`.
 * Lanes that are equally near go to the lower lane. The space to the neighbour is measured from the nearest point of the lane, so where the lanes of a curve crowd together the
 * strips shrink with them. Both readers ask this after the canvas says which line it hit, since neighbouring strips overlap on a slope.
 *
 * `lanes` and `at` are in canvas units and `zoom` is how many screen pixels one canvas unit is: the distances above are in screen pixels, so a line a pointer is 7 pixels from
 * is picked at any zoom, and zoomed out, where the lanes are close on screen, the strips shrink with them.
 */
export function nearestStrand(canvasLanes: readonly HitLane[], canvasAt: Point, zoom = 1): string | undefined {
  const lanes = zoom === 1 ? canvasLanes : canvasLanes.map(l => ({ ...l, points: l.points.map(p => ({ x: p.x * zoom, y: p.y * zoom })) }))
  const at = zoom === 1 ? canvasAt : { x: canvasAt.x * zoom, y: canvasAt.y * zoom }
  const near = lanes.map(lane => ({ lane, ...nearestOn(lane.points, at) })).filter(c => c.distance <= REACH)
  let best: { id: string; lane: number; distance: number } | undefined
  for (const c of near) {
    let gap = Infinity
    for (const other of lanes) if (other.pair === c.lane.pair && other.id !== c.lane.id) gap = Math.min(gap, nearestOn(other.points, c.point).distance)
    if (c.distance > Math.min(REACH, gap / 2 + 1)) continue
    if (best === undefined || c.distance < best.distance - 1e-9 || (Math.abs(c.distance - best.distance) <= 1e-9 && c.lane.lane < best.lane)) best = { id: c.lane.id, lane: c.lane.lane, distance: c.distance }
  }
  return best?.id
}
