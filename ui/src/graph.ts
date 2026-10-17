import { Graph, layout } from '@dagrejs/dagre'
import type { Edge, FitViewOptions, Node, Viewport, XYPosition } from '@xyflow/react'
import type { Problem } from '../../src/core/check.ts'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { computeView, memberIds, placeEnds } from '../../src/core/views.ts'
import type { Edge as ViewEdge } from '../../src/core/views.ts'

/** Every box has the same size, so dagre can place them before the browser draws them. Keep in sync with .box in style.css. */
export const BOX = { width: 200, height: 72 }
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
 * edges. Those that only start lines (people, mostly) wait above, in rows. The rest split into a
 * column on each side, so a box with ten neighbours isn't one very wide row.
 */
function arrange(members: string[], outsiders: string[], edges: ViewEdge[]): Map<string, XYPosition> {
  const at = dagreAt(members, edges, { nodesep: 40, ranksep: 70 })
  const spots = [...at.values()]
  const left = Math.min(...spots.map(p => p.x))
  const right = Math.max(...spots.map(p => p.x)) + BOX.width
  const top = Math.min(...spots.map(p => p.y))
  const middle = { x: (left + right) / 2, y: (top + Math.max(...spots.map(p => p.y)) + BOX.height) / 2 }

  // Sorting each group by where its members are keeps lines from crossing on the way in.
  const mean = (id: string, axis: 'x' | 'y') => {
    const ends = edges.flatMap(e => (e.from === id ? [e.to] : e.to === id ? [e.from] : []))
    const ps = ends.flatMap(end => at.get(end) ?? [])
    return ps.length === 0 ? middle[axis] : ps.reduce((sum, p) => sum + p[axis], 0) / ps.length
  }
  const byMean = (ids: string[], axis: 'x' | 'y') => ids.map(id => [id, mean(id, axis)] as const).sort((a, b) => a[1] - b[1]).map(([id]) => id)
  const starts = (id: string) => edges.some(e => e.from === id) && !edges.some(e => e.to === id)

  const sides = byMean(outsiders.filter(id => !starts(id)), 'x')
  const columns = [sides.slice(0, Math.floor(sides.length / 2)), sides.slice(Math.floor(sides.length / 2))]
  const height = (n: number) => n * BOX.height + Math.max(0, n - 1) * STACK
  const tallest = Math.max(...columns.map(c => height(c.length)))
  columns.forEach((ids, i) => {
    const x = i === 0 ? left - NEAR - BOX.width : right + NEAR
    byMean(ids, 'y').forEach((id, j) => at.set(id, { x, y: middle.y - height(ids.length) / 2 + j * (BOX.height + STACK) }))
  })

  const above = byMean(outsiders.filter(starts), 'x')
  const bottomRow = Math.min(top, middle.y - tallest / 2) - NEAR - BOX.height
  for (let row = 0; row * PER_ROW < above.length; row++) {
    const ids = above.slice(row * PER_ROW, (row + 1) * PER_ROW)
    const width = ids.length * BOX.width + (ids.length - 1) * STACK
    ids.forEach((id, j) => at.set(id, { x: middle.x - width / 2 + j * (BOX.width + STACK), y: bottomRow - row * (BOX.height + STACK) }))
  }
  return at
}

/**
 * The React Flow nodes and edges for one view. A box keeps its layout.yaml position; the rest are
 * placed by dagre (see arrange for views with outsiders), moved down past any saved box they would
 * cover. While a flow plays, the current step's two boxes and its line stay lit and everything else
 * is dimmed. A step with no line of its own gets a dashed one. Boxes only the flow uses join for the
 * whole flow, as outsiders, so nothing moves between steps. Boxes and lines with problems get the
 * class "problem". Lines keep their labels here; focusEdges decides which to show.
 */
export function toGraph(model: Model, view: string, playing?: Playing, problems: Problem[] = []): { nodes: BoxNode[]; edges: Edge[] } {
  const { members, outsiders, edges } = computeView(model, view)
  const flowBoxes = (playing?.ends ?? []).flatMap(e => e ?? [])
  const boxes = [...new Set([...members, ...outsiders, ...flowBoxes])]
  const dimming = playing?.step !== undefined
  const lit = playing?.step === undefined ? undefined : playing.ends[playing.step]
  const around = boxes.filter(id => !members.includes(id))
  const placed = members.length > 0 && around.length > 0 ? arrange(members, around, edges) : dagreAt(boxes, edges, { nodesep: 60, ranksep: 90 })

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
  return { nodes, edges: lines }
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
