import type { Point } from './heads.ts'
import type { LineStyle } from './model.ts'
import type { Strand } from './views.ts'

/**
 * The lines of one pair of shapes where a project draws a line for each connection (`pairs: separate`, see View.strands): where each one runs. They run as parallel lanes,
 * `PITCH` apart and centred on the line between the two shapes, from nothing but the order of the connections in the file and the geometry of the two shapes. Nothing is saved
 * per line. Both readers draw from this one module (the desktop app has a twin of it, held equal by desktop/fixtures).
 *
 * Lanes follow the project's line style. Straight lanes run parallel to the line between the shapes. Curved lanes are the curve a lone line of the pair would be (React Flow's cubic
 * between the middles of the two facing sides), moved along the sides. Angled lanes are the staircase a lone line would be, nested. Where a pair has no such curve or staircase (its
 * sides do not face each other, or there is no room between them), its lanes are straight in every style. A pair with one line is drawn as it always was (see ui/src/lanes.ts).
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

/** The side of a shape a curved or right-angled line leaves by. */
export type PortSide = 'top' | 'right' | 'bottom' | 'left'

/** The step out of a side of a shape: where a curved or right-angled line heads when it leaves by that side. */
const OUT: Record<PortSide, readonly [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }

/** The side of `from` that faces `to`: the one a line between their centres leaves through. */
function facing(from: Rect, to: Rect): PortSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) * from.height > Math.abs(dy) * from.width) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

/** The middle of one side of a shape: where the line along that axis from its centre meets the outline. */
const middleOf = (r: Rect, side: PortSide, edge: Outline): Point => leaveAt(r, edge, ...OUT[side])

/** Where a curved or right-angled line starts and ends: the middle of the side each shape turns to the other. */
export function ports(a: Rect, b: Rect, edgeA: Outline = [], edgeB: Outline = []): { from: Point; fromSide: PortSide; to: Point; toSide: PortSide } {
  const fromSide = facing(a, b)
  const toSide = facing(b, a)
  return { from: middleOf(a, fromSide, edgeA), fromSide, to: middleOf(b, toSide, edgeB), toSide }
}

/** A number to three decimals, the way both readers round: half up, whatever the sign (`Math.round` and C#'s `Math.Round` differ on halves). */
export const round3 = (x: number): number => Math.floor(x * 1000 + 0.5) / 1000

/** The distance between lanes side by side, in pixels. */
export const PITCH = 12
/** The extra space between the lanes that run one way and the lanes that run the other. */
export const GUTTER = 6
/** How far inside a shape's outline the outermost lane stays. */
export const MARGIN = 10
/** Most lanes drawn for one pair; more are folded into trunks by direction and kind (see foldPair in trunks.ts). */
export const MOST = 8
/** The room a trunk (several lines stacked as one, see trunks.ts) takes beyond a lane's pitch: its two hairlines lie 3 px and 6 px behind it, on its outer side. */
export const TRUNK_EXTRA = 6
/** How far behind a trunk the first of its two hairlines lies; the second lies twice as far. */
export const HAIRLINE_GAP = 3
/** Most lines a trunk opens into when its pair is selected; a trunk of more stays shut, and the panel lists its connections. */
export const OPEN_MOST = 12
/** The least lines of a pair at which they might not all fit across the shapes (three lanes need 30 px, which every shape has), so no pair with fewer is folded. */
export const FOLD_FROM = 4
/** Number of segments a lane that is displaced is drawn in (it has one more point than that). */
export const SAMPLES = 24
/**
 * The least room, along the way two facing sides look, between the middles of the two sides for a pair to run curved or right-angled; with less (or sides that do not face each other)
 * its lanes run straight. A curve that short has no middle to speak of, and a staircase has no room for its turns.
 */
export const MIN_ROUTE_GAP = 24
/** The most the lanes of a curved pair are moved along the sides, as a multiple of their offset: where the curve is steep it takes more than the offset to be a pitch apart across it. */
export const KAPPA_MAX = 1.3
/**
 * The least share of a pitch the lanes of a curved pair may be apart across the curve, which is in the middle, where the curve is steepest against the sides. With `KAPPA_MAX` it says how
 * steep a curve may be: at least `GAP_LEAST / KAPPA_MAX` of its middle must run the way out of the sides. A curve that runs nearly along the sides (a flat S between shapes that face each
 * other from above and below but sit side by side) cannot be moved along them to make room, since its lanes would lie on top of one another, so the pair runs straight.
 */
