import type { Edge, FitViewOptions, Node, Viewport, XYPosition } from '@xyflow/react'
import type { Problem } from '../../src/core/problem.ts'
import { lineKey } from '../../src/core/failures.ts'
import type { Mark } from '../../src/core/failures.ts'
import type { BoxTraffic } from '../../src/core/perf/types.ts'
import type { StateMark } from '../../src/core/states.ts'
import { iconData } from '../../src/core/look.ts'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { childCount, computeView, nameOf, placeEnds } from '../../src/core/views.ts'
import { BOX, arrange, membersOf, spotsOf, tangle, untangle } from '../../src/core/layout.ts'
import type { Region } from '../../src/core/layout.ts'

// The layout moved to src/core so the MCP server can run it too; the page keeps importing it from here.
export { BOX, arrange, membersOf, tangle, untangle }
export type { Region }

/** A node's size as the browser measured it, or BOX until it has. */
export const sizeOf = (n: { measured?: { width?: number; height?: number } }) =>
  ({ width: n.measured?.width ?? BOX.width, height: n.measured?.height ?? BOX.height })
/** Width of the details panel to begin with: you can drag it wider or narrower. Keep in sync with .panel in style.css. */
export const PANEL = 380
/** Width of the navigator panel on the left to begin with. Keep in sync with .navpanel in style.css. */
export const NAV = 320


/**
 * `inside`: how many boxes sit right inside this one (0: it doesn't open). `perf`: how strained it is at a load. `fail`: the worst failure mode it carries, and how many.
 * `state`: the state it is in (or holds, when `inside`), at the stop on show; a shape that is Running has none.
 * `snap`: the state changes at once, with none of the fade a change usually has (a slider of a run is being dragged).
 */
export type BoxData = { object: FlowyObject; inside: number; icon: string; perf?: BoxTraffic; fail?: Mark; state?: StateMark; snap?: boolean }
export type BoxNode = Node<BoxData, 'box'>

/**
 * A flow on the canvas: where each step lands in the view (placeEnds, null if it can't be shown), and
 * the step to light up. Without `step` or `steps` the flow's boxes are there but nothing is lit or dimmed.
 * `steps` lights several at once (a parallel stop); `faint` draws steps as dashed, faint lanes (the lanes of a
 * branch this stop is not in) without lighting their boxes.
 */
export type Playing = { ends: ([string, string] | null)[]; step?: number; steps?: number[]; faint?: number[]; also?: string[] }

/** Whether an edge is one a flow step added (it has no connection of its own), so a click on it opens no panel. */
export const isStepLine = (id: string): boolean => /^(step|lane)(-\d+)?$/.test(id)

/** What a screen reader says for a line: the two shapes by name, and the line's label ("Customer app to Order API, REST"), not the ids React Flow would read. */
export const lineName = (model: Model, from: string, to: string, label?: string): string => `${nameOf(model, from)} to ${nameOf(model, to)}${label ? `, ${label}` : ''}`

/** The core's lineKey; App.tsx still calls it lineId. */
export const lineId = lineKey

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined


/**
 * The React Flow nodes and edges for one view. A box keeps its layout.yaml position; the rest are
 * placed by `place` (dagre, then untangled), moved down past any saved box they would
 * cover. While a flow plays, the current step's two boxes and its line stay lit and everything else
 * is dimmed. A step with no line of its own gets a dashed one. Boxes only the flow uses join for the
 * whole flow, as outsiders, so nothing moves between steps. Boxes and lines with problems get the
 * class "problem". Boxes in `states` (the marks of the stop on show, see marksOf) carry their state. Lines keep their labels here; focusEdges decides which to show.
 */
