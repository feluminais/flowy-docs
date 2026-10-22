import { createContext, useContext } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode } from '@xyflow/react'
import type { Edge, EdgeProps, InternalNode, XYPosition } from '@xyflow/react'
import type { Mark } from '../../src/core/failures.ts'
import { SHAPE_DEFS, shapeOf } from '../../src/core/look.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { ChangeMarksContext, FailBadge } from './Box.tsx'
import { changeAt } from './compare.ts'
import { lineEnds, ports, sizeOf } from './graph.ts'
import { clip, placeLabels } from './labels.ts'
import type { Spot } from './labels.ts'
import { labelOffset } from './motion.ts'
import type { BoxData, BoxNode, Outline, Rect } from './graph.ts'

/** How lines are drawn: the project's style, or this reader's own. App provides it. */
export const LineStyleContext = createContext<LineStyle>('straight')

/** How thick each line is drawn while traffic shows (by line id), where it differs from the usual. */
export const LineWidthsContext = createContext<ReadonlyMap<string, number>>(new Map())

/** The failure modes each line carries while the Failures tab shows them (by line id): the worst band and the count. */
export const LineMarksContext = createContext<ReadonlyMap<string, Mark>>(new Map())

/** Where each line's label goes where it isn't the middle of the line (by line id), so labels that would overlap don't. App provides it: see labelSpots. */
export const LabelSpotsContext = createContext<ReadonlyMap<string, Spot>>(new Map())

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

export const rect = (n: InternalNode): Rect => ({ ...n.internals.positionAbsolute, ...sizeOf(n) })
/** The outline a line meets: the shape's own, so it never ends in the air beside a diamond's corner. */
export const outline = (n: InternalNode): Outline => SHAPE_DEFS[shapeOf((n.data as BoxData).object)].edge

/** The SVG path and the label's place for one line in the given style. */
function draw(style: LineStyle, a: Rect, b: Rect, edgeA: Outline, edgeB: Outline): [string, number, number] {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b, edgeA, edgeB)
    const [path, x, y] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    return [path, x, y]
  }
  const p = ports(a, b, edgeA, edgeB)
  const ends = {
    sourceX: p.from.x, sourceY: p.from.y, sourcePosition: SIDES[p.fromSide],
    targetX: p.to.x, targetY: p.to.y, targetPosition: SIDES[p.toSide],
  }
  const [path, x, y] = style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  return [path, x, y]
}

/**
 * Where the labels on show go: each line's, in the given style, kept clear of the boxes and of one another (see placeLabels). A lit line's
 * label and the label of a line a pipe plays along stay at the middle of the line, and the others are placed round them.
 */
export function labelSpots(style: LineStyle, edges: Edge[], nodes: BoxNode[]): Map<string, Spot> {
  const at = new Map(nodes.map(n => [n.id, n]))
  const boxes = nodes.map(n => ({ ...n.position, ...sizeOf(n) }))
  const items = edges.flatMap(e => {
    const [a, b] = [at.get(e.source), at.get(e.target)]
    if (typeof e.label !== 'string' || e.label === '' || !a || !b) return []
    const edgeOf = (n: BoxNode) => SHAPE_DEFS[shapeOf(n.data.object)].edge
    const [path, x, y] = draw(style, { ...a.position, ...sizeOf(a) }, { ...b.position, ...sizeOf(b) }, edgeOf(a), edgeOf(b))
    return [{ id: e.id, path, mid: { x, y }, chars: clip(e.label).length, pinned: e.className?.includes('active') || e.data?.lift === true }]
  })
  return placeLabels(items, boxes)
}

/** The middle of the line between two boxes in the given style, where its label sits. */
export function labelPoint(style: LineStyle, a: InternalNode, b: InternalNode): XYPosition {
  const [, x, y] = draw(style, rect(a), rect(b), outline(a), outline(b))
  return { x, y }
}

/** The path of the line between two boxes in the given style, for a step's pipe to follow. */
export const pathBetween = (style: LineStyle, a: InternalNode, b: InternalNode): string => draw(style, rect(a), rect(b), outline(a), outline(b))[0]

/**
 * A line between two boxes. Straight lines go edge to edge, whichever sides face each other: the boxes
 * sit above, beside and below the members, so lines that always left at the bottom would loop around.
 * Curved and right-angled lines leave from the middle of the facing side.
 */
export function Line({ id, source, target, label, markerEnd, interactionWidth, data }: EdgeProps) {
  const style = useContext(LineStyleContext)
  const width = useContext(LineWidthsContext).get(id)
  const mark = useContext(LineMarksContext).get(id)
  const spot = useContext(LabelSpotsContext).get(id)
  const change = changeAt(useContext(ChangeMarksContext)?.lines, id)
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const [path, x, y] = draw(style, rect(a), rect(b), outline(a), outline(b))
  // A step that moves runs a blob along this line, so its label steps aside instead of sitting under the blob.
  const [ra, rb] = [rect(a), rect(b)]
  const text = typeof label === 'string' ? clip(label) : label
  const aside = data?.lift === true && typeof text === 'string' ? labelOffset(rb.x + rb.width / 2 - (ra.x + ra.width / 2), rb.y + rb.height / 2 - (ra.y + ra.height / 2), text.length) : { x: 0, y: 0 }
  const [labelX, labelY] = spot && data?.lift !== true ? [spot.x, spot.y] : [x + aside.x, y + aside.y]
  return (
    <>
      {change && <path className="change-line" data-change={change} d={path} fill="none" />}
      <BaseEdge id={id} path={path} label={text} labelX={labelX} labelY={labelY} markerEnd={markerEnd} interactionWidth={interactionWidth} style={width === undefined ? undefined : { strokeWidth: width }} />
      {mark && (
        <EdgeLabelRenderer>
          <FailBadge mark={mark} className="line" style={{ transform: `translate(-50%, -150%) translate(${x}px, ${y}px)` }} />
        </EdgeLabelRenderer>
      )}
    </>
  )
}
