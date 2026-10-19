import { Graph, layout } from '@dagrejs/dagre'
import type { Edge, FitViewOptions, Node, Viewport, XYPosition } from '@xyflow/react'
import type { Problem } from '../../src/core/check.ts'
import type { BoxTraffic } from '../../src/core/perf.ts'
import { iconData } from '../../src/core/look.ts'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { computeView, memberIds, placeEnds } from '../../src/core/views.ts'
import type { Edge as ViewEdge } from '../../src/core/views.ts'

/** Every box has the same size, so dagre can place them before the browser draws them. Keep in sync with .box in style.css. */
export const BOX = { width: 200, height: 72 }
/** A node's size as the browser measured it, or BOX until it has. */
export const sizeOf = (n: { measured?: { width?: number; height?: number } }) =>
  ({ width: n.measured?.width ?? BOX.width, height: n.measured?.height ?? BOX.height })
/** Width of the details panel to begin with: you can drag it wider or narrower. Keep in sync with .panel in style.css. */
export const PANEL = 380
/** Width of the navigator panel on the left to begin with. Keep in sync with .navpanel in style.css. */
export const NAV = 320

const NEAR = 80 // between the members and the outsiders around them
const STACK = 30 // between boxes stacked in a column or row
const PER_ROW = 4 // outsiders that only start lines wait above the members, this many to a row

/** `inside`: how many boxes sit right inside this one (0: it doesn't open). */
export type BoxData = { object: FlowyObject; inside: number; icon: string; perf?: BoxTraffic }
export type BoxNode = Node<BoxData, 'box'>

/**
 * A flow on the canvas: where each step lands in the view (placeEnds, null if it can't be shown), and
 * the step to light up. Without `step` the flow's boxes are there but nothing is lit or dimmed.
 */
export type Playing = { ends: ([string, string] | null)[]; step?: number }

export const lineId = (from: string, to: string) => `${from} ${to}`

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined
const overlaps = (a: XYPosition, b: XYPosition) => Math.abs(a.x - b.x) < BOX.width && Math.abs(a.y - b.y) < BOX.height

type Spots = Map<string, XYPosition>
type Ends = { from: string; to: string }

/** A line from (ax, ay) to (bx, by), between the centres of two boxes. Plain numbers: tangle runs often. */
type Segment = { ax: number; ay: number; bx: number; by: number }

/** Which side of the line through p and q the point (rx, ry) is on: 1, -1, or 0 when it's on the line. */
const turn = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px))

/** Whether segment s and the segment (cx, cy)–(dx, dy) cross at a point inside both. Touching or lying in line doesn't count. */
function crosses(s: Segment, cx: number, cy: number, dx: number, dy: number): boolean {
  return turn(s.ax, s.ay, s.bx, s.by, cx, cy) * turn(s.ax, s.ay, s.bx, s.by, dx, dy) < 0
    && turn(cx, cy, dx, dy, s.ax, s.ay) * turn(cx, cy, dx, dy, s.bx, s.by) < 0
}

/**
 * Whether segment s runs through the box at p. Its ends sit outside the box, so it does exactly when
 * it crosses one of the box's diagonals. The box is shrunk by 4px so a line grazing a corner doesn't count.
 */
function runsThrough(s: Segment, p: XYPosition): boolean {
  const [l, t, r, b] = [p.x + 4, p.y + 4, p.x + BOX.width - 4, p.y + BOX.height - 4]
  return crosses(s, l, t, r, b) || crosses(s, r, t, l, b)
}

/**
 * How tangled a layout looks: each pair of lines that cross (lines from the same box never do), plus
 * each time a line runs through a box that isn't one of its ends. Lines are taken centre to centre.
 * With `moved`, it counts only what involves those boxes, which is all a move of them can change:
 * the move's effect is `tangle(after, edges, moved) - tangle(before, edges, moved)`.
 */