export function toGraph(model: Model, view: string, playing?: Playing, problems: Problem[] = [], states: Record<string, StateMark> = {}): { nodes: BoxNode[]; edges: Edge[]; members: string[] } {
  const computed = computeView(model, view)
  const { members, outsiders, edges } = computed
  const flowBoxes = (playing?.ends ?? []).flatMap(e => e ?? [])
  const boxes = [...new Set([...members, ...outsiders, ...flowBoxes])]
  const stepsLit = playing?.steps ?? (playing?.step === undefined ? undefined : [playing.step])
  const dimming = stepsLit !== undefined
  const placedAt = (i: number) => playing?.ends[i] ?? undefined
  const litEnds = (stepsLit ?? []).flatMap(i => {
    const e = placedAt(i)
    return e ? [e] : []
  })
  const litBoxes = new Set([...litEnds.flat(), ...(playing?.also ?? [])]) // `also`: a shape that takes a request off a line is lit with the step
  const at = spotsOf(model, view, computed, boxes)

  const badBoxes = new Set(problems.flatMap(p => (p.id === undefined ? [] : [p.id])))
  const badLines = new Set(problems.flatMap(p => {
    const c = p.connection === undefined ? undefined : model.connections[p.connection]
    const ends = c && placeEnds(model, view, c.from, c.to)
    return ends ? [lineKey(...ends)] : []
  }))
  const isLit = (from: string, to: string) => litEnds.some(e => e[0] === from && e[1] === to)
  const faintSteps = (playing?.faint ?? []).flatMap(i => {
    const e = placedAt(i)
    return e ? [{ i, e }] : []
  })
  const isFaint = (from: string, to: string) => faintSteps.some(f => f.e[0] === from && f.e[1] === to)
  const inView = new Set(members)
  const nodes = boxes.map((id): BoxNode => ({
    id,
    type: 'box',
    position: at.get(id)!,
    data: { object: model.objects[id], inside: childCount(model, id), icon: iconData(model, model.objects[id]), ...(Object.hasOwn(states, id) ? { state: states[id] } : {}) },
    className: classes(!inView.has(id) && 'outsider', dimming && (litBoxes.has(id) ? 'lit' : 'dim'), badBoxes.has(id) && 'problem'),
  }))
  // A lit line draws over the faded boxes (zIndex), with an arrowhead in its own colour.
  const litLine = { zIndex: 1, markerEnd: { type: 'arrowclosed', color: 'var(--accent)' } } as const
  const lines: Edge[] = edges.map(e => ({
    id: lineKey(e.from, e.to),
    type: 'line',
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    ariaLabel: lineName(model, e.from, e.to, e.label),
    markerEnd: { type: 'arrowclosed' },
    className: classes(dimming && (isLit(e.from, e.to) ? 'active' : isFaint(e.from, e.to) ? 'lane' : 'dim'), badLines.has(lineKey(e.from, e.to)) && 'problem'),
    ...(dimming && isLit(e.from, e.to) ? litLine : {}),
  }))
  // A one-box step lights its box, no line. A step with no connection of its own gets a dashed line, and so does a faint one.
  const drawn = new Set<string>()
  litEnds.forEach((e, n) => {
    const id = lineKey(e[0], e[1])
    if (e[0] === e[1] || edges.some(c => c.from === e[0] && c.to === e[1]) || drawn.has(id)) return
    drawn.add(id)
    lines.push({ id: n === 0 ? 'step' : `step-${n}`, type: 'line', source: e[0], target: e[1], ariaLabel: lineName(model, e[0], e[1]), className: 'step', ...litLine })
  })
  for (const { i, e } of faintSteps) {
    const id = lineKey(e[0], e[1])
    if (e[0] === e[1] || edges.some(c => c.from === e[0] && c.to === e[1]) || drawn.has(id)) continue
    drawn.add(id)
    lines.push({ id: `lane-${i}`, type: 'line', source: e[0], target: e[1], ariaLabel: lineName(model, e[0], e[1]), className: 'lane', markerEnd: { type: 'arrowclosed' } })
  }
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
      data: { ...e.data, label: e.label }, // what a line shows when it is pointed at (see Line)
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

/**
 * How far inside the shape drawn in `r` the point (x, y) is: positive inside, 0 on the outline, negative outside (close to the distance from it).
 * The shape is its outline, or the box itself when `edge` is empty. A line that runs behind a shape is covered by it, and traffic on that line
 * goes dim as its depth grows (see `behind` in traffic.ts).
 */
export function depthIn(r: Rect, edge: Outline, x: number, y: number): number {
  if (edge.length === 0) return Math.min(x - r.x, r.x + r.width - x, y - r.y, r.y + r.height - y)
  // The outline is convex, so the depth is the point's distance from the nearest side, on the inner side, whichever way the outline winds.
  let area = 0
  for (let i = 0; i < edge.length; i++) {
    const [px, py] = edge[i]
    const [qx, qy] = edge[(i + 1) % edge.length]
    area += px * qy - qx * py
  }
  const inward = area < 0 ? -1 : 1
  let depth = Infinity
  for (let i = 0; i < edge.length; i++) {
    const [px, py] = edge[i]
    const [qx, qy] = edge[(i + 1) % edge.length]
    const cross = (qx - px) * (y - r.y - py) - (qy - py) * (x - r.x - px)
    depth = Math.min(depth, (inward * cross) / Math.hypot(qx - px, qy - py))
  }
  return depth
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
export type FrameNode = Node<{ name: string; onOpen?: () => void }, 'frame'>

/**
 * The frame named `name` around a view's own boxes. It takes no clicks: React Flow sets pointer-events
 * on every node while the canvas has click handlers, and only the node's own style wins over that, so
 * a click on the blank space inside still reaches the canvas. Only its outline and its name take a click (see
 * Frame in Box.tsx), which calls `onOpen`: a click on the system you are inside. Its size is given as measured
 * too, or React Flow forgets it on every render and Camera waits for it.
 */
export function frameNode(name: string, rects: Rect[], onOpen?: () => void): FrameNode {
  const r = frameAround(rects)
  return {
    id: FRAME, type: 'frame', data: { name, onOpen }, position: { x: r.x, y: r.y }, width: r.width, height: r.height,
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

/** Milliseconds a click on a box that opens waits, in case it is the first half of a double-click. */
export const DOUBLE_CLICK = 250
