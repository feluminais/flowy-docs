import { useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useInternalNode, ViewportPortal } from '@xyflow/react'
import { beatsFor } from '../../src/core/animation.ts'
import type { Animation, Beat, Glyph } from '../../src/core/animation.ts'
import type { Rect } from './graph.ts'
import { LineStyleContext, pathBetween, rect } from './Line.tsx'
import { active, bump, cyclePeriod, distance, DWELL, ease, progress, squashTile, tubeOpacity } from './motion.ts'

// The same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs): Tabler's mail, bolt and bell on a 24-unit grid.
const GLYPHS: Record<Glyph, string> = {
  envelope: 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10zM3 7l9 6l9 -6',
  bolt: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
  bell: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6M9 17v1a3 3 0 0 0 6 0v-1',
}
const HIDDEN = { display: 'none' } as const
/** Every motion on screen and how long it takes, so the ones of a stop (a fan-out plays several) start again together. */
const running = new Map<symbol, number>()

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
            <g className="stretch">
              {b.label === undefined
                ? <circle r={15} />
                : <rect x={-(b.label.length * 4 + 10)} y={-13} width={b.label.length * 8 + 20} height={26} rx={13} />}
            </g>
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

type Props = {
  /** The boxes the step lands on in this view (ids of nodes on the canvas), in the step's direction. */
  ends: [string, string]
  animation: Animation
  /** Whether the step before ended at this step's source (see followsLanding). */
  afterLanding: boolean
  /** Whether it plays again after a rest, until the step is left. */
  repeat: boolean
  /** Called once when the motion has finished, or after a moment when motion is reduced. */
  onDone: () => void
}

/**
 * Plays one step's animation over the canvas: the line as a pipe, a blob running through it, and rings, flashes
 * and squashes on the boxes. Mount it keyed by the step (and replay), so a new step cancels the old one.
 * When the system asks for less motion it draws nothing and only reports that it is done.
 */
export function StepMotion({ ends, animation, afterLanding, repeat, onDone }: Props) {
  const style = useContext(LineStyleContext)
  const from = useInternalNode(ends[0])
  const to = useInternalNode(ends[1])
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  const again = useRef(repeat)
  again.current = repeat
  const still = reducedMotion()

  useEffect(() => {
    if (!still) return
    const wait = setTimeout(() => done.current(), DWELL)
    return () => clearTimeout(wait)
  }, [still])

  useEffect(() => {
    if (!svg || !from || !to) return
    const [a, b] = [rect(from), rect(to)]
    const route = svg.querySelector<SVGPathElement>('.tube .core')!
    const tube = svg.querySelector<SVGElement>('.tube')!
    const length = route.getTotalLength()
    const { beats, total } = beatsFor(animation, { length, afterLanding })
    const nodes = beats.map((_, i) => svg.querySelector<SVGElement>(`[data-beat="${i}"]`))
    const stretches = nodes.map(n => n?.querySelector<SVGElement>('.stretch') ?? null)
    const tiles = { from: tile(ends[0]), to: tile(ends[1]) }
    const me = Symbol('motion')
    running.set(me, total)
    const who = { from: Symbol('from'), to: Symbol('to') } // two asks, so a step that is both its ends squashes by the larger
    let frameId = 0
    let start: number | undefined

    const frame = (t: number) => {
      const squash = { from: 0, to: 0 }
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
          const here = route.getPointAtLength(pos)
          const behind = route.getPointAtLength(Math.max(0, pos - 2))
          const ahead = route.getPointAtLength(Math.min(length, pos + 2))
          const angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI
          // The shape is stretched along the way it runs, and no more rotated than that. The glyph or the words in it are not stretched at all.
          node.setAttribute('transform', `translate(${here.x} ${here.y})`)
          stretches[i]?.setAttribute('transform', `rotate(${angle}) scale(${1 + 0.3 * bump(p)} ${1 - 0.15 * bump(p)}) rotate(${-angle})`)
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
      for (const side of ['from', 'to'] as const) {
        const el = tiles[side]
        if (el) squashTile(el, who[side], squash[side])
      }
    }

    // Plays, and with Repeat on rests and plays again until the step is left. Autoplay hears about the first play only.
    let finished = false
    const loop = (now: number) => {
      start ??= now
      const since = now - start
      frame(again.current ? since % cyclePeriod(running.values()) : Math.min(since, total))
      if (!finished && since >= total) {
        finished = true
        done.current()
      }
      frameId = requestAnimationFrame(loop)
    }
    frameId = requestAnimationFrame(loop)
    return () => {
      running.delete(me)
      cancelAnimationFrame(frameId)
      for (const side of ['from', 'to'] as const) {
        const el = tiles[side]
        if (el) squashTile(el, who[side], 0)
      }
    }
  }, [svg])

  if (still || !from || !to) return null
  const d = pathBetween(style, from, to)
  const [a, b] = [rect(from), rect(to)]
  return (
    <ViewportPortal>
      <svg ref={setSvg} className="motion" aria-hidden="true">
        <g className="tube" style={{ opacity: 0 }}>
          <path className="core" d={d} />
        </g>
        {beatsFor(animation, { length: 0, afterLanding }).beats.map((beat, i) => shape(beat, i, a, b))}
      </svg>
    </ViewportPortal>
  )
}