export function tangle(at: Spots, edges: Ends[], moved?: ReadonlySet<string>): number {
  const half = { x: BOX.width / 2, y: BOX.height / 2 }
  const lines = edges.filter(e => e.from !== e.to && at.has(e.from) && at.has(e.to)).map(e => {
    const [a, b] = [at.get(e.from)!, at.get(e.to)!]
    return { from: e.from, to: e.to, ax: a.x + half.x, ay: a.y + half.y, bx: b.x + half.x, by: b.y + half.y, moves: !moved || moved.has(e.from) || moved.has(e.to) }
  })
  const boxes = [...at]
  const movedBoxes = moved ? boxes.filter(([id]) => moved.has(id)) : boxes
  let score = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // Each crossing pair is counted once, from the first of its lines that moves.
    if (l.moves) for (let j = 0; j < lines.length; j++) {
      const m = lines[j]
      if (j === i || (m.moves && j < i)) continue
      const shared = m.from === l.from || m.from === l.to || m.to === l.from || m.to === l.to
      if (!shared && crosses(l, m.ax, m.ay, m.bx, m.by)) score++
    }
    for (const [id, p] of l.moves ? boxes : movedBoxes) if (id !== l.from && id !== l.to && runsThrough(l, p)) score++
  }
  return score
}

/**
 * Pairs of boxes next to each other. Within each group of `rows`, boxes in the same row (same y), in
 * order along it; within each group of `columns`, boxes in the same column (same x). Boxes never pair
 * across groups, so an outsider never trades places with a member, and a view's own boxes never trade
 * places up and down: those are dagre's ranks, and a swap would point lines upwards.
 */
function neighbours(at: Spots, rows: string[][], columns: string[][]): [string, string][] {
  const pairs: [string, string][] = []
  const pair = (ids: string[], across: 'x' | 'y', along: 'x' | 'y') => {
    const lines = new Map<number, string[]>()
    for (const id of ids) {
      const k = Math.round(at.get(id)![across])
      lines.set(k, [...(lines.get(k) ?? []), id])
    }
    for (const line of lines.values()) {
      line.sort((a, b) => at.get(a)![along] - at.get(b)![along])
      for (let i = 1; i < line.length; i++) pairs.push([line[i - 1], line[i]])
    }
  }
  for (const ids of rows) pair(ids, 'y', 'x')
  for (const ids of columns) pair(ids, 'x', 'y')
  return pairs
}

/**
 * Swaps neighbouring boxes (see neighbours) while a swap makes the layout less tangled, until a whole
 * pass swaps nothing, or after `passes` passes. Boxes only trade spots, so the layout's shape stays the
 * same. Without groups, any two boxes in a row may trade.
 */
export function untangle(at: Spots, edges: Ends[], rows: string[][] = [[...at.keys()]], columns: string[][] = [], passes = 30): Spots {
  const next = new Map(at)
  let score = tangle(next, edges)
  for (let pass = 0; pass < passes && score > 0; pass++) {
    let swapped = false
    for (const [a, b] of neighbours(next, rows, columns)) {
      const pair = new Set([a, b])
      const before = tangle(next, edges, pair)
      const pa = next.get(a)!
      const pb = next.get(b)!
      next.set(a, pb).set(b, pa)
      const change = tangle(next, edges, pair) - before
      if (change < 0) {
        score += change
        swapped = true
      } else next.set(a, pa).set(b, pb)
    }
    if (!swapped) break
  }
  return next
}

/** dagre's top-left corner for each box, given the lines between them. */
function dagreAt(boxes: string[], edges: ViewEdge[], gap: { nodesep: number; ranksep: number }): Map<string, XYPosition> {
  const g = new Graph()
  g.setGraph({ rankdir: 'TB', ...gap })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of boxes) g.setNode(id, { ...BOX })
  for (const e of edges) if (boxes.includes(e.from) && boxes.includes(e.to)) g.setEdge(e.from, e.to)
  layout(g)
  return new Map(boxes.map(id => {
    const { x, y } = g.node(id)
    return [id, { x: x - BOX.width / 2, y: y - BOX.height / 2 }]
  }))
}

/** Where an outsider waits: in the column left or right of the members, or in the rows below or above. */
export type Region = 'left' | 'right' | 'below' | 'above'
const REGIONS: Region[] = ['left', 'right', 'below', 'above']

/** Outsiders that only start lines (people, mostly). They always wait above. */
const startsOnly = (id: string, edges: Ends[]) => edges.some(e => e.from === id) && !edges.some(e => e.to === id)

/**
 * A view's members where dagre put them (`at`), how far they reach, and for each outsider the average
 * place of the members it connects to (the middle when it connects to none). None of this changes
 * while the outsiders move around, so it's worked out once. `people` only start lines and wait above.
 */