export const GAP_LEAST = 0.4
/** The shortest run across (the middle leg of a staircase) a right-angled pair has: with less its lanes run straight. A run that short is no step, and it could not be moved when the pair parts. */
export const ANGLE_RUN = 24
/** The corner radius of a right-angled lane before its offset is added or taken, at least. */
export const CORNER = 8
/** How much more than the widest offset of a pair the radius is, if that is more than `CORNER`: the corner on the inside of the turn keeps at least this. */
export const CORNER_AIR = 6
/** The smallest radius a corner is rounded to; a corner between legs that are shorter is rounded to half the shorter. */
export const CORNER_LEAST = 2
/** How near the end of a side the outermost lane of a curved pair may be moved to: kappa is held to what leaves this much room. */
export const SIDE_AIR = 3
/** How much of each leg a right-angled pair keeps for itself when its runs are squeezed together to fit across it: a run never gets nearer a shape than this. */
export const LEG_AIR = 6
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
 * The words of the two items the key at the canvas foot has for lines side by side: a lane a step plays on among the others of its pair (a lane in the accent colour), and a trunk, several
 * lines of a pair stacked as one (a line with two hairlines behind it and a chip with a number). The key shows an item only while the canvas draws it. Both readers say them.
 */
export const LANE_KEY = { inUse: 'In use', stacked: 'Stacked lines' } as const

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

/**
 * Where a line sits among the lines of its pair: `lane` counts from 0 of `lanes`, and the first `back` of them run from the pair's later id to its earlier.
 * `stack` lists the lanes that are trunks (several lines stacked as one, drawn with two hairlines behind them, so each takes `TRUNK_EXTRA` more room), and
 * `fan` how many lines are drawn at each lane: 1, or more for a trunk that is open, whose lines then fan out of its place (`within` is the place of this line among them).
 * The three are left out when a pair has none, so a pair of plain lanes is `{ lane, lanes, back }` as it always was.
 */
export type Slot = { lane: number; lanes: number; back: number; stack?: readonly number[]; fan?: readonly number[]; within?: number }

/** Whether lines are drawn as lanes beside others: a slot of a pair of several lanes, or of a lane whose trunk is open and fans out into several lines. */
export const isLaned = (slot: Slot | undefined): slot is Slot => slot !== undefined && (slot.lanes > 1 || slot.fan !== undefined)

/**
 * The slot of each strand of a view, by strand id. The lanes of a pair come in the order View.strands has them: first the ones that run from the pair's later id to its
 * earlier, then the others, so `back` is how many of the first kind there are. A trunk (`Strand.trunk`) is a lane that takes `TRUNK_EXTRA` more room (the `stack` of its pair), and
 * so is a lane that several strands share, which is a trunk that is open: its strands each have the lane of the trunk and fan out of it (the `fan` of the pair, and the place of
 * the strand among them, `within`).
 */
