import { Graph, layout } from '@dagrejs/dagre'
import type { Edge, FitViewOptions, Node, Viewport, XYPosition } from '@xyflow/react'
import type { Problem } from '../../src/core/check.ts'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { computeView, memberIds, placeEnds } from '../../src/core/views.ts'
import type { Edge as ViewEdge } from '../../src/core/views.ts'

/** Every box has the same size, so dagre can place them before the browser draws them. Keep in sync with .box in style.css. */
export const BOX = { width: 200, height: 72 }
/** A node's size as the browser measured it, or BOX until it has. */
export const sizeOf = (n: { measured?: { width?: number; height?: number } }) =>
  ({ width: n.measured?.width ?? BOX.width, height: n.measured?.height ?? BOX.height })
/** Width of the side panel at most. Keep in sync with .panel in style.css. */
export const PANEL = 380

const NEAR = 80 // between the members and the outsiders around them
const STACK = 30 // between boxes stacked in a column or row
const PER_ROW = 4 // outsiders that only start lines wait above the members, this many to a row

/** `inside`: how many boxes sit right inside this one (0: it doesn't open). */
export type BoxData = { object: FlowyObject; inside: number }
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

const centreOf = (p: XYPosition): XYPosition => ({ x: p.x + BOX.width / 2, y: p.y + BOX.height / 2 })

/** Whether segments ab and cd cross at a point inside both. Touching or overlapping in line doesn't count. */
function crosses(a: XYPosition, b: XYPosition, c: XYPosition, d: XYPosition): boolean {
  const turn = (p: XYPosition, q: XYPosition, r: XYPosition) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x))
  return turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0
}

/**
 * Whether segment ab runs through the box at p. Its ends sit outside the box, so it does exactly when
 * it crosses one of the box's diagonals. The box is shrunk by 4px so a line grazing a corner doesn't count.
 */
function runsThrough(a: XYPosition, b: XYPosition, p: XYPosition): boolean {
  const [l, t, r, btm] = [p.x + 4, p.y + 4, p.x + BOX.width - 4, p.y + BOX.height - 4]
  return crosses(a, b, { x: l, y: t }, { x: r, y: btm }) || crosses(a, b, { x: r, y: t }, { x: l, y: btm })
}

/**
 * How tangled a layout looks: each pair of lines that cross (lines from the same box never do), plus
 * each time a line runs through a box that isn't one of its ends. Lines are taken centre to centre.
 */