export function membersOf(inner: Spots, outsiders: string[], edges: Ends[]) {
  const spots = [...inner.values()]
  const left = Math.min(...spots.map(p => p.x))
  const right = Math.max(...spots.map(p => p.x)) + BOX.width
  const top = Math.min(...spots.map(p => p.y))
  const bottom = Math.max(...spots.map(p => p.y)) + BOX.height
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 }
  const mean = new Map(outsiders.map((id): [string, XYPosition] => {
    const ps = edges.flatMap(e => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).flatMap(end => inner.get(end) ?? [])
    const avg = (axis: 'x' | 'y') => ps.reduce((sum, p) => sum + p[axis], 0) / ps.length
    return [id, ps.length === 0 ? middle : { x: avg('x'), y: avg('y') }]
  }))
  const people = outsiders.filter(id => startsOnly(id, edges))
  return { at: inner, left, right, top, bottom, middle, mean, people, rest: outsiders.filter(id => !people.includes(id)) }
}
type Members = ReturnType<typeof membersOf>

/**
 * Inside a box: the members sit together in the middle. The outsiders stay at the edges: people above,
 * in rows, and the rest where `region` says, in a column on either side or in rows below or above.
 * Each group is sorted by where the members it connects to are, which keeps lines from crossing on the
 * way in. Also returns which boxes may trade places (see untangle): members and the rows above and
 * below along their rows, the side columns up and down.
 */
export function arrange(m: Members, region: (id: string) => Region): { at: Spots; rows: string[][]; columns: string[][] } {
  const at = new Map(m.at)
  const byMean = (ids: string[], axis: 'x' | 'y') => ids.sort((a, b) => m.mean.get(a)![axis] - m.mean.get(b)![axis])
  // Rows of at most PER_ROW, centred under or over the members. `y` gives each row's top.
  const putRows = (ids: string[], y: (row: number) => number) => {
    for (let row = 0; row * PER_ROW < ids.length; row++) {
      const r = ids.slice(row * PER_ROW, (row + 1) * PER_ROW)
      const width = r.length * BOX.width + (r.length - 1) * STACK
      r.forEach((id, j) => at.set(id, { x: m.middle.x - width / 2 + j * (BOX.width + STACK), y: y(row) }))
    }
  }

  const columns = [byMean(m.rest.filter(id => region(id) === 'left'), 'y'), byMean(m.rest.filter(id => region(id) === 'right'), 'y')]
  const height = (n: number) => n * BOX.height + Math.max(0, n - 1) * STACK
  const tallest = Math.max(0, ...columns.map(c => height(c.length)))
  columns.forEach((ids, i) => {
    const x = i === 0 ? m.left - NEAR - BOX.width : m.right + NEAR
    ids.forEach((id, j) => at.set(id, { x, y: m.middle.y - height(ids.length) / 2 + j * (BOX.height + STACK) }))
  })
  // Rows above and below are wider than the members, so they clear the side columns too.
  const below = byMean(m.rest.filter(id => region(id) === 'below'), 'x')
  const belowTop = Math.max(m.bottom, m.middle.y + tallest / 2) + NEAR
  putRows(below, row => belowTop + row * (BOX.height + STACK))
  const above = byMean([...m.people, ...m.rest.filter(id => region(id) === 'above')], 'x')
  const aboveBottom = Math.min(m.top, m.middle.y - tallest / 2) - NEAR - BOX.height
  putRows(above, row => aboveBottom - row * (BOX.height + STACK))
  return { at, rows: [[...m.at.keys()], above, below], columns }
}

/**
 * Moves outsiders between the side columns and the rows below and above, one at a time, keeping a move
 * when it makes the layout less tangled, until a whole pass moves nothing (or `passes` passes).
 */
function settle(m: Members, edges: Ends[], start: Map<string, Region>, passes: number): Map<string, Region> {
  const region = new Map(start)
  const arranged = () => arrange(m, id => region.get(id)!).at
  let at = arranged()
  let score = tangle(at, edges)
  for (let pass = 0; pass < passes && score > 0; pass++) {
    let changed = false
    for (const id of region.keys()) for (const r of REGIONS) {
      const was = region.get(id)!
      if (r === was) continue
      region.set(id, r)
      const next = arranged()
      // A move re-sorts the groups it leaves and joins, so more than one box can shift.
      const moved = new Set([...next.keys()].filter(k => next.get(k)!.x !== at.get(k)!.x || next.get(k)!.y !== at.get(k)!.y))
      const change = tangle(next, edges, moved) - tangle(at, edges, moved)
      if (change < 0) {
        score += change
        at = next
        changed = true
      } else region.set(id, was)
    }
    if (!changed) break
  }
  return region
}