export function slotsOf(strands: readonly Strand[]): Map<string, Slot> {
  const back = new Map<string, Set<number>>()
  const counts = new Map<string, number[]>()
  const within = new Map<string, number>()
  const stacked = new Map<string, Set<number>>()
  for (const s of strands) {
    if (s.from > s.to) back.set(s.pair, (back.get(s.pair) ?? new Set()).add(s.lane))
    const here = counts.get(s.pair) ?? Array.from({ length: s.lanes }, () => 0)
    within.set(s.id, here[s.lane]++)
    counts.set(s.pair, here)
    if (s.trunk !== undefined) stacked.set(s.pair, (stacked.get(s.pair) ?? new Set()).add(s.lane))
  }
  return new Map(strands.map(s => {
    const fan = counts.get(s.pair)!
    const open = fan.some(n => n > 1)
    const stack = [...new Set([...(stacked.get(s.pair) ?? []), ...fan.flatMap((n, lane) => (n > 1 ? [lane] : []))])].sort((a, b) => a - b)
    return [s.id, {
      lane: s.lane, lanes: s.lanes, back: back.get(s.pair)?.size ?? 0,
      ...(stack.length === 0 ? {} : { stack }), ...(open ? { fan, within: within.get(s.id)! } : {}),
    }]
  }))
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

/**
 * The curve of a lone line between the middles of two facing sides: the first control point leaves the side straight out for half the gap, and the second arrives the same way.
 * (React Flow's cubic with its curvature of 0.25: the control offset is half the distance when the other end is ahead.)
 */
function curveOf(from: Point, to: Point, sideA: PortSide, sideB: PortSide, gap: number): [Point, Point, Point, Point] {
  const [outA, outB] = [OUT[sideA], OUT[sideB]]
  const reach = gap / 2
  return [from, { x: from.x + outA[0] * reach, y: from.y + outA[1] * reach }, { x: to.x + outB[0] * reach, y: to.y + outB[1] * reach }, to]
}

/**
 * How much of the curve's middle runs along the way out of the sides (0 to 1): the component of its unit tangent there, 3/4 of (P3 + P2 - P1 - P0), along that way. 1 is a straight
 * run between two sides; the smaller it is, the more of the middle runs along the sides, where the lanes are moved.
 */
function curveSteepness(from: Point, to: Point, sideA: PortSide, sideB: PortSide, gap: number): number {
  const [p0, p1, p2, p3] = curveOf(from, to, sideA, sideB, gap)
  const [tx, ty] = [0.75 * (p3.x + p2.x - p1.x - p0.x), 0.75 * (p3.y + p2.y - p1.y - p0.y)]
  return Math.abs(OUT[sideA][1] === 0 ? tx : ty) / Math.sqrt(tx * tx + ty * ty)
}

/**
 * How a pair of curved or right-angled lanes runs: between the middles of the two sides that face each other (`from` on the shape with the smaller id, `to` on the other), `gap` apart
 * along the way the sides look, and moved along the sides (`lateral`, a unit step along them, to the same side as the pair's normal) to make room for the lanes side by side.
 */
type Route = { from: Point; to: Point; sideA: PortSide; sideB: PortSide; gap: number; horizontal: boolean; lateral: Point }

/**
 * The route curved or angled lanes take between the shapes of `frame`, or undefined when they run straight: in the straight style, when the sides that face each other are not
 * opposite or are less than `MIN_ROUTE_GAP` apart, and, for a right-angled pair, when the run across is shorter than `ANGLE_RUN`.
 */
function routeOf(frame: Frame, style: LineStyle): Route | undefined {
  if (style === 'straight') return undefined
  const { a, b, n } = frame
  const p = ports(a.rect, b.rect, a.edge, b.edge)
  const [out, back] = [OUT[p.fromSide], OUT[p.toSide]]
  if (out[0] + back[0] !== 0 || out[1] + back[1] !== 0) return undefined
  const gap = (p.to.x - p.from.x) * out[0] + (p.to.y - p.from.y) * out[1]
  if (gap < MIN_ROUTE_GAP) return undefined
  const horizontal = out[1] === 0
  if (style === 'angled' && (horizontal ? Math.abs(p.to.y - p.from.y) : Math.abs(p.to.x - p.from.x)) < ANGLE_RUN) return undefined
  if (style === 'curved' && curveSteepness(p.from, p.to, p.fromSide, p.toSide, gap) * KAPPA_MAX < GAP_LEAST) return undefined
  const lateral = horizontal ? { x: 0, y: n.y >= 0 ? 1 : -1 } : { x: n.x >= 0 ? 1 : -1, y: 0 }
  return { from: p.from, to: p.to, sideA: p.fromSide, sideB: p.toSide, gap, horizontal, lateral }
}

/** The smaller half-room of the two shapes across the lanes of `frame`: along the normal for straight lanes, along the sides for the lanes of a route. */
function spanOf(frame: Frame, route: Route | undefined): number {
  const across = route?.lateral ?? frame.n
  return Math.min(halfRoom(frame.a, across), halfRoom(frame.b, across))
}

/**
 * The smaller half-room of the two shapes of a pair across their lanes: how far each outline is from the line between the centres, along its normal, the nearer side of the nearer
 * shape. In the curved and angled styles, where the pair has a curve or a staircase, the same measured along the sides the lanes are moved along.
 */
export function roomOf(one: LaneBox, other: LaneBox, style: LineStyle = 'straight'): number {
  const frame = frameOf(one, other)
  return spanOf(frame, routeOf(frame, style))
}

/** The gutter between the lanes of the two directions: only where there are lanes both ways. */
const gutterOf = (slot: Slot): number => (slot.back > 0 && slot.lanes - slot.back > 0 ? GUTTER : 0)

/** The room for lanes across a pair: twice the smaller half-room of the two shapes along `n`, less the margin each side. */
export function usableOf(half: number): number {
  return 2 * (half - MARGIN)
}

/**
 * How many lanes fit across `half` (the smaller half-room of the two shapes), at the usual pitch, and no more than `MOST`. At least one. `trunks` of them are trunks, which take
 * `TRUNK_EXTRA` more room each: `min(8, floor((usable - gutter - 6 * trunks) / pitch) + 1)`.
 */
export function laneCapacity(half: number, bothWays: boolean, trunks = 0): number {
  const fit = Math.floor((usableOf(half) - (bothWays ? GUTTER : 0) - TRUNK_EXTRA * trunks) / PITCH) + 1
  return Math.max(1, Math.min(MOST, fit))
}

/** The pitch for a pair: the usual one, or less when more lanes than fit across `half` are drawn, so every lane still meets the outline (until trunks fold them, see foldPair in trunks.ts). */
export function pitchFor(half: number, slot: Slot): number {
  if (slot.lanes < 2) return PITCH
  return Math.max(0, Math.min(PITCH, (usableOf(half) - gutterOf(slot) - TRUNK_EXTRA * (slot.stack?.length ?? 0)) / (slot.lanes - 1)))
}

/**
 * How far every lane of a pair sits to the right of the line between the centres (along `n`): the lanes are centred on it, in two groups with the gutter between. A trunk takes
 * `TRUNK_EXTRA` more room on its outer side (the side away from the line between the centres; the right-hand one for a trunk on it), where its hairlines lie, so each lane beyond a trunk
 * is moved that far out, and the bundle is centred again.
 */
export function offsetsOf(slot: Slot, pitch = PITCH): number[] {
  const gutter = gutterOf(slot)
  const raw = Array.from({ length: slot.lanes }, (_, lane) => (lane - (slot.lanes - 1) / 2) * pitch + (gutter === 0 ? 0 : lane < slot.back ? -gutter / 2 : gutter / 2))
  const stack = slot.stack
  if (stack === undefined || stack.length === 0) return raw
  const moved = raw.map((o, lane) => {
    let by = 0
    for (const t of stack) if (t !== lane) by += raw[t] >= 0 ? (lane > t ? TRUNK_EXTRA : 0) : lane < t ? -TRUNK_EXTRA : 0
    return o + by
  })
  const middle = (Math.max(...moved) + Math.min(...moved)) / 2
  return moved.map(o => o - middle)
}

/** How far lane `slot.lane` sits to the right of the line between the centres (along `n`), see offsetsOf. */
export function offsetOf(slot: Slot, pitch = PITCH): number {
  if (slot.stack === undefined || slot.stack.length === 0) {
    const gutter = gutterOf(slot)
    const side = gutter === 0 ? 0 : slot.lane < slot.back ? -gutter / 2 : gutter / 2
    return (slot.lane - (slot.lanes - 1) / 2) * pitch + side
  }
  return offsetsOf(slot, pitch)[slot.lane]
}

/**
 * The way a trunk's hairlines lie behind it: the unit step, along the normal of the pair, towards its outer side (see offsetsOf), which the first hairline is `HAIRLINE_GAP` out and
 * the second twice as far. A trunk on the line between the centres lies towards the right-hand side. Rounded as the lanes are.
 */
export function stackStep(source: LaneBox, target: LaneBox, slot: Slot): Point {
  const { n } = frameOf(source, target)
  const out = offsetOf(slot) >= 0 ? 1 : -1
  return { x: round3(n.x * out + 0), y: round3(n.y * out + 0) } // + 0 turns a -0 into 0
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

/** The path through `points`: short curves through their midpoints, so the lane is smooth and passes where the displaced line was sampled. */
function chain(points: readonly Point[]): string {
  const last = points.length - 1
  let path = `M${pointText(points[0])}`
  for (let i = 1; i < last; i++) {
    const next = points[i + 1]
    path += `Q${pointText(points[i])} ${pointText(roundedPoint((points[i].x + next.x) / 2, (points[i].y + next.y) / 2))}`
  }
  return `${path}L${pointText(points[last])}`
}

/**
 * The lane `slot` of the pair between `source` and `target`, drawn from `source` to `target`, in `pose` and in a line `style`. A lane at rest is the straight line between the two points
 * where its line (parallel to the line between the centres) meets the two outlines. A lane in another pose is the same line moved sideways by a field that is 0 at both ends and
 * largest in the middle, written as 24 short curves, so the shapes and the heads never move:
 *   moved(t) = bulge(t) * ((f - 1) * s * offset + a * sum over lit lanes j of lam[j] * sign(lane - j))
 * `f` widens the middle to a pitch of at most `SPREAD_PITCH`; `a` opens a gap beside a lit lane. Every lane is moved by the same field in its own place, and the offset and the
 * second term only grow with the lane's place, so the lanes keep their order: they never cross.
 *
 * In the curved and angled styles a pair whose sides face each other with room between them has curved or right-angled lanes instead (see curvedLane and angledLane); otherwise its
 * lanes are straight, whatever the style.
 */
export function laneGeometry(source: LaneBox, target: LaneBox, slot: Slot, pose: Pose = REST, style: LineStyle = 'straight'): Lane {
  const frame = frameOf(source, target)
  const route = routeOf(frame, style)
  if (route !== undefined) return style === 'curved' ? curvedLane(frame, route, source, slot, pose) : angledLane(frame, route, source, slot, pose)
  const { a, b, ca, cb, u, n } = frame
  const pitch = pitchFor(spanOf(frame, undefined), slot)
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
  const middle = points[SAMPLES / 2]
  return { path: chain(points), x: middle.x, y: middle.y, points }
}

/** A point of the cubic through `p0, c1, c2, p3` at `t`. */
function cubicAt(t: number, p0: Point, c1: Point, c2: Point, p3: Point): Point {
  const u = 1 - t
  const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return { x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x, y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y }
}

/**
 * A lane of a curved pair. The curve a lone line of the pair would be is React Flow's cubic between the middles of the two facing sides, leaving each side straight out for half the gap
 * between them. Lane k is that curve with all four points moved along the sides, to the lane's side of the pair, by `offset * kappa`, where `kappa = min(KAPPA_MAX, 1 / |m|)` and `|m|`
 * is how far the curve runs along the way out of the sides in its middle, which makes the lanes a pitch apart across the curve there, however steep it is. Where a shape's outline is not
 * straight across the side the moved end is in the air or inside the shape, so the lane is joined to the outline by a short straight stub along the way out, and the curve itself stays
 * the moved copy of the one curve.
 *
 * A pair that is not at rest moves each lane along the sides too, by the field of laneGeometry (0 at both ends, so the ends and the stubs do not move). All the lanes are then graphs
 * of one function over the way out of the sides, shifted by amounts that grow with the lane's place, so they never cross, in any pose and however tightly the curve bends.
 */
function curvedLane(frame: Frame, route: Route, source: LaneBox, slot: Slot, pose: Pose): Lane {
  const { a, b, ca, cb } = frame
  const span = spanOf(frame, route)
  const pitch = pitchFor(span, slot)
  const offset = offsetOf(slot, pitch)
  const [outA, outB] = [OUT[route.sideA], OUT[route.sideB]]
  const widest = widestOf(slot, pitch)
  const kappa = Math.min(KAPPA_MAX, 1 / curveSteepness(route.from, route.to, route.sideA, route.sideB, route.gap), widest === 0 ? Infinity : (span - SIDE_AIR) / widest)
  const along = (c: Point, by: number): Point => ({ x: c.x + route.lateral.x * by, y: c.y + route.lateral.y * by })
  const [p0, p1, p2, p3] = curveOf(route.from, route.to, route.sideA, route.sideB, route.gap).map(c => along(c, offset * kappa))
  const [q0, q1, q2, q3] = [roundedPoint(p0.x, p0.y), roundedPoint(p1.x, p1.y), roundedPoint(p2.x, p2.y), roundedPoint(p3.x, p3.y)]
  // Where the lane meets the outlines: the ray out of the shape from the lane's side of its middle. On a straight side that is the end of the curve itself.
  const exitA = leaveAt(a.rect, a.edge, outA[0], outA[1], along(ca, offset * kappa))
  const exitB = leaveAt(b.rect, b.edge, outB[0], outB[1], along(cb, offset * kappa))
  const [e0, e3] = [roundedPoint(exitA.x, exitA.y), roundedPoint(exitB.x, exitB.y)]
  const [stubA, stubB] = [e0.x !== q0.x || e0.y !== q0.y, e3.x !== q3.x || e3.y !== q3.y]
  const sideways = displacement(slot, pose, frame.length, pitch) * kappa
  const samples: Point[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const at = cubicAt(i / SAMPLES, q0, q1, q2, q3)
    const away = bulge(i / SAMPLES) * sideways
    samples.push(i === 0 ? q0 : i === SAMPLES ? q3 : roundedPoint(at.x + route.lateral.x * away, at.y + route.lateral.y * away))
  }
  // From the shape with the smaller id to the other; the lane runs the other way when it starts at the other shape.
  const forward = source === a
  const inOrder = (list: Point[]): Point[] => (forward ? list : [...list].reverse())
  const points = inOrder([...(stubA ? [e0] : []), ...samples, ...(stubB ? [e3] : [])])
  if (sideways !== 0) {
    const middle = samples[SAMPLES / 2]
    return { path: chain(points), x: middle.x, y: middle.y, points }
  }
  const run = forward ? { head: stubA ? e0 : undefined, from: q0, c1: q1, c2: q2, to: q3, tail: stubB ? e3 : undefined } : { head: stubB ? e3 : undefined, from: q3, c1: q2, c2: q1, to: q0, tail: stubA ? e0 : undefined }
  const path = `M${pointText(run.head ?? run.from)}${run.head ? `L${pointText(run.from)}` : ''}C${pointText(run.c1)} ${pointText(run.c2)} ${pointText(run.to)}${run.tail ? `L${pointText(run.tail)}` : ''}`
  return { path, x: round3((q0.x + 3 * q1.x + 3 * q2.x + q3.x) / 8), y: round3((q0.y + 3 * q1.y + 3 * q2.y + q3.y) / 8), points }
}

/**
 * The path through the corners of a right-angled lane, `radii[i - 1]` the radius of the corner at `vertices[i]`: straight legs, and each turn rounded by a quadratic curve that starts and
 * ends that far from the corner (no more than half of either leg, and not under `CORNER_LEAST`). A turn between two legs on a line is no turn. The points are the lane flattened.
 */
function staircase(vertices: readonly Point[], radii: readonly number[]): { path: string; points: Point[] } {
  const last = vertices.length - 1
  let path = `M${pointText(vertices[0])}`
  const points: Point[] = [vertices[0]]
  for (let i = 1; i < last; i++) {
    const [p, b, q] = [vertices[i - 1], vertices[i], vertices[i + 1]]
    const [before, after] = [Math.abs(b.x - p.x) + Math.abs(b.y - p.y), Math.abs(q.x - b.x) + Math.abs(q.y - b.y)]
    const radius = Math.min(Math.max(radii[i - 1], CORNER_LEAST), before / 2, after / 2)
    if ((p.x === b.x && b.x === q.x) || (p.y === b.y && b.y === q.y) || !(radius > 0)) {
      path += `L${pointText(b)}`
      points.push(b)
      continue
    }
    const enter = roundedPoint(b.x - sign(b.x - p.x) * radius, b.y - sign(b.y - p.y) * radius)
    const leave = roundedPoint(b.x + sign(q.x - b.x) * radius, b.y + sign(q.y - b.y) * radius)
    path += `L${pointText(enter)}Q${pointText(b)} ${pointText(leave)}`
    points.push(enter)
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t
      points.push(roundedPoint(u * u * enter.x + 2 * u * t * b.x + t * t * leave.x, u * u * enter.y + 2 * u * t * b.y + t * t * leave.y))
    }
    points.push(leave)
  }
  points.push(vertices[last])
  return { path: `${path}L${pointText(vertices[last])}`, points }
}

/**
 * A lane of a right-angled pair. The staircase a lone line of the pair would be goes out of the middle of one side, across to the middle of the way between the shapes, along the
 * run, and across to the middle of the other side (S, (cx, sy), (cx, ty), T). Lane k leaves its side `offset` along it, to the lane's side of the pair, and its run is moved the same
 * distance the other way (across the legs), so the lanes are nested staircases the same gap apart that never cross; where the legs are too short for that, the runs are squeezed
 * together by the same factor, which keeps their order. A pair that is not at rest moves only the run, by the displacement of laneGeometry, so the ends and the legs stay where they
 * were. The corners are rounded to concentric arcs: the radius of the outer corner is the radius of the inner one plus the gap between them.
 */
function angledLane(frame: Frame, route: Route, source: LaneBox, slot: Slot, pose: Pose): Lane {
  const { a, b, ca, cb } = frame
  const pitch = pitchFor(spanOf(frame, route), slot)
  const offset = offsetOf(slot, pitch)
  const [outA, outB] = [OUT[route.sideA], OUT[route.sideB]]
  const moved = (c: Point): Point => ({ x: c.x + route.lateral.x * offset, y: c.y + route.lateral.y * offset })
  const exitA = leaveAt(a.rect, a.edge, outA[0], outA[1], moved(ca))
  const exitB = leaveAt(b.rect, b.edge, outB[0], outB[1], moved(cb))
  const [s, t] = [roundedPoint(exitA.x, exitA.y), roundedPoint(exitB.x, exitB.y)]
  // Where the run of each lane is among the others: its offset and what the pose adds; all of them at once, to know how much room they need.
  // (an open trunk's lines each have a run of their own: lane by lane, and within a lane, line by line)
  const runs = Array.from({ length: slot.lanes }, (_, lane) => Array.from({ length: slot.fan?.[lane] ?? 1 }, (__, within) => {
    const there = { ...slot, lane, ...(slot.fan === undefined ? {} : { within }) }
    return offsetOf(there, pitch) + displacement(there, pose, frame.length, pitch)
  })).flat()
  const widestRun = runs.reduce((most, r) => Math.max(most, Math.abs(r)), 0)
  const room = route.gap / 2 - LEG_AIR
  const squeeze = widestRun <= room ? 1 : Math.max(0, room) / widestRun
  const run = squeeze * (offset + displacement(slot, pose, frame.length, pitch))
  const [hx, hy] = [sign(route.to.x - route.from.x), sign(route.to.y - route.from.y)]
  const radius = Math.max(CORNER, widestOf(slot, pitch) + CORNER_AIR)
  // The first and the second corner, by the gap between the lane's corner and the lone line's: the corner on the inside of a turn has the smaller radius.
  const turn = hx * hy * offset
  let vertices: Point[]
  let radii: number[]
  let anchor: Point
  if (route.horizontal) {
    const x = round3((route.from.x + route.to.x) / 2 - hy * run)
    vertices = [s, { x, y: s.y }, { x, y: t.y }, t]
    radii = [radius - turn, radius + turn]
    anchor = { x, y: round3((s.y + t.y) / 2) }
  } else {
    const y = round3((route.from.y + route.to.y) / 2 + hx * run)
    vertices = [s, { x: s.x, y }, { x: t.x, y }, t]
    radii = [radius + turn, radius - turn]
    anchor = { x: round3((s.x + t.x) / 2), y }
  }
  if (source !== frame.a) {
    vertices = [...vertices].reverse()
    radii = [...radii].reverse()
  }
  const { path, points } = staircase(vertices, radii)
  return { path, x: anchor.x, y: anchor.y, points }
}

/** The sign of `x`: -1, 0 or 1. */
const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0)

