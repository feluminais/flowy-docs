import { useState } from 'react'
import { Handle, NodeToolbar, Position, useConnection } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import Markdown from 'react-markdown'
import type { BoxNode } from './graph.ts'

/** Markdown from the model. react-markdown never renders raw HTML, so a repo can't inject script. Links open in a new tab. */
export function Description({ text }: { text: string }) {
  return <Markdown components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{text}</Markdown>
}

/** The first paragraph of a description: everything up to the first blank line. */
export const teaser = (description?: string) => description?.trim().split(/\n\s*\n/)[0]

/**
 * One object on the canvas. Hovering shows the teaser. In edit mode a line starts at the dot at
 * the bottom, and while it's being drawn the whole box is a place to drop it.
 */
export function Box({ id, data: { object, zoomable }, isConnectable }: NodeProps<BoxNode>) {
  const [hover, setHover] = useState(false)
  const connecting = useConnection(c => c.inProgress)
  const short = teaser(object.description)
  return (
    <div className={`box box-${object.type}${zoomable ? ' zoomable' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} isConnectableStart={false} className={connecting ? 'drop' : undefined} />
      <div className="box-name">{object.name || id}</div>
      <div className="box-meta">{object.type}{object.tech ? ` · ${object.tech}` : ''}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
      {short && (
        <NodeToolbar isVisible={hover} position={Position.Bottom} className="teaser">
          <Description text={short} />
        </NodeToolbar>
      )}
    </div>
  )
}