/** The same ids in an order that only depends on `seed`, so a layout never changes between runs. */
function shuffled(ids: string[], seed: number): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Where every box of a view goes when nothing is saved. Finding the least tangled layout is NP-hard, so,
 * like dagre itself, this settles for a good one. dagre starts from several orders of the boxes (as
 * given, reversed, most lines first, then a few fixed shuffles), and the outsiders from two places
 * (split between the side columns, or all in rows below). From each start, outsiders move between sides
 * while that helps (settle), then boxes trade places (untangle). The least tangled wins, the first on a
 * tie, so a clean view keeps its side columns.
 */
function place(members: string[], around: string[], edges: ViewEdge[]): Spots {
  const lines = edges.map(e => ({ from: e.from, to: e.to }))
  const degree = (id: string) => lines.filter(e => e.from === id || e.to === id).length
  // Known limit: a big view tries one starting order with fewer passes, so it still opens without a pause;
  // a time budget would let it try more where the machine is fast
  const big = (members.length + around.length) * lines.length > 2000
  const passes = big ? 5 : 30
  const orders = [(ids: string[]) => ids, (ids: string[]) => [...ids].reverse(), (ids: string[]) => [...ids].sort((a, b) => degree(b) - degree(a))]
    .concat([1, 2, 3, 4, 5, 6].map(seed => (ids: string[]) => shuffled(ids, seed)))
    .slice(0, big ? 1 : undefined)
  let best: Spots | undefined
  let bestScore = Infinity
  const consider = (at: Spots, rows: string[][], columns: string[][]) => {
    const tidy = untangle(at, lines, rows, columns, passes)
    const score = tangle(tidy, lines)
    if (score < bestScore) [best, bestScore] = [tidy, score]
  }
  for (const order of orders) {
    if (members.length === 0 || around.length === 0) {
      const all = order([...members, ...around])
      consider(dagreAt(all, edges, { nodesep: 60, ranksep: 90 }), [all], [])
      continue
    }
    const m = membersOf(dagreAt(order(members), edges, { nodesep: 40, ranksep: 70 }), order(around), lines)
    // Split by where their members are: the left half of them in the left column, the rest on the right.
    const rest = [...m.rest].sort((a, b) => m.mean.get(a)!.x - m.mean.get(b)!.x)
    const split = new Map(rest.map((id, i): [string, Region] => [id, i < Math.floor(rest.length / 2) ? 'left' : 'right']))
    const below = new Map(rest.map((id): [string, Region] => [id, 'below']))
    for (const start of [split, below]) {
      const region = settle(m, lines, start, passes)
      const { at, rows, columns } = arrange(m, id => region.get(id)!)
      consider(at, rows, columns)
    }
  }
  return best!
}

// toGraph runs again on every flow step and selection change, so placements are kept by what they're made from.
const placements = new Map<string, Spots>()
function placeCached(members: string[], around: string[], edges: ViewEdge[]): Spots {
  const key = JSON.stringify([members, around, edges.map(e => [e.from, e.to])])
  let at = placements.get(key)
  if (!at) {
    at = place(members, around, edges)
    if (placements.size >= 50) placements.delete(placements.keys().next().value!)
    placements.set(key, at)
  }
  return at
}

/**
 * The React Flow nodes and edges for one view. A box keeps its layout.yaml position; the rest are
 * placed by `place` (dagre, then untangled), moved down past any saved box they would
 * cover. While a flow plays, the current step's two boxes and its line stay lit and everything else
 * is dimmed. A step with no line of its own gets a dashed one. Boxes only the flow uses join for the
 * whole flow, as outsiders, so nothing moves between steps. Boxes and lines with problems get the
 * class "problem". Lines keep their labels here; focusEdges decides which to show.
 */