/** How far the outermost lane of a pair is from the line between the centres. The lanes are centred, so it is the same either side. */
function widestOf(slot: Slot, pitch: number): number {
  let widest = 0
  for (let k = 0; k < slot.lanes; k++) widest = Math.max(widest, Math.abs(offsetOf({ ...slot, lane: k }, pitch)))
  return widest
}

/**
 * How far the middle of lane `slot.lane` is moved along `n` in `pose`, for a pair whose shapes are `length` apart and whose lanes are `pitch` apart: the widening of a spread
 * pair plus the gap opened beside each lit lane. 0 for a pair at rest, and for a single line.
 */
export function displacement(slot: Slot, pose: Pose, length: number, pitch: number): number {
  if (slot.lanes < 2 && slot.fan === undefined && pose.lam.every(l => l === 0)) return 0
  const offset = offsetOf(slot, pitch)
  const spread = Math.min(SPREAD_PITCH / pitch, 1 + (0.2 * length) / (widestOf(slot, pitch) + PITCH))
  const gap = Math.min(18, 0.2 * length)
  let parted = 0
  pose.lam.forEach((lit, j) => {
    parted += lit * sign(slot.lane - j)
  })
  return (spread - 1) * pose.s * offset + gap * parted + fanned(slot)
}

/**
 * How far an open trunk moves the middle of a lane along `n`: its own lines fan out of its place, a `PITCH` apart and centred on it (the line's `within` among the `fan` of the lane),
 * and the lanes beside it are moved away by the half of the fan on their side. A pair with no open trunk has none. The ends of every lane stay where they were, so the lines of an open
 * trunk meet at its ends, and the field is monotone in the lane, so nothing crosses.
 */
