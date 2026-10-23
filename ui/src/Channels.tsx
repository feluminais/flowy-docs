import { useContext, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useInternalNode, ViewportPortal } from '@xyflow/react'
import { beatsFor } from '../../src/core/animation.ts'
import type { Animation, ChannelKind } from '../../src/core/animation.ts'
import { CHANNEL_LABELS } from '../../src/core/channels.ts'
import type { Channel } from '../../src/core/channels.ts'
import { LineStyleContext, pathBetween, rect } from './Line.tsx'
import { KeyItem, KeyRow } from './legend.tsx'

/** A channel open at the stop on show, with the boxes its ends are in this view, and the motion of the step that opens or closes it (the mark waits for it to land). */
export type OpenChannel = { channel: Channel; placed: [string, string]; motion?: Animation }

// Tabler's bell and the arc of a spinner on a 24-unit grid; the same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs).
const BELL = 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6M9 17v1a3 3 0 0 0 6 0v-1'
const ARC = 'M12 3a9 9 0 1 0 9 9'
/** The disc of a listener or a job, which sits on the top edge of the box it points at, and how far apart a box's discs stand. */
const DISC = 11
const GAP = 4

/** The drawing inside a disc: a bell for a listener, a turning arc for a job. Centred on the origin. */
function Glyph({ kind }: { kind: Exclude<ChannelKind, 'stream'> }) {
  return (
    <g className={kind === 'job' ? 'spin' : undefined}>
      <path className="glyph" d={kind === 'job' ? ARC : BELL} transform="translate(-7 -7) scale(0.58)" />
    </g>
  )
}

/** The dots that run along a stream's line, in the direction its data goes. A paler dot beneath keeps them visible on the lit line. */
function Dots({ d }: { d: string }) {
  return (
    <>
      <path className="stream-back" d={d} />
      <path className="stream-dots" d={d} />
    </>
  )
}

/**
 * One open channel, drawn over the canvas for as long as it is open: a stream as dots running along its line, a listener as a bell that
 * rings out from the shape that listens (with a dotted line to the shape it listens to), a job as an arc turning on the shape it runs on.
 * At the stop that opens it, it appears when the step's motion has landed; at the stop that closes it, it goes then.
 */
function OneChannel({ open, slot }: { open: OpenChannel; slot: number }) {
  const { channel: c, placed, motion } = open
  const style = useContext(LineStyleContext)
  const from = useInternalNode(placed[0])
  const to = useInternalNode(placed[1])
  const route = useRef<SVGPathElement>(null)
  const [laid, setLaid] = useState<{ x: number; y: number; after: number }>()
  const d = from && to && from !== to ? pathBetween(style, from, to) : ''

  useLayoutEffect(() => {
    const path = route.current
    if (!path || d === '') return
    const length = path.getTotalLength()
    const mid = path.getPointAtLength(length / 2)
    const waits = (c.opening || c.closing) && motion !== undefined
    setLaid({ x: mid.x, y: mid.y, after: waits ? beatsFor(motion, { length, afterLanding: false }).total : 0 })
  }, [d, c.opening, c.closing, motion])

  if (!from || !to) return null
  const at = c.end === 'to' ? to : from
  const r = rect(at)
  const badge = { x: r.x + r.width - DISC - GAP - slot * (2 * DISC + GAP), y: r.y }
  const classes = ['channels', c.kind, c.end === 'from' ? 'reverse' : '', c.opening ? 'opening' : '', c.closing ? 'closing' : ''].filter(Boolean).join(' ')
  const wait = { '--after': `${laid?.after ?? 0}ms` } as CSSProperties
  return (
    <ViewportPortal>
      <svg className={classes} style={wait} aria-hidden="true" data-channel={c.name ?? c.kind}>
        <path ref={route} className="route" d={d} />
        {c.kind === 'stream' && d !== '' && <Dots d={d} />}
        {c.kind === 'listener' && d !== '' && <path className="tether" d={d} />}
        {c.kind !== 'stream' && (
          <g className="badge" transform={`translate(${badge.x} ${badge.y})`}>
            <circle className="ripple" r={DISC} />
            <circle className="ripple later" r={DISC} />
            <circle className="disc" r={DISC} />
            <Glyph kind={c.kind} />
            {c.name !== undefined && <text className="label" y={-DISC - 10} textAnchor="middle" dominantBaseline="central">{c.name}</text>}
          </g>
        )}
        {c.kind === 'stream' && c.name !== undefined && laid && <text className="label" x={laid.x} y={laid.y - 16} textAnchor="middle" dominantBaseline="central">{c.name}</text>}
      </svg>
    </ViewportPortal>
  )
}

/** Every channel open at the stop on show. Mount it before the step's motion, so a blob runs over a stream and not under it. */
export function ChannelMarks({ open, stepKey }: { open: OpenChannel[]; stepKey: string }) {
  // A box's discs stand side by side along its top edge, in the order they were opened, so none hides another.
  const used = new Map<string, number>()
  return (
    <>
      {open.map(o => {
        const box = o.placed[o.channel.end === 'to' ? 1 : 0]
        const slot = o.channel.kind === 'stream' ? 0 : (used.get(box) ?? 0)
        if (o.channel.kind !== 'stream') used.set(box, slot + 1)
        return <OneChannel key={`${stepKey}:${o.channel.step}`} open={o} slot={slot} />
      })}
    </>
  )
}

/** A mark as the key draws it: the same dots, disc and glyph as on the canvas, still. */
function Swatch({ kind }: { kind: ChannelKind }) {
  return (
    <svg className="channel-swatch" viewBox="0 0 30 18" aria-hidden="true">
      {kind === 'stream'
        ? <Dots d="M3 9H27" />
        : (
          <g transform="translate(15 9)">
            <circle className="disc" r={DISC - 1} />
            <Glyph kind={kind} />
          </g>
        )}
    </svg>
  )
}

/** The key under the player: one mark for each kind of channel that is open now, drawn as it looks on the canvas, and nothing when none is. */
export function ChannelKey({ kinds }: { kinds: readonly ChannelKind[] }) {
  if (kinds.length === 0) return null
  return (
    <KeyRow>
      {kinds.map(kind => <KeyItem key={kind} swatch={<Swatch kind={kind} />}>{CHANNEL_LABELS[kind]}</KeyItem>)}
    </KeyRow>
  )
}
