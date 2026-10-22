import { Children, createContext, isValidElement, useContext, useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent, ReactNode } from 'react'
import { Handle, NodeToolbar, Position, useConnection } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import Markdown from 'react-markdown'
import { BAND_NAMES } from '../../src/core/failures.ts'
import type { Mark } from '../../src/core/failures.ts'
import type { Change, SideMarks } from '../../src/core/flowdiff.ts'
import { fillOpacity, isColor, onFill, SHAPE_DEFS, shapeOf, showsTile } from '../../src/core/look.ts'
import { isExternal } from '../../src/core/model.ts'
import { languageOf } from '../../src/core/snippets.ts'
import type { StateMark } from '../../src/core/states.ts'
import { CodeBlock } from './Code.tsx'
import { CHANGE_NAMES } from './compare.ts'
import { lookVars } from './Chrome.tsx'
import type { BoxNode, FrameNode } from './graph.ts'
import { PathIcon, ZoomIn } from './icons.tsx'
import { StateGlyph, stateClasses } from './states.tsx'

/** The language a fence names (```ts), as one of ours, or nothing when it names none we know. */
const fenceLanguage = (className?: string): string | undefined => languageOf(/(?:^|\s)language-(\S+)/.exec(className ?? '')?.[1])?.id

/**
 * Markdown from the model. react-markdown never renders raw HTML, so a repo can't inject script. Links open in a new tab. A fenced block
 * that names a language is drawn with its colours (the same as a snippet's); one that names none stays as it is.
 */
export function Description({ text }: { text: string }) {
  return (
    <Markdown components={{
      a: props => <a {...props} target="_blank" rel="noreferrer" />,
      pre: ({ children, node: _node, ...rest }) => {
        const block = Children.toArray(children)[0]
        const code = isValidElement<{ className?: string; children?: ReactNode }>(block) ? block.props : undefined
        const language = fenceLanguage(code?.className)
        return language === undefined ? <pre {...rest}>{children}</pre> : <CodeBlock text={String(code?.children ?? '')} language={language} />
      },
    }}>{text}</Markdown>
  )
}

/** How many failure modes a shape or line carries, in the colour of the worst one. The count and the band's name are also its label, so the colour is never the only copy. */
export function FailBadge({ mark, className, style }: { mark: Mark; className?: string; style?: CSSProperties }) {
  const label = `${mark.count} failure${mark.count === 1 ? '' : 's'}, ${BAND_NAMES[mark.band]}`
  return <span className={['fail-badge', mark.band, className].filter(Boolean).join(' ')} style={style} role="img" aria-label={label} title={label}>{mark.count}</span>
}

/** What differs from the other flow of a comparison, on the canvas that draws this side of it. Without it (the usual canvas, or the marks off) nothing is marked. */
export const ChangeMarksContext = createContext<SideMarks | undefined>(undefined)

/** The kind of change a record marks for `key`, or nothing. The key may be any text an id can be, so only its own entries count. */
export const changeAt = <K extends string | number>(marks: Record<K, Change> | undefined, key: K): Change | undefined => (marks && Object.hasOwn(marks, key) ? marks[key] : undefined)

const CHANGE_GLYPHS: Record<Change, string> = { new: '+', removed: '−', changed: '~' }

/** The small badge at a shape's corner: a sign for each kind, and its name for a screen reader, so the outline's colour is never the only copy. */
export function ChangeBadge({ change }: { change: Change }) {
  return <span className="change-badge" role="img" aria-label={CHANGE_NAMES[change]} title={CHANGE_NAMES[change]}>{CHANGE_GLYPHS[change]}</span>
}

/** The first paragraph of a description: everything up to the first blank line. */
export const teaser = (description?: string) => description?.trim().split(/\n\s*\n/)[0]

/** How long a state takes to go, in the same milliseconds as the 0.6s the transitions in style.css take to dim and bring back the box. */
const STATE_LEAVE_MS = 700

/**
 * The state a box is in, and for a moment after it leaves one, the one it left: the outline and the glyph fade out over the box coming back
 * instead of vanishing. With `snap` (a slider is being dragged) the old one goes at once. A box that never has a state costs one ref and an effect that does nothing.
 */
