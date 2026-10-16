import { BaseEdge, getStraightPath, useInternalNode } from '@xyflow/react'
import type { EdgeProps, InternalNode } from '@xyflow/react'
import { BOX, lineEnds } from './graph.ts'

const rect = (n: InternalNode) => ({ ...n.internals.positionAbsolute, width: n.measured.width ?? BOX.width, height: n.measured.height ?? BOX.height })

/**
 * A straight line from the edge of one box to the edge of the other, whichever sides face each other.
 * The boxes sit above, beside and below the members, so lines that always leave at the bottom and
 * arrive at the top would loop around them.
 */
export function Line({ id, source, target, label, markerEnd, interactionWidth }: EdgeProps) {
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const [from, to] = lineEnds(rect(a), rect(b))
  const [path, labelX, labelY] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
  return <BaseEdge id={id} path={path} label={label} labelX={labelX} labelY={labelY} markerEnd={markerEnd} interactionWidth={interactionWidth} />
}