export function toGraph(model: Model, view: string, playing?: Playing, problems: Problem[] = []): { nodes: BoxNode[]; edges: Edge[]; members: string[] } {
  const { members, outsiders, edges } = computeView(model, view)
  const flowBoxes = (playing?.ends ?? []).flatMap(e => e ?? [])
  const boxes = [...new Set([...members, ...outsiders, ...flowBoxes])]
  const dimming = playing?.step !== undefined
  const lit = playing?.step === undefined ? undefined : playing.ends[playing.step]
  const around = boxes.filter(id => !members.includes(id))
  const placed = placeCached(members, around, edges)

  const saved = Object.hasOwn(model.layout, view) ? model.layout[view] : {}
  const at = new Map<string, XYPosition>()
  for (const id of boxes) if (Object.hasOwn(saved, id)) at.set(id, { x: saved[id][0], y: saved[id][1] })
  for (const id of boxes) {
    if (at.has(id)) continue
    const p = { ...placed.get(id)! }
    // Known limit: steps down one row at a time and checks every box; fine for a diagram's worth of boxes
    while ([...at.values()].some(q => overlaps(p, q))) p.y += BOX.height + 30
    at.set(id, p)
  }

  const badBoxes = new Set(problems.flatMap(p => (p.id === undefined ? [] : [p.id])))
  const badLines = new Set(problems.flatMap(p => {
    const c = p.connection === undefined ? undefined : model.connections[p.connection]
    const ends = c && placeEnds(model, view, c.from, c.to)
    return ends ? [lineId(...ends)] : []
  }))
  const isLit = (from: string, to: string) => lit?.[0] === from && lit[1] === to
  const nodes = boxes.map((id): BoxNode => ({
    id,
    type: 'box',
    position: at.get(id)!,
    data: { object: model.objects[id], inside: memberIds(model, id).length, icon: iconData(model, model.objects[id]) },
    className: classes(!members.includes(id) && 'outsider', dimming && (lit?.includes(id) ? 'lit' : 'dim'), badBoxes.has(id) && 'problem'),
  }))
  // A lit line draws over the faded boxes (zIndex), with an arrowhead in its own colour.
  const litLine = { zIndex: 1, markerEnd: { type: 'arrowclosed', color: 'var(--accent)' } } as const
  const lines: Edge[] = edges.map(e => ({
    id: lineId(e.from, e.to),
    type: 'line',
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    markerEnd: { type: 'arrowclosed' },
    className: classes(dimming && (isLit(e.from, e.to) ? 'active' : 'dim'), badLines.has(lineId(e.from, e.to)) && 'problem'),
    ...(dimming && isLit(e.from, e.to) ? litLine : {}),
  }))
  if (lit && lit[0] !== lit[1] && !edges.some(e => isLit(e.from, e.to))) // a one-box step lights its box, no line
    lines.push({ id: 'step', type: 'line', source: lit[0], target: lit[1], className: 'step', ...litLine })
  return { nodes, edges: lines, members }
}

/**
 * Lines stay quiet. A label shows only on a line you point at or select, on the lines of the
 * selected box, and on the line a flow has lit. When a box is selected its lines stand out and
 * the others fade (class "faint"). The line pointed at, on the canvas or in a box's panel, stands
 * out from those too (class "hover").
 */
export function focusEdges(edges: Edge[], focus: { box?: string; line?: string; hover?: string }): Edge[] {
  return edges.map(e => {
    const touches = e.source === focus.box || e.target === focus.box
    const shown = touches || e.id === focus.line || e.id === focus.hover || e.className?.includes('active')
    return {
      ...e,
      label: shown ? e.label : undefined,
      selected: e.id === focus.line,
      className: classes(e.className, focus.box !== undefined && !touches && 'faint', e.id === focus.hover && 'hover'),
    }
  })
}

export type Rect = XYPosition & { width: number; height: number }

/** A shape's outline as a convex polygon in the box's own 200×72 area, or empty for the rectangle (see ShapeDef.edge). */
export type Outline = readonly (readonly [number, number])[]

/**
 * Where a ray from the centre of `r` towards (dx, dy) meets the shape's outline: the rectangle's border when `edge` is empty,
 * else the first side of the polygon it crosses. Dividing by zero gives infinity, which Math.min ignores.
 */
