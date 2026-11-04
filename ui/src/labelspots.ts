import type { Edge } from '@xyflow/react'
import type { LineStyle } from '../../src/core/model.ts'
import { pairOf, sizeOf } from './graph.ts'
import type { BoxNode } from './graph.ts'
import { clip, PIPE_CLEAR, placeLabels, SAMPLE } from './labels.ts'
import type { Spot } from './labels.ts'
import { boxEnd, laneOf } from './lanehit.ts'
import { lanes } from './lanes.ts'

/** How lit each lane of a pair is now (see parts.ts: PartStore.lam), or undefined for a pair at rest. */
export type LitOf = (pair: string) => readonly number[] | undefined

/** Where the labels go given how lit the lanes of each pair are (see LabelSpots in Line.tsx, which asks again as the pairs part). */
export type SpotsFor = (lit: LitOf) => Map<string, Spot>

/** The places for the lines and boxes as they stand, as a function of how the pairs have parted: a new one whenever they change, so the one who holds it knows to place the labels again. */
export const spotsFor = (style: LineStyle, edges: Edge[], nodes: BoxNode[]): SpotsFor => lit => labelSpots(style, edges, nodes, lit)

/**
 * Where the labels on show go: each line's, in the given style, kept clear of the boxes and of one another (see placeLabels). A lit line's
 * label and the label of a line a pipe plays along stay at the middle of the line, and the others are placed round them. The label of a line that has
 * other lines beside it also keeps clear of their lines.
 *
 * A line is drawn at the pose its pair is in, and its label is placed from that same pose: while a step plays on a pair of several lines, `lit` says how lit each of the pair's lines is
 * and the lines part around the lit ones (see parts.ts), so the label of a line moves with it. The desktop lays its labels out from the lines as they are drawn, which is the same thing.
 */
export function labelSpots(style: LineStyle, edges: Edge[], nodes: BoxNode[], lit?: LitOf): Map<string, Spot> {
  const at = new Map(nodes.map(n => [n.id, n]))
  const boxes = nodes.map(n => ({ ...n.position, ...sizeOf(n) }))
  const laneAt = (e: Edge) => {
    const [a, b] = [at.get(e.source), at.get(e.target)]
    if (!a || !b) return undefined
    const { slot, pose } = laneOf(e.data)
    const parted = typeof e.data?.lanes === 'number' && e.data.lanes > 1 ? lit?.(pairOf(e)) : undefined
    return lanes.laneFor(e.id, style, boxEnd(a), boxEnd(b), parted === undefined ? pose : { s: pose.s, lam: parted }, slot)
  }
  // The lines of each pair that has several, so a label can keep off the others'.
  const sides = new Map<string, Edge[]>()
  for (const e of edges) if (typeof e.data?.lanes === 'number' && e.data.lanes > 1) sides.set(pairOf(e), [...(sides.get(pairOf(e)) ?? []), e])
  const items = edges.flatMap(e => {
    if (typeof e.label !== 'string' || e.label === '') return []
    const lane = laneAt(e)
    if (!lane) return []
    const { path, x, y } = lane
    const across = sides.get(pairOf(e))?.filter(o => o.id !== e.id).flatMap(o => {
      const points = laneAt(o)?.points
      return points ? [points] : []
    })
    return [{ id: e.id, path, mid: { x, y }, chars: clip(e.label).length, pinned: e.className?.includes('active') || e.data?.lift === true, ...(across === undefined ? {} : { across, extra: SAMPLE, ...(e.data?.lift === true ? { clear: PIPE_CLEAR } : {}) }) }]
  })
  return placeLabels(items, boxes)
}
