import { Graph, layout } from '@dagrejs/dagre'
import type { Edge, Node } from '@xyflow/react'
import type { FlowyObject, Model } from '../../src/core/model.ts'
import { computeView, hasChildren } from '../../src/core/views.ts'

/** Every box has the same size, so dagre can place them before the browser draws them. Keep in sync with .box in style.css. */
export const BOX = { width: 180, height: 72 }

export type BoxData = { object: FlowyObject; zoomable: boolean }
export type BoxNode = Node<BoxData, 'box'>

/** A flow being played: where each step lands in the view (placeEnds, null if it can't be shown), and the current step. */
export type Playing = { ends: ([string, string] | null)[]; step: number }

const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ') || undefined

/**
 * The React Flow nodes and edges for one view. A box keeps its layout.yaml position; dagre places the rest.
 * While a flow plays, the current step's two boxes and its line stay lit and everything else is dimmed.
 * A step with no line of its own gets a dashed one. Boxes only the flow uses join for the whole flow,
 * as outsiders, so nothing moves between steps.
 */
export function toGraph(model: Model, view: string, playing?: Playing): { nodes: BoxNode[]; edges: Edge[] } {
  const { members, outsiders, edges } = computeView(model, view)
  const flowBoxes = (playing?.ends ?? []).flatMap(e => e ?? [])
  const boxes = [...new Set([...members, ...outsiders, ...flowBoxes])]
  const lit = playing?.ends[playing.step]
  const g = new Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of boxes) g.setNode(id, { ...BOX })
  for (const e of edges) g.setEdge(e.from, e.to)
  layout(g)

  const saved = Object.hasOwn(model.layout, view) ? model.layout[view] : {}
  const isLit = (from: string, to: string) => lit?.[0] === from && lit[1] === to
  const nodes = boxes.map((id): BoxNode => {
    const { x, y } = g.node(id)
    return {
      id,
      type: 'box',
      position: Object.hasOwn(saved, id) ? { x: saved[id][0], y: saved[id][1] } : { x: x - BOX.width / 2, y: y - BOX.height / 2 },
      data: { object: model.objects[id], zoomable: hasChildren(model, id) },
      className: classes(!members.includes(id) && 'outsider', playing && !lit?.includes(id) && 'dim'),
    }
  })
  const lines: Edge[] = edges.map(e => ({
    id: `${e.from} ${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label || undefined,
    markerEnd: { type: 'arrowclosed' },
    className: classes(playing !== undefined && (isLit(e.from, e.to) ? 'active' : 'dim')),
  }))
  if (lit && !edges.some(e => isLit(e.from, e.to)))
    lines.push({ id: 'step', source: lit[0], target: lit[1], markerEnd: { type: 'arrowclosed' }, className: 'step' })
  return { nodes, edges: lines }
}
