import { useState } from 'react'
import { Handle, NodeToolbar, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import Markdown from 'react-markdown'
import type { BoxNode } from './graph.ts'

/** Markdown from the model. react-markdown never renders raw HTML, so a repo can't inject script. Links open in a new tab. */
export function Description({ text }: { text: string }) {
  return <Markdown components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{text}</Markdown>
}

/** The first paragraph of a description: everything up to the first blank line. */
export const teaser = (description?: string) => description?.trim().split(/\n\s*\n/)[0]

/** One object on the canvas. Hovering shows the teaser. Handles exist only so lines have somewhere to attach. */
export function Box({ id, data: { object, zoomable } }: NodeProps<BoxNode>) {
  const [hover, setHover] = useState(false)
  const short = teaser(object.description)
  return (
    <div className={`box box-${object.type}${zoomable ? ' zoomable' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="box-name">{object.name || id}</div>
      <div className="box-meta">{object.type}{object.tech ? ` · ${object.tech}` : ''}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
      {short && (
        <NodeToolbar isVisible={hover} position={Position.Bottom} className="teaser">
          <Description text={short} />
        </NodeToolbar>
      )}
    </div>
  )
}
