import { createContext, useContext } from 'react'
import { BaseEdge, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode } from '@xyflow/react'
import type { EdgeProps, InternalNode, XYPosition } from '@xyflow/react'
import { SHAPE_DEFS, shapeOf } from '../../src/core/look.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { lineEnds, ports, sizeOf } from './graph.ts'
import { labelOffset } from './motion.ts'
import type { BoxData, Outline, Rect } from './graph.ts'

/** How lines are drawn: the project's style, or this reader's own. App provides it. */
export const LineStyleContext = createContext<LineStyle>('straight')

/** How thick each line is drawn while traffic shows (by line id), where it differs from the usual. */
export const LineWidthsContext = createContext<ReadonlyMap<string, number>>(new Map())

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

export const rect = (n: InternalNode): Rect => ({ ...n.internals.positionAbsolute, ...sizeOf(n) })
/** The outline a line meets: the shape's own, so it never ends in the air beside a diamond's corner. */
const outline = (n: InternalNode): Outline => SHAPE_DEFS[shapeOf((n.data as BoxData).object)].edge

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
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const [path, x, y] = draw(style, rect(a), rect(b), outline(a), outline(b))
  // A step that moves plays a pipe along this line, so its label steps aside instead of sitting under the pipe.
  const [ra, rb] = [rect(a), rect(b)]
  const aside = data?.lift === true && typeof label === 'string' ? labelOffset(rb.x + rb.width / 2 - (ra.x + ra.width / 2), rb.y + rb.height / 2 - (ra.y + ra.height / 2), label.length) : { x: 0, y: 0 }
  const [labelX, labelY] = [x + aside.x, y + aside.y]
  return <BaseEdge id={id} path={path} label={label} labelX={labelX} labelY={labelY} markerEnd={markerEnd} interactionWidth={interactionWidth} style={width === undefined ? undefined : { strokeWidth: width }} />
}
