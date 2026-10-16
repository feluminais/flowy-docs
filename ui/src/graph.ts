import { Graph, layout } from '@dagrejs/dagre'
import type { Edge, Node, XYPosition } from '@xyflow/react'
import type { Problem } from '../../src/core/check.ts'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { computeView, hasChildren, placeEnds } from '../../src/core/views.ts'

/** Every box has the same size, so dagre can place them before the browser draws them. Keep in sync with .box in style.css. */
export const BOX = { width: 180, height: 72 }

export type BoxData = { object: FlowyObject; zoomable: boolean }
export type BoxNode = Node<BoxData, 'box'>

/**
 * A flow on the canvas: where each step lands in the view (placeEnds, null if it can't be shown), and
 * the step to light up. Without `step` the flow's boxes are there but nothing is lit or dimmed.
 */
export type Playing = { ends: ([string, string] | null)[]; step?: number }

export const lineId = (from: string, to: string) => `${from} ${to}`

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined
const overlaps = (a: XYPosition, b: XYPosition) => Math.abs(a.x - b.x) < BOX.width && Math.abs(a.y - b.y) < BOX.height

/**
 * The React Flow nodes and edges for one view. A box keeps its layout.yaml position; dagre places the
 * rest, moved down past any saved box they would cover. While a flow plays, the current step's two
 * boxes and its line stay lit and everything else is dimmed. A step with no line of its own gets a
 * dashed one. Boxes only the flow uses join for the whole flow, as outsiders, so nothing moves
 * between steps. Boxes and lines with problems get the class "problem".
 */
export function toGraph(model: Model, view: string, playing?: Playing, problems: Problem[] = []): { nodes: BoxNode[]; edges: Edge[] } {
  const { members, outsiders, edges } = computeView(model, view)
  const flowBoxes = (playing?.ends ?? []).flatMap(e => e ?? [])
  const boxes = [...new Set([...members, ...outsiders, ...flowBoxes])]
  const dimming = playing?.step !== undefined
  const lit = playing?.step === undefined ? undefined : playing.ends[playing.step]
  const g = new Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of boxes) g.setNode(id, { ...BOX })
  for (const e of edges) g.setEdge(e.from, e.to)
  layout(g)

  const saved = Object.hasOwn(model.layout, view) ? model.layout[view] : {}
  const at = new Map<string, XYPosition>()
  for (const id of boxes) if (Object.hasOwn(saved, id)) at.set(id, { x: saved[id][0], y: saved[id][1] })
  for (const id of boxes) {
    if (at.has(id)) continue
    const { x, y } = g.node(id)
    const p = { x: x - BOX.width / 2, y: y - BOX.height / 2 }
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
    data: { object: model.objects[id], zoomable: hasChildren(model, id) },
    className: classes(!members.includes(id) && 'outsider', dimming && !lit?.includes(id) && 'dim', badBoxes.has(id) && 'problem'),
  }))
  const lines: Edge[] = edges.map(e => ({
    id: lineId(e.from, e.to),
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    markerEnd: { type: 'arrowclosed' },
    className: classes(dimming && (isLit(e.from, e.to) ? 'active' : 'dim'), badLines.has(lineId(e.from, e.to)) && 'problem'),
  }))
  if (lit && !edges.some(e => isLit(e.from, e.to)))
    lines.push({ id: 'step', source: lit[0], target: lit[1], markerEnd: { type: 'arrowclosed' }, className: 'step' })
  return { nodes, edges: lines }
}