function fanned(slot: Slot): number {
  const fan = slot.fan
  if (fan === undefined) return 0
  let by = ((slot.within ?? 0) - (fan[slot.lane] - 1) / 2) * PITCH
  fan.forEach((count, j) => {
    if (j !== slot.lane) by += (sign(slot.lane - j) * (count - 1) * PITCH) / 2
  })
  return by
}

/**
 * The clear space left on each side of a lit lane in the middle of its pair while a step plays on it: the usual pitch plus the gap `displacement` opens (18 px at most). The most
 * the marks of an outcome (a bar, a clock, a puff) may reach is held to what the gap there leaves (see markReach).
 */
export const PART_CLEAR = 30

/** How long the lanes take to move from one lit lane to another, or to close when the stop is left (ms), and to part from wherever they are when the player jumps (ms). */
export const SHIFT_MS = 195
export const JUMP_MS = 225

/** How faded the lines of a pair are that the step does not ride, while a step plays on the pair: more than the lines of other pairs (0.15), less than the lanes of the flow's other branches (0.55). */
export const KIN_OPACITY = 0.35

/** How much of its strength a lit lane keeps once its step has timed out, where it has neighbours: never fainter than they are (0.35), so more than the 0.25 a lone line fades to. */
export const LIT_FLOOR_LANES = 0.5

