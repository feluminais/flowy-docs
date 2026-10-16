import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { BoxNode } from './graph.ts'

/** One object on the canvas. Handles exist only so lines have somewhere to attach. */
export function Box({ id, data: { object, zoomable } }: NodeProps<BoxNode>) {
  return (
    <div className={`box box-${object.type}${zoomable ? ' zoomable' : ''}`}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="box-name">{object.name || id}</div>
      <div className="box-meta">{object.type}{object.tech ? ` · ${object.tech}` : ''}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}
