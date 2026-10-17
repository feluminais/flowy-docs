import { useState } from 'react'
import { Handle, NodeToolbar, Position, useConnection } from '@xyflow/react'
import type { Node, NodeProps } from '@xyflow/react'
import Markdown from 'react-markdown'
import type { BoxNode } from './graph.ts'
import { Cloud, TYPE_ICONS, ZoomIn } from './icons.tsx'

/** Markdown from the model. react-markdown never renders raw HTML, so a repo can't inject script. Links open in a new tab. */
export function Description({ text }: { text: string }) {
  return <Markdown components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{text}</Markdown>
}

/** The first paragraph of a description: everything up to the first blank line. */
export const teaser = (description?: string) => description?.trim().split(/\n\s*\n/)[0]

/**
 * One object on the canvas: a tile with its type's icon (grey with a cloud when it's external), its
 * name, its tech (or type), and how many boxes it opens onto. Hovering shows the teaser. In edit mode
 * a line starts at the dot at the bottom, and while it's being drawn the whole box is a place to drop it.
 */
export function Box({ id, data: { object, inside }, isConnectable }: NodeProps<BoxNode>) {
  const [hover, setHover] = useState(false)
  const connecting = useConnection(c => c.inProgress)
  const short = teaser(object.description)
  const external = object.external === 'true'
  // A type the checker doesn't know still gets a tile.
  const Icon = external ? Cloud : Object.hasOwn(TYPE_ICONS, object.type) ? TYPE_ICONS[object.type] : TYPE_ICONS.system
  const kind = external ? `external ${object.type}` : object.type
  return (
    <div className={`box box-${object.type}${external ? ' external' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} isConnectableStart={false} className={connecting ? 'drop' : undefined} />
      <span className="tile" role="img" aria-label={kind} title={kind}><Icon /></span>
      <div className="box-text">
        <div className="box-name">{object.name || id}</div>
        <div className="box-meta">{[external && 'external', object.tech || object.type].filter(Boolean).join(' · ')}</div>
      </div>
      {inside > 0 && <span className="inside"><ZoomIn />{inside} inside</span>}
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
      {short && (
        <NodeToolbar isVisible={hover} position={Position.Bottom} className="teaser">
          <Description text={short} />
        </NodeToolbar>
      )}
    </div>
  )
}

export type FrameNode = Node<{ name: string }, 'frame'>

/** The box you're inside, drawn as a frame around what's in it. It takes no clicks (see style.css). */
export function Frame({ data }: NodeProps<FrameNode>) {
  return <div className="frame"><span>{data.name}</span></div>
}