/**
 * How a pair's lanes go from one pose to the next over a stop: `from` and `to` say how lit each lane is (the `lam` of a pose; 1 for a lane a step rides) when the stop begins and
 * once it has settled. Between `at` and `at + dur` ms of the stop they move from one to the other, `out` slowing down towards the end (a first parting), `smooth` slow at both
 * ends (from one lit lane to another, or back to rest). The pair holds `to` from then until the stop is left, through every rest of a repeat. The pose is a pure function of this
 * and of the player's clock (see poseAt), so pausing, scrubbing and the speed all work, and a fixture can pin any moment.
 */
export type Parting = { readonly from: readonly number[]; readonly to: readonly number[]; readonly at: number; readonly dur: number; readonly ease: 'out' | 'smooth' }

/** How far an ease has come at `p` (0 to 1): `out` is a cubic that starts fast and settles, `smooth` the smoothstep. Multiplications only. */
export const partEase = (kind: Parting['ease'], p: number): number => {
  if (kind === 'out') {
    const q = 1 - p
    return 1 - q * q * q
  }
  return p * p * (3 - 2 * p)
}

/** The pose of a pair `clock` ms into the stop: how lit each lane is, between `from` and `to`. Never spread (a step playing on a pair wins over its selection). */
export function poseAt(parting: Parting, clock: number): Pose {
  const p = parting.dur <= 0 ? 1 : Math.min(1, Math.max(0, (clock - parting.at) / parting.dur))
  const e = partEase(parting.ease, p)
  const n = Math.max(parting.from.length, parting.to.length)
  const lam: number[] = []
  for (let j = 0; j < n; j++) {
    const [before, after] = [parting.from[j] ?? 0, parting.to[j] ?? 0]
    lam.push(round3(before + (after - before) * e))
  }
  return lam.every(l => l === 0) ? REST : { s: 0, lam }
}

