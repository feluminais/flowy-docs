import { useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import { Handle, NodeToolbar, Position, useConnection } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import Markdown from 'react-markdown'
import { fillOpacity, isColor, onFill, SHAPE_DEFS, shapeOf, showsTile } from '../../src/core/look.ts'
import { isExternal } from '../../src/core/model.ts'
import { lookVars } from './Chrome.tsx'
import type { BoxNode, FrameNode } from './graph.ts'
import { PathIcon, ZoomIn } from './icons.tsx'

/** Markdown from the model. react-markdown never renders raw HTML, so a repo can't inject script. Links open in a new tab. */
export function Description({ text }: { text: string }) {
  return <Markdown components={{ a: props => <a {...props} target="_blank" rel="noreferrer" /> }}>{text}</Markdown>
}

/** The first paragraph of a description: everything up to the first blank line. */
export const teaser = (description?: string) => description?.trim().split(/\n\s*\n/)[0]

/**
 * One object on the canvas: its shape (an outline drawn behind the rest, in the colour and fill it names), a tile with its
 * icon (grey with a cloud when it's external), its name, its tech (or type), and how many shapes it opens onto. Hovering
 * shows the teaser. In edit mode a line starts at the dot at the bottom, and while it's being drawn the whole shape is a place to drop it.
 */
export function Box({ id, data: { object, inside, icon, perf }, isConnectable }: NodeProps<BoxNode>) {
  const [hover, setHover] = useState(false)
  const connecting = useConnection(c => c.inProgress)
  const short = teaser(object.description)
  const external = isExternal(object)
  const { path, pad: [top, right, bottom, left], badge } = SHAPE_DEFS[shapeOf(object)]
  const kind = external ? `external ${object.type}` : object.type
  return (
    <div
      className={`box box-${object.type}${external ? ' external' : ''}${isColor(object.color) ? ' colored' : ''}${fillOpacity(object) > 0 ? ' tinted' : ''}${onFill(object) ? ' on' : ''}${perf?.strain !== undefined ? ' strained' : ''}`}
      style={{ ...lookVars(object), ...(perf?.strain !== undefined && { '--strain': perf.strain }), padding: `${top}px ${right}px ${bottom}px ${left}px` }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
    >
      <svg className="shape" viewBox="0 0 200 72" aria-hidden="true"><path d={path} /></svg>
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} isConnectableStart={false} className={connecting ? 'drop' : undefined} />
      {showsTile(object) && <span className="tile" role="img" aria-label={kind} title={kind}><PathIcon d={icon} /></span>}
      <div className="box-text">
        <div className="box-name">{object.name || id}</div>
        <div className="box-meta">{[external && 'external', object.tech || object.type].filter(Boolean).join(' · ')}</div>
      </div>
      {perf && perf.queue > 0 && <span className="queue-badge" title={`${perf.queue} waiting`}>{perf.queue}</span>}
      {inside > 0 && <span className="inside" style={{ right: badge[0], bottom: badge[1] }}><ZoomIn />{inside} inside</span>}
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
      {short && (
        <NodeToolbar isVisible={hover} position={Position.Bottom} className="teaser">
          <Description text={short} />
        </NodeToolbar>
      )}
    </div>
  )
}

/**
 * The shape you're inside, drawn as a frame around what's in it. The blank space inside takes no clicks (see frameNode in graph.ts); the
 * outline and the name do, and a click there is a click on the shape itself. Dragging the canvas by the outline is not one.
 */
export function Frame({ data }: NodeProps<FrameNode>) {
  const down = useRef<[number, number]>(undefined)
  const { onOpen } = data
  const hit = onOpen && {
    onPointerDown: (e: PointerEvent<HTMLElement>) => { down.current = [e.clientX, e.clientY] },
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (down.current === undefined || Math.hypot(e.clientX - down.current[0], e.clientY - down.current[1]) < 4) onOpen()
    },
  }
  return (
    <div className="frame">
      <span {...hit} className={onOpen ? 'hit' : undefined}>{data.name}</span>
      {hit && (['top', 'right', 'bottom', 'left'] as const).map(side => <i key={side} className={`hit ${side}`} {...hit} />)}
    </div>
  )
}
