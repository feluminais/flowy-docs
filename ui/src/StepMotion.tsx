import { useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useInternalNode, ViewportPortal } from '@xyflow/react'
import { beatsFor } from '../../src/core/animation.ts'
import type { Animation, Beat, Glyph } from '../../src/core/animation.ts'
import { SHAPE_DEFS, shapeOf } from '../../src/core/look.ts'
import type { BoxData, Rect } from './graph.ts'
import { LineStyleContext, loopPath, pathBetween, rect } from './Line.tsx'
import { active, bump, cardBox, cardsAt, dashAround, distance, DWELL, ease, pillText, progress, tileSquash, tubeOpacity } from './motion.ts'

// The same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs): Tabler's mail, bolt and bell on a 24-unit grid.
const GLYPHS: Record<Glyph, string> = {
  envelope: 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10zM3 7l9 6l9 -6',
  bolt: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
  bell: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6M9 17v1a3 3 0 0 0 6 0v-1',
  flag: 'M5 5a5 5 0 0 1 7 0a5 5 0 0 0 7 0v9a5 5 0 0 1 -7 0a5 5 0 0 0 -7 0v-9zM5 21v-7',
}
const SWELL = 46 // px of tube that bulges around a blob
const HIDDEN = { display: 'none' } as const

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** The drawn tile of a box on the canvas, which a gulp squashes. */
const tile = (id: string) => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] .box`)

/** What one beat looks like before it starts. The frame loop below moves and shows it. The tube and a gulp draw nothing of their own. */
function shape(b: Beat, i: number, from: Rect, to: Rect): ReactNode {
  const r = b.on === 'to' ? to : from
  switch (b.do) {
    case 'blob':
      return (
        <g key={i} data-beat={i} style={HIDDEN}>
          <g className={b.tone === 'reply' ? 'blob reply' : 'blob'}>
            {b.label === undefined
              ? <circle r={15} />
              : <rect x={-(b.label.length * 4 + 10)} y={-13} width={b.label.length * 8 + 20} height={26} rx={13} />}
            {b.label === undefined
              ? <path className="glyph" d={GLYPHS[b.glyph!]} transform="translate(-9 -9) scale(0.75)" />
              : <text textAnchor="middle" dominantBaseline="central">{b.label}</text>}
          </g>
        </g>
      )
    case 'ring':
      return <rect key={i} data-beat={i} className="ring" style={HIDDEN} />
    case 'flash':
      return <rect key={i} data-beat={i} className="flash" x={r.x} y={r.y} width={r.width} height={r.height} rx={14} style={HIDDEN} />
    case 'wait':
      return <g key={i} data-beat={i} className="dots" style={HIDDEN}>{[-12, 0, 12].map(dx => <circle key={dx} cx={r.x + r.width / 2 + dx} cy={r.y - 14} r={3.5} />)}</g>
    case 'drop':
      return <path key={i} data-beat={i} className="glyph drop" d={GLYPHS[b.glyph!]} style={HIDDEN} />
    default:
      return null
  }
}

/** Where the counter of a recursing box sits for the words it says: on the box's top-right corner, wide enough for them. */
const pillAt = (box: Rect, text: string) => {
  const width = 14 + 7 * text.length
  const x = box.x + box.width - 6 - width
  return { x, width, textX: x + width / 2 }
}

/** The counter on a recursing box. The frame loop rewrites it while the motion runs (see writePill). */
function Pill({ box, text }: { box: Rect; text: string }) {
  const at = pillAt(box, text)
  return (
    <g className="pill">
      <rect x={at.x} y={box.y - 11} width={at.width} height={22} rx={11} />
      <text x={at.textX} y={box.y} textAnchor="middle" dominantBaseline="central">{text}</text>
    </g>
  )
}

function writePill(pill: Element, box: Rect, text: string) {
  const at = pillAt(box, text)
  const [back, words] = [pill.querySelector('rect')!, pill.querySelector('text')!]
  back.setAttribute('x', String(at.x))
  back.setAttribute('width', String(at.width))
  words.setAttribute('x', String(at.textX))
  words.textContent = text
}

type Props = {
  /** The boxes the step lands on in this view (ids of nodes on the canvas), in the step's direction. */
  ends: [string, string]
  animation: Animation
  /** Whether the step before ended at this step's source (see followsLanding). */
  afterLanding: boolean
  /** Called once when the motion has finished, or after a moment when motion is reduced. */
  onDone: () => void
}

/**
 * Plays one step's animation over the canvas: the line as a pipe, a blob running through it, and rings, flashes
 * and squashes on the boxes. Mount it keyed by the step (and replay), so a new step cancels the old one.
 * A recursion's pipe loops out of its box and back in, with a pile of ghost cards under the box and a counter on its corner.
 * When the system asks for less motion it draws nothing (a recursion keeps its counter) and only reports that it is done.
 */
export function StepMotion({ ends, animation, afterLanding, onDone }: Props) {
  const style = useContext(LineStyleContext)
  const from = useInternalNode(ends[0])
  const to = useInternalNode(ends[1])
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  const still = reducedMotion()
  const recursing = animation.kind === 'recurse'
  const depth = animation.depth ?? 3
  const maskId = `cards${useId().replace(/\W/g, '')}`

  useEffect(() => {
    if (!still) return
    const wait = setTimeout(() => done.current(), DWELL)
    return () => clearTimeout(wait)
  }, [still])

  useEffect(() => {
    if (!svg || !from || !to) return
    const [a, b] = [rect(from), rect(to)]
    const bore = svg.querySelector<SVGPathElement>('.tube .bore')!
    const tube = svg.querySelector<SVGElement>('.tube')!
    const swells = svg.querySelectorAll<SVGPathElement>('.bulge')
    const length = bore.getTotalLength()
    const { beats, total } = beatsFor(animation, { length, afterLanding })
    const nodes = beats.map((_, i) => svg.querySelector<SVGElement>(`[data-beat="${i}"]`))
    const same = ends[0] === ends[1] // a recursion: one box at both ends
    const tiles = { from: tile(ends[0]), to: tile(ends[1]) }
    const sides = same ? (['from'] as const) : (['from', 'to'] as const)
    const piled = [...svg.querySelectorAll<SVGPathElement>('.card')]
    const pill = svg.querySelector('.pill')
    let frameId = 0
    let start: number | undefined

    const frame = (t: number) => {
      const squash = { from: 0, to: 0 }
      let swelling: number | undefined
      beats.forEach((beat, i) => {
        const node = nodes[i]
        const on = active(beat, t)
        const p = progress(beat, t)
        if (node) node.style.display = on ? '' : 'none'
        if (beat.do === 'pipe') tube.style.opacity = String(tubeOpacity(beat, t))
        else if (beat.do === 'gulp' && on && beat.on !== 'line') squash[beat.on] = Math.max(squash[beat.on], bump(p))
        else if (!node || !on) return
        else if (beat.do === 'blob') {
          const pos = distance(beat.dir, p, length)
          const here = bore.getPointAtLength(pos)
          const behind = bore.getPointAtLength(Math.max(0, pos - 2))
          const ahead = bore.getPointAtLength(Math.min(length, pos + 2))
          const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI
          // Stretched along the way it runs, and no more rotated than that: the glyph stays upright.
          node.setAttribute('transform', `translate(${here.x} ${here.y}) rotate(${angle}) scale(${1 + 0.3 * bump(p)} ${1 - 0.15 * bump(p)}) rotate(${-angle})`)
          swelling = pos
        } else if (beat.do === 'ring') {
          const r = beat.on === 'to' ? b : a
          const grow = 6 + 22 * p
          node.setAttribute('x', String(r.x - grow))
          node.setAttribute('y', String(r.y - grow))
          node.setAttribute('width', String(r.width + 2 * grow))
          node.setAttribute('height', String(r.height + 2 * grow))
          node.setAttribute('rx', String(14 + grow))
          node.style.opacity = String(1 - p)
        } else if (beat.do === 'flash') node.style.opacity = String(0.4 * (1 - p))
        else if (beat.do === 'wait') [...node.children].forEach((dot, k) => ((dot as SVGElement).style.opacity = Math.floor(t / 150) % 3 === k ? '1' : '0.3'))
        else if (beat.do === 'drop') {
          const r = beat.on === 'to' ? b : a
          node.setAttribute('transform', `translate(${r.x + r.width / 2 - 13} ${r.y - 50 + 50 * ease(p) - 13}) scale(1.08)`)
          node.style.opacity = String(1 - Math.max(0, (p - 0.8) / 0.2))
        }
      })
      for (const swell of swells) {
        swell.style.display = swelling === undefined ? 'none' : ''
        if (swelling !== undefined) {
          const dash = dashAround(swelling, length, SWELL)
          swell.style.strokeDasharray = dash.array
          swell.style.strokeDashoffset = String(dash.offset)
        }
      }
      if (recursing) {
        const cards = cardsAt(beats, t)
        piled.forEach((card, i) => {
          const amount = Math.min(1, cards - i) // card i + 1 slides in over the first 150 ms of its beat
          card.style.display = amount > 0 ? '' : 'none'
          if (amount > 0) {
            const box = cardBox(a, i + 1, amount)
            card.setAttribute('transform', `translate(${box.x} ${box.y}) scale(${box.width / 200} ${box.height / 72})`)
          }
        })
        if (pill) writePill(pill, a, pillText(t < total, cards, depth))
      }
      const squashed = tileSquash(same, squash)
      for (const side of sides) {
        const el = tiles[side]
        if (el) el.style.transform = squashed[side] > 0 ? `scale(${1 + 0.07 * squashed[side]}, ${1 - 0.1 * squashed[side]})` : ''
      }
    }

    const loop = (now: number) => {
      start ??= now
      const t = now - start
      frame(t)
      if (t < total) frameId = requestAnimationFrame(loop)
      else done.current()
    }
    frameId = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frameId)
      for (const el of Object.values(tiles)) if (el) el.style.transform = ''
    }
  }, [svg])

  if (still && recursing && from) {
    return (
      <ViewportPortal>
        <svg className="motion" aria-hidden="true"><Pill box={rect(from)} text={pillText(false, 0, depth)} /></svg>
      </ViewportPortal>
    )
  }
  if (still || !from || !to) return null
  const d = recursing ? loopPath(from) : pathBetween(style, from, to)
  const [a, b] = [rect(from), rect(to)]
  const shapePath = SHAPE_DEFS[shapeOf((from.data as BoxData).object)].path
  return (
    <ViewportPortal>
      <svg ref={setSvg} className="motion" aria-hidden="true">
        {recursing && (
          <>
            {/* The cards are copies of the box's own shape, and the mask hides the part of them that is inside the box. */}
            <mask id={maskId} maskUnits="userSpaceOnUse" x={a.x - 40} y={a.y - 40} width={a.width + 80} height={a.height + 130}>
              <rect x={a.x - 40} y={a.y - 40} width={a.width + 80} height={a.height + 130} style={{ fill: 'white' }} />
              <path d={shapePath} transform={`translate(${a.x} ${a.y}) scale(${a.width / 200} ${a.height / 72})`} style={{ fill: 'black', stroke: 'none' }} />
            </mask>
            {/* The mask goes on a group with no transform of its own: a mask is read in the coordinates of whatever carries it, cards' transforms included. */}
            <g mask={`url(#${maskId})`}>
              {Array.from({ length: depth - 1 }, (_, i) => <path key={i} className="card" d={shapePath} style={HIDDEN} />)}
            </g>
          </>
        )}
        <g className="tube" style={{ opacity: 0 }}>
          <path className="wall" d={d} />
          <path className="bore" d={d} />
        </g>
        <path className="bulge wall" d={d} style={HIDDEN} />
        <path className="bulge bore" d={d} style={HIDDEN} />
        {beatsFor(animation, { length: 0, afterLanding }).beats.map((beat, i) => shape(beat, i, a, b))}
        {recursing && <Pill box={a} text={pillText(true, 0, depth)} />}
      </svg>
    </ViewportPortal>
  )
}