/** Whether every lane is unlit. */
const unlit = (lam: readonly number[]): boolean => lam.every(l => l === 0)

/**
 * How the lanes of a pair go from how lit they are (`before`, what is on screen now) to how lit the stop on show wants them (`lit`).
 * - `jump`: the player went somewhere other than the next stop or the one before (a scrub, another flow): from where they are, over JUMP_MS, easing out, from the start of the stop.
 * - From rest to a lit lane: at the step's `part` beat (when it has one; else at once), over its length, easing out.
 * - Otherwise (from one lit lane to another, or back to rest): at the start of the stop, over SHIFT_MS, smooth. The pair never closes between two steps that ride it.
 */
export function partingFor(before: readonly number[], lit: readonly number[], how: { beat?: { at: number; dur: number }; jump?: boolean } = {}): Parting {
  if (how.jump === true) return { from: before, to: lit, at: 0, dur: JUMP_MS, ease: 'out' }
  if (unlit(before) && !unlit(lit)) return { from: before, to: lit, at: how.beat?.at ?? 0, dur: how.beat?.dur ?? JUMP_MS, ease: 'out' }
  return { from: before, to: lit, at: 0, dur: SHIFT_MS, ease: 'smooth' }
}

/**
 * For each pair that has several lines and one that a step of the stop rides (`lit` lists the ids of the strands the stop's steps ride), how lit each of its lanes is: 1 for a
 * lane a step rides, 0 for the others. Every lit lane of a stop is lit at once, so an event to several subscribers on one pair opens the gaps for all of them together.
 */