export function leaveAt(r: Rect, edge: Outline, dx: number, dy: number): XYPosition {
  const cx = r.x + r.width / 2
  const cy = r.y + r.height / 2
  if (edge.length === 0) {
    const k = Math.min(r.width / 2 / Math.abs(dx), r.height / 2 / Math.abs(dy)) // how far along the line the box's border is
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

/** Where a straight line between the centres of two shapes leaves one and enters the other. A shape without an `edge` is the box itself. */
export function lineEnds(a: Rect, b: Rect, edgeA: Outline = [], edgeB: Outline = []): [XYPosition, XYPosition] {
  const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  const leave = (from: Rect, edge: Outline, to: Rect): XYPosition => {
    const c = centre(from)
    const dx = centre(to).x - c.x
    const dy = centre(to).y - c.y
    return dx === 0 && dy === 0 ? c : leaveAt(from, edge, dx, dy)
  }
  return [leave(a, edgeA, b), leave(b, edgeB, a)]
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** The side of `from` that faces `to`: the one a line between their centres leaves through. */
function facing(from: Rect, to: Rect): Side {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) * from.height > Math.abs(dy) * from.width) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

const AXIS: Record<Side, [number, number]> = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }

/** The middle of one side of a shape: where the line along that axis from its centre meets the outline. */
const middleOf = (r: Rect, side: Side, edge: Outline): XYPosition => leaveAt(r, edge, ...AXIS[side])

/** Where a curved or right-angled line starts and ends: the middle of the side each shape turns to the other. */
export function ports(a: Rect, b: Rect, edgeA: Outline = [], edgeB: Outline = []): { from: XYPosition; fromSide: Side; to: XYPosition; toSide: Side } {
  const fromSide = facing(a, b)
  const toSide = facing(b, a)
  return { from: middleOf(a, fromSide, edgeA), fromSide, to: middleOf(b, toSide, edgeB), toSide }
}

/** The frame around a view's own boxes: their bounding box plus `pad` on every side. */
export function frameAround(rects: Rect[], pad = 28): Rect {
  const x = Math.min(...rects.map(r => r.x)) - pad
  const y = Math.min(...rects.map(r => r.y)) - pad
  const right = Math.max(...rects.map(r => r.x + r.width)) + pad
  const bottom = Math.max(...rects.map(r => r.y + r.height)) + pad
  return { x, y, width: right - x, height: bottom - y }
}

export const FRAME = '~frame' // ids can't hold a ~, so this never clashes with a box
export type FrameNode = Node<{ name: string }, 'frame'>

/**
 * The frame named `name` around a view's own boxes. It takes no clicks: React Flow sets pointer-events
 * on every node while the canvas has click handlers, and only the node's own style wins over that, so
 * a click on the blank space inside still reaches the canvas. Its size is given as measured too, or
 * React Flow forgets it on every render and Camera waits for it.
 */
export function frameNode(name: string, rects: Rect[]): FrameNode {
  const r = frameAround(rects)
  return {
    id: FRAME, type: 'frame', data: { name }, position: { x: r.x, y: r.y }, width: r.width, height: r.height,
    measured: { width: r.width, height: r.height }, style: { pointerEvents: 'none' },
    selectable: false, draggable: false, connectable: false, focusable: false, zIndex: -1,
  }
}

/** What fitView is given: room for the details panel (right) and the navigator (left), each as wide as it is or 0 when closed, and for the flow player. */
export const fitOptions = (panel: number, player: boolean, nav = 0): FitViewOptions => ({
  maxZoom: 1,
  padding: { top: '40px', left: `${nav > 0 ? nav + 40 : 40}px`, right: `${panel > 0 ? panel + 40 : 40}px`, bottom: `${player ? 200 : 40}px` },
})

/**
 * Where to move the viewport so `box` shows between the navigator (`nav` wide, 0 when closed) and the details panel, or undefined when
 * it already does. `size` is the canvas. A box wider than the room keeps its left edge in sight.
 */
export function panIntoView(box: Rect, view: Viewport, size: { width: number; height: number }, panel = PANEL, margin = 24, nav = 0): Viewport | undefined {
  const room = size.width - Math.min(panel, size.width)
  const left = box.x * view.zoom + view.x
  const top = box.y * view.zoom + view.y
  const shift = (from: number, to: number, limit: number, start = 0) => Math.max(start + margin - from, Math.min(0, limit - margin - to))
  const dx = shift(left, left + box.width * view.zoom, room, nav)
  const dy = shift(top, top + box.height * view.zoom, size.height)
  return dx === 0 && dy === 0 ? undefined : { ...view, x: view.x + dx, y: view.y + dy }
}