export function tangle(at: Spots, edges: Ends[]): number {
  const lines = edges.filter(e => e.from !== e.to && at.has(e.from) && at.has(e.to))
    .map(e => ({ ...e, a: centreOf(at.get(e.from)!), b: centreOf(at.get(e.to)!) }))
  let score = 0
  lines.forEach((l, i) => {
    for (const m of lines.slice(i + 1)) {
      const shared = [m.from, m.to].includes(l.from) || [m.from, m.to].includes(l.to)
      if (!shared && crosses(l.a, l.b, m.a, m.b)) score++
    }
    for (const [id, p] of at) if (id !== l.from && id !== l.to && runsThrough(l.a, l.b, p)) score++
  })
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
  // ponytail: about passes × pairs × lines² work, fine for a diagram's tens of boxes; a few hundred would need incremental scoring
  for (let pass = 0; pass < passes && score > 0; pass++) {
    let swapped = false
    for (const [a, b] of neighbours(next, rows, columns)) {
      const pa = next.get(a)!
      const pb = next.get(b)!
      next.set(a, pb).set(b, pa)
      const s = tangle(next, edges)
      if (s < score) {
        score = s
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

/**
 * Inside a box: the members sit together in the middle, laid out by dagre. The outsiders stay at the
 * edges. Those that only start lines (people, mostly) wait above, in rows. With `shape: 'columns'` the
 * rest split into a column on each side, so a box with ten neighbours isn't one very wide row; with
 * `'below'` they wait in rows underneath. Also returns which boxes may trade places (see untangle):
 * members, the rows above and the rows below along their rows, the side columns up and down.
 */
function arrange(members: string[], outsiders: string[], edges: ViewEdge[], shape: 'columns' | 'below'): { at: Spots; rows: string[][]; columns: string[][] } {
  const at = dagreAt(members, edges, { nodesep: 40, ranksep: 70 })
  const spots = [...at.values()]
  const left = Math.min(...spots.map(p => p.x))
  const right = Math.max(...spots.map(p => p.x)) + BOX.width
  const top = Math.min(...spots.map(p => p.y))
  const bottom = Math.max(...spots.map(p => p.y)) + BOX.height
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 }

  // Sorting each group by where its members are keeps lines from crossing on the way in.
  const mean = (id: string, axis: 'x' | 'y') => {
    const ends = edges.flatMap(e => (e.from === id ? [e.to] : e.to === id ? [e.from] : []))
    const ps = ends.flatMap(end => at.get(end) ?? [])
    return ps.length === 0 ? middle[axis] : ps.reduce((sum, p) => sum + p[axis], 0) / ps.length
  }
  const byMean = (ids: string[], axis: 'x' | 'y') => ids.map(id => [id, mean(id, axis)] as const).sort((a, b) => a[1] - b[1]).map(([id]) => id)
  const starts = (id: string) => edges.some(e => e.from === id) && !edges.some(e => e.to === id)
  // Rows of at most PER_ROW, centred under or over the members. `y` gives each row's top.
  const putRows = (ids: string[], y: (row: number) => number) => {
    for (let row = 0; row * PER_ROW < ids.length; row++) {
      const r = ids.slice(row * PER_ROW, (row + 1) * PER_ROW)
      const width = r.length * BOX.width + (r.length - 1) * STACK
      r.forEach((id, j) => at.set(id, { x: middle.x - width / 2 + j * (BOX.width + STACK), y: y(row) }))
    }
  }

  const rest = byMean(outsiders.filter(id => !starts(id)), 'x')
  const columns = shape === 'columns' ? [rest.slice(0, Math.floor(rest.length / 2)), rest.slice(Math.floor(rest.length / 2))] : []
  const height = (n: number) => n * BOX.height + Math.max(0, n - 1) * STACK
  const tallest = Math.max(0, ...columns.map(c => height(c.length)))
  columns.forEach((ids, i) => {
    const x = i === 0 ? left - NEAR - BOX.width : right + NEAR
    byMean(ids, 'y').forEach((id, j) => at.set(id, { x, y: middle.y - height(ids.length) / 2 + j * (BOX.height + STACK) }))
  })
  if (shape === 'below') putRows(rest, row => bottom + NEAR + row * (BOX.height + STACK))

  const above = byMean(outsiders.filter(starts), 'x')
  const bottomRow = Math.min(top, middle.y - tallest / 2) - NEAR - BOX.height
  putRows(above, row => bottomRow - row * (BOX.height + STACK))
  return { at, rows: [members, above, shape === 'below' ? rest : []], columns }
}

/**
 * Where every box of a view goes when nothing is saved. Finding the least tangled layout is NP-hard, so,
 * like dagre itself, this settles for a good one: both shapes from three starting orders, each
 * untangled, and the least tangled wins (the first on a tie, so a clean view keeps today's look).
 */
function place(members: string[], around: string[], edges: ViewEdge[]): Spots {
  const lines = edges.map(e => ({ from: e.from, to: e.to }))
  const degree = (id: string) => lines.filter(e => e.from === id || e.to === id).length
  // ponytail: a big view tries one starting order with fewer passes, so it still opens without a pause;
  // scoring only the lines a swap moves would let it do the full search
  const big = (members.length + around.length) * lines.length > 2000
  const orders = [(ids: string[]) => ids, (ids: string[]) => [...ids].reverse(), (ids: string[]) => [...ids].sort((a, b) => degree(b) - degree(a))]
    .slice(0, big ? 1 : 3)
  const shapes = members.length > 0 && around.length > 0 ? (['columns', 'below'] as const) : ([undefined] as const)
  let best: Spots | undefined
  let bestScore = Infinity
  for (const shape of shapes) for (const order of orders) {
    const { at, rows, columns } = shape
      ? arrange(order(members), order(around), edges, shape)
      : { at: dagreAt(order([...members, ...around]), edges, { nodesep: 60, ranksep: 90 }), rows: [[...members, ...around]], columns: [] }
    const tidy = untangle(at, lines, rows, columns, big ? 5 : 30)
    const score = tangle(tidy, lines)
    if (score < bestScore) [best, bestScore] = [tidy, score]
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
    // ponytail: steps down one row at a time and checks every box; fine for a diagram's worth of boxes
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
    data: { object: model.objects[id], inside: memberIds(model, id).length },
    className: classes(!members.includes(id) && 'outsider', dimming && !lit?.includes(id) && 'dim', badBoxes.has(id) && 'problem'),
  }))
  const lines: Edge[] = edges.map(e => ({
    id: lineId(e.from, e.to),
    type: 'line',
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    markerEnd: { type: 'arrowclosed' },
    className: classes(dimming && (isLit(e.from, e.to) ? 'active' : 'dim'), badLines.has(lineId(e.from, e.to)) && 'problem'),
  }))
  if (lit && lit[0] !== lit[1] && !edges.some(e => isLit(e.from, e.to))) // a one-box step lights its box, no line
    lines.push({ id: 'step', type: 'line', source: lit[0], target: lit[1], markerEnd: { type: 'arrowclosed' }, className: 'step' })
  return { nodes, edges: lines, members }
}

/**
 * Lines stay quiet. A label shows only on a line you point at or select, on the lines of the
 * selected box, and on the line a flow has lit. When a box is selected its lines stand out and
 * the others fade (class "faint").
 */
export function focusEdges(edges: Edge[], focus: { box?: string; line?: string; hover?: string }): Edge[] {
  return edges.map(e => {
    const touches = e.source === focus.box || e.target === focus.box
    const shown = touches || e.id === focus.line || e.id === focus.hover || e.className?.includes('active')
    return {
      ...e,
      label: shown ? e.label : undefined,
      selected: e.id === focus.line,
      className: classes(e.className, focus.box !== undefined && !touches && 'faint'),
    }
  })
}

export type Rect = XYPosition & { width: number; height: number }

/** Where a straight line between the centres of two boxes leaves one and enters the other. */
export function lineEnds(a: Rect, b: Rect): [XYPosition, XYPosition] {
  const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 })
  const edge = (from: Rect, to: Rect): XYPosition => {
    const c = centre(from)
    const dx = centre(to).x - c.x
    const dy = centre(to).y - c.y
    if (dx === 0 && dy === 0) return c
    const k = Math.min(from.width / 2 / Math.abs(dx), from.height / 2 / Math.abs(dy)) // how far along the line the box's border is
    return { x: c.x + dx * k, y: c.y + dy * k }
  }
  return [edge(a, b), edge(b, a)]
}