export function litLanes(strands: readonly Strand[], lit: readonly string[]): Map<string, number[]> {
  const out = new Map<string, number[]>()
  const riding = new Set(lit)
  for (const s of strands) {
    if (s.lanes < 2 || !riding.has(s.id)) continue
    const lam = out.get(s.pair) ?? Array.from({ length: s.lanes }, () => 0)
    lam[s.lane] = 1
    out.set(s.pair, lam)
  }
  return out
}

/** The pitch and the distance between the shapes of a pair of boxes the lane `slot` is among: what a pose and the marks need to say where the neighbours of a lane are. */
function layoutOf(source: LaneBox, target: LaneBox, slot: Slot, style: LineStyle): { pitch: number; length: number } {
  const frame = frameOf(source, target)
  return { pitch: pitchFor(spanOf(frame, routeOf(frame, style)), slot), length: frame.length }
}

/**
 * The distance across, at fraction `t` (0 to 1) of the way along a lane, from the lane `slot` to the nearest of its neighbours in `pose`, in pixels: the pitch at both ends and
 * more in the middle where a lit lane has opened a gap beside it (PART_CLEAR beside a lit lane). Infinity for a lane with no neighbour. The marks of an outcome use it to stay
 * clear of the lines beside.
 */
export function gapBeside(source: LaneBox, target: LaneBox, slot: Slot, pose: Pose, t: number, style: LineStyle = 'straight'): number {
  if (slot.lanes < 2) return Infinity
  const { pitch, length } = layoutOf(source, target, slot, style)
  const at = (lane: number): number => {
    const mine = { ...slot, lane }
    return offsetOf(mine, pitch) + bulge(t) * displacement(mine, pose, length, pitch)
  }
  const here = at(slot.lane)
  let gap = Infinity
  if (slot.lane > 0) gap = Math.min(gap, here - at(slot.lane - 1))
  if (slot.lane < slot.lanes - 1) gap = Math.min(gap, at(slot.lane + 1) - here)
  return round3(gap)
}

/**
 * How far a mark may reach from the lane it sits on, given the `gap` to the nearest neighbour there: its own half-extent `half` (a bar's 22, a clock's 24, a puff's 40) held to
 * what the gap leaves, less 3 px of air, and never below 6 so it stays a mark. A lane with no neighbour (a gap of Infinity) keeps its whole extent.
 */
export const markReach = (half: number, gap: number): number => (gap === Infinity ? half : round3(Math.min(half, Math.max(6, gap - 3))))

/**
 * How far from the lit lane a mark that hangs off it (the marker of whoever takes an intercepted request) must stand to clear every other lane of the bundle: the widest lane
 * offset from the middle plus the gap a lit lane opens. 0 for a lane with no neighbours.
 */
export function bundleReach(source: LaneBox, target: LaneBox, slot: Slot, style: LineStyle = 'straight'): number {
  if (slot.lanes < 2) return 0
  const { pitch, length } = layoutOf(source, target, slot, style)
  return round3(widestOf(slot, pitch) + Math.min(18, 0.2 * length))
}

/** How far ahead of the pattern, in pixels, the dots of a stream on lane `slot` start: lane * 12.1 / lanes, so the streams of neighbouring lanes do not march in step (the pattern repeats every 12 px). */
export const dashPhase = (slot: { lane: number; lanes: number }): number => round3((slot.lane * 12.1) / slot.lanes)

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
