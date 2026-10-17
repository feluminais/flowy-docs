import { createContext, useContext } from 'react'
import { BaseEdge, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode } from '@xyflow/react'
import type { EdgeProps, InternalNode } from '@xyflow/react'
import type { LineStyle } from '../../src/core/model.ts'
import { lineEnds, ports, sizeOf } from './graph.ts'
import type { Rect } from './graph.ts'

/** How lines are drawn: the project's style, or this reader's own. App provides it. */
export const LineStyleContext = createContext<LineStyle>('straight')

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

const rect = (n: InternalNode): Rect => ({ ...n.internals.positionAbsolute, ...sizeOf(n) })

/** The SVG path and the label's place for one line in the given style. */
function draw(style: LineStyle, a: Rect, b: Rect): [string, number, number] {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b)
    const [path, x, y] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    return [path, x, y]
  }
  const p = ports(a, b)
  const ends = {
    sourceX: p.from.x, sourceY: p.from.y, sourcePosition: SIDES[p.fromSide],
    targetX: p.to.x, targetY: p.to.y, targetPosition: SIDES[p.toSide],
  }
  const [path, x, y] = style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  return [path, x, y]
}

/**
 * A line between two boxes. Straight lines go edge to edge, whichever sides face each other: the boxes
 * sit above, beside and below the members, so lines that always left at the bottom would loop around.
 * Curved and right-angled lines leave from the middle of the facing side.
 */
export function Line({ id, source, target, label, markerEnd, interactionWidth }: EdgeProps) {
  const style = useContext(LineStyleContext)
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const [path, labelX, labelY] = draw(style, rect(a), rect(b))
  return <BaseEdge id={id} path={path} label={label} labelX={labelX} labelY={labelY} markerEnd={markerEnd} interactionWidth={interactionWidth} />
}
