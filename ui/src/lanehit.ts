import type { Edge } from '@xyflow/react'
import type { Point } from '../../src/core/heads.ts'
import { nearestStrand } from '../../src/core/lanes.ts'
import type { HitLane, Slot } from '../../src/core/lanes.ts'
import { shapeOf, SHAPE_DEFS } from '../../src/core/look.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { pairOf, sizeOf } from './graph.ts'
import type { BoxNode } from './graph.ts'
import { lanes, REST, SPREAD } from './lanes.ts'
import type { LaneEnd, Pose } from './lanes.ts'

/**
 * Which line of a pair the pointer means. React Flow says which edge's strip the pointer is in; where a pair has several lines side by side the strips are as wide as the lines
 * are apart, but they overlap on a slope and the lines move when their pair is spread, so the page asks the core which line is nearest the pointer, from where the lines are now.
 */

/** A box node as the end of a lane, from where the node is and how big it measured. */
export const boxEnd = (n: BoxNode): LaneEnd => ({ id: n.id, rect: { ...n.position, ...sizeOf(n) }, edge: SHAPE_DEFS[shapeOf(n.data.object)].edge })

/** Where a line is among the lines of its pair, and the pose its pair is in: what the lane store needs besides the line's ends. */
export const laneOf = (data: Record<string, unknown> | undefined): { slot: Slot | undefined; pose: Pose } => ({ slot: data?.slot as Slot | undefined, pose: data?.spread === true ? SPREAD : REST })

/**
 * The id of the edge in `edges` the pointer at `at` (a point of the canvas) means, given that React Flow said it is on `hit` and that the canvas is at `zoom`. `hit` itself when its pair
 * has one line or the pointer is near none. How near is measured in screen pixels (see nearestStrand), as the desktop does.
 */
export function hitStrand(edges: readonly Edge[], nodes: readonly BoxNode[], style: LineStyle, hit: Edge, at: Point, zoom = 1): string {
  if (typeof hit.data?.pair !== 'string' || !(typeof hit.data.lanes === 'number' && hit.data.lanes > 1)) return hit.id
  const pair = pairOf(hit)
  const byId = new Map(nodes.map(n => [n.id, n]))
  const near: HitLane[] = edges.flatMap(e => {
    const [a, b, slot] = [byId.get(e.source), byId.get(e.target), laneOf(e.data).slot]
    if (pairOf(e) !== pair || e.data?.pair === undefined || !a || !b || slot === undefined) return []
    const points = lanes.laneFor(e.id, style, boxEnd(a), boxEnd(b), laneOf(e.data).pose, slot).points
    return points ? [{ id: e.id, pair, lane: slot.lane, points }] : []
  })
  return nearestStrand(near, at, zoom) ?? hit.id
}

/** What a pane keeps of its React Flow instance to ask where the pointer is on the canvas and how far it is zoomed. */
export type CanvasPoint = { screenToFlowPosition: (at: { x: number; y: number }) => Point; getZoom: () => number }

/**
 * The edge a pointer event in a pane means: `hit`, or of the lines of its pair side by side the nearest to the pointer (see hitStrand). A pane has no lane store of its own, so it asks
 * with the React Flow instance it keeps from `onInit` and the edges and nodes it draws; without an instance yet it takes `hit` as it is.
 */
export function edgeUnder(instance: CanvasPoint | undefined, event: { clientX: number; clientY: number }, edges: readonly Edge[], nodes: readonly BoxNode[], style: LineStyle, hit: Edge): Edge {
  if (!instance || typeof hit.data?.pair !== 'string') return hit
  const id = hitStrand(edges, nodes, style, hit, instance.screenToFlowPosition({ x: event.clientX, y: event.clientY }), instance.getZoom())
  return id === hit.id ? hit : edges.find(e => e.id === id) ?? hit
}

/** What a click on a line in a pane picks: the line's two shapes and the view the pane draws, and where each connection has a line of its own, the line of the pair that was clicked (see Side). */
export const lineOf = (e: Edge, view: string): { kind: 'line'; from: string; to: string; view: string; strand?: string } =>
  ({ kind: 'line', from: e.source, to: e.target, view, ...(typeof e.data?.pair === 'string' ? { strand: e.id } : {}) })