function useStateMark(state: StateMark | undefined, snap: boolean | undefined): { shown: StateMark | undefined; leaving: boolean } {
  const [left, setLeft] = useState<StateMark>()
  const was = useRef<StateMark>(undefined)
  const [word, inside] = [state?.state, state?.inside]
  useEffect(() => {
    const before = was.current
    was.current = state
    setLeft(state === undefined && !snap ? before : undefined)
    if (state !== undefined || before === undefined || snap) return
    const timer = setTimeout(() => setLeft(undefined), STATE_LEAVE_MS)
    return () => clearTimeout(timer)
  }, [word, inside])
  return { shown: state ?? left, leaving: state === undefined && left !== undefined }
}

/**
 * One object on the canvas: its shape (an outline drawn behind the rest, in the colour and fill it names), a tile with its
 * icon (grey with a cloud when it's external), its name, its tech (or type), and how many shapes it opens onto. Hovering
 * shows the teaser. In edit mode a line starts at the dot at the bottom, and while it's being drawn the whole shape is a place to drop it.
 */
export function Box({ id, data: { object, inside, icon, perf, fail, state, snap }, isConnectable }: NodeProps<BoxNode>) {
  const [hover, setHover] = useState(false)
  const [clipped, setClipped] = useState(false)
  const text = useRef<HTMLDivElement>(null)
  const { shown, leaving } = useStateMark(state, snap)
  const connecting = useConnection(c => c.inProgress)
  const change = changeAt(useContext(ChangeMarksContext)?.shapes, id)
  const short = teaser(object.description)
  const external = isExternal(object)
  const { path, pad: [top, right, bottom, left], badge } = SHAPE_DEFS[shapeOf(object)]
  const shape = shapeOf(object)
  const name = object.name || id
  const meta = [external && 'external', object.tech || object.type].filter(Boolean).join(' · ')
  const kind = external ? `external ${object.type}` : object.type
  return (
    <div
      className={`box box-${object.type} shape-${shape}${external ? ' external' : ''}${isColor(object.color) ? ' colored' : ''}${fillOpacity(object) > 0 ? ' tinted' : ''}${onFill(object) ? ' on' : ''}${perf?.strain !== undefined ? ' strained' : ''}${shown ? ` ${stateClasses(shown)}${leaving ? ' state-leaving' : ''}` : ''}`}
      data-change={change}
      style={{ ...lookVars(object), ...(perf?.strain !== undefined && { '--strain': perf.strain }), padding: `${top}px ${right}px ${bottom}px ${left}px` }}
      onMouseEnter={() => { setHover(true); setClipped([...text.current?.children ?? []].some(e => e.scrollWidth > e.clientWidth)) }} onMouseLeave={() => setHover(false)}
    >
      <svg className="shape" viewBox="0 0 200 72" aria-hidden="true"><path d={path} /></svg>
      {change && <svg className="change-outline" viewBox="0 0 200 72" preserveAspectRatio="none" aria-hidden="true"><path d={path} /></svg>}
      {shown && !shown.inside && <svg className="state-outline" viewBox="0 0 200 72" aria-hidden="true"><path d={path} pathLength={100} /></svg>}
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} isConnectableStart={false} className={connecting ? 'drop' : undefined} />
      {showsTile(object) && <span className="tile" role="img" aria-label={kind} title={kind}><PathIcon d={icon} /></span>}
      <div className="box-text" ref={text}>
        <div className="box-name">{name}</div>
        <div className="box-meta">{meta}</div>
      </div>
      {perf && perf.queue > 0 && <span className="queue-badge" title={`${perf.queue} waiting`}>{perf.queue}</span>}
      {fail && <FailBadge mark={fail} />}
      {change && <ChangeBadge change={change} />}
      {shown && <StateGlyph mark={shown} />}
      {inside > 0 && <span className="inside" style={{ right: badge[0], bottom: badge[1] }}><ZoomIn />{inside} inside</span>}
      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
      {(short || clipped) && (
        <NodeToolbar isVisible={hover} position={Position.Bottom} className="teaser">
          {clipped && <div className="teaser-name"><b>{name}</b><span>{meta}</span></div>}
          {short && <Description text={short} />}
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