export type Side = 'top' | 'right' | 'bottom' | 'left'

/** The side of `from` that faces `to`: the one a line between their centres leaves through. */
function facing(from: Rect, to: Rect): Side {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2)
  const dy = to.y + to.height / 2 - (from.y + from.height / 2)
  if (Math.abs(dx) * from.height > Math.abs(dy) * from.width) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'bottom' : 'top'
}

const middleOf = (r: Rect, side: Side): XYPosition => ({
  top: { x: r.x + r.width / 2, y: r.y },
  bottom: { x: r.x + r.width / 2, y: r.y + r.height },
  left: { x: r.x, y: r.y + r.height / 2 },
  right: { x: r.x + r.width, y: r.y + r.height / 2 },
})[side]

/** Where a curved or right-angled line starts and ends: the middle of the side each box turns to the other. */
export function ports(a: Rect, b: Rect): { from: XYPosition; fromSide: Side; to: XYPosition; toSide: Side } {
  const fromSide = facing(a, b)
  const toSide = facing(b, a)
  return { from: middleOf(a, fromSide), fromSide, to: middleOf(b, toSide), toSide }
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

/** What fitView is given: room for the side panel and the flow player, when they're there. */
export const fitOptions = (panel: boolean, player: boolean): FitViewOptions => ({
  maxZoom: 1,
  padding: { top: '40px', left: '40px', right: `${panel ? PANEL + 40 : 40}px`, bottom: `${player ? 200 : 40}px` },
})

/**
 * Where to move the viewport so `box` shows left of the side panel, or undefined when it already
 * does. `size` is the canvas. A box wider than the room keeps its left edge in sight.
 */
export function panIntoView(box: Rect, view: Viewport, size: { width: number; height: number }, panel = PANEL, margin = 24): Viewport | undefined {
  const room = size.width - Math.min(panel, size.width)
  const left = box.x * view.zoom + view.x
  const top = box.y * view.zoom + view.y
  const shift = (from: number, to: number, limit: number) => Math.max(margin - from, Math.min(0, limit - margin - to))
  const dx = shift(left, left + box.width * view.zoom, room)
  const dy = shift(top, top + box.height * view.zoom, size.height)
  return dx === 0 && dy === 0 ? undefined : { ...view, x: view.x + dx, y: view.y + dy }
}
