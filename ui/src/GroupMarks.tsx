import { useContext } from 'react'
import { useInternalNode, ViewportPortal } from '@xyflow/react'
import type { GroupKind } from '../../src/core/structure.ts'
import { labelPoint, LineStyleContext, rect } from './Line.tsx'
import { KIND_ICON } from './Player.tsx'

export type GroupMark = { ends: [string, string]; text: string; kind: GroupKind }

function Mark({ ends, text, kind }: GroupMark) {
  const style = useContext(LineStyleContext)
  const a = useInternalNode(ends[0])
  const b = useInternalNode(ends[1])
  if (!a || !b) return null
  // A step on one box has no line: its mark sits on the box's top right corner. Otherwise it is above the middle of the line, where the label is.
  const at = ends[0] === ends[1] ? { x: rect(a).x + rect(a).width - 24, y: rect(a).y } : labelPoint(style, a, b)
  const Icon = KIND_ICON[kind]
  return <div className={`mark ${kind}`} style={{ left: at.x, top: at.y }}><Icon size={11} />{text}</div>
}

/** What a group says about the steps lit at this stop, drawn on their lines: how often it repeats, or which lane it is. Static, so it shows with motion off. */
export function GroupMarks({ marks }: { marks: GroupMark[] }) {
  if (marks.length === 0) return null
  return <ViewportPortal>{marks.map((m, i) => <Mark key={i} {...m} />)}</ViewportPortal>
}
