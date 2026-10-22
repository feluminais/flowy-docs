import { useContext, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useInternalNode, ViewportPortal } from '@xyflow/react'
import type { InternalNode } from '@xyflow/react'
import { beatsFor, shortLabel } from '../../src/core/animation.ts'
import type { Animation, Beat, Glyph } from '../../src/core/animation.ts'
import { SHAPE_DEFS, shapeOf } from '../../src/core/look.ts'
import type { Model } from '../../src/core/model.ts'
import { nameOf, placeStep } from '../../src/core/views.ts'
import { BOX } from './graph.ts'
import type { BoxData, Rect } from './graph.ts'
import { LineStyleContext, pathBetween, rect } from './Line.tsx'
import { active, bump, cyclePeriod, distance, DWELL, ease, effectPose, entryPoint, keepsPlaying, litOpacity, markerSize, markerSpot, noteSpot, progress, squashTile, tintColor, tubeOpacity } from './motion.ts'

// The same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs): Tabler's mail, bolt and bell on a 24-unit grid.
const GLYPHS: Record<Glyph, string> = {
  envelope: 'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10zM3 7l9 6l9 -6',
  bolt: 'M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11',
  bell: 'M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6M9 17v1a3 3 0 0 0 6 0v-1',
}
const HIDDEN = { display: 'none' } as const
/** How strongly a shape lights up when it flashes, at the start. */
const FLASH = 0.55
/** The ticks of a puff where a request is lost. */
const TICKS = 6
/** How far the dashed outline around a box that takes a request stands off it. */
const HALO = 6
/** Every motion on screen and how long it takes, so the ones of a stop (a fan-out plays several) start again together. */
const running = new Map<symbol, number>()

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches
/** The drawn tile of a box on the canvas, which a gulp squashes. Looked for in this canvas: two flows side by side can hold a box of the same name. */
const tile = (id: string, canvas: ParentNode) => canvas.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] .box`)

/** The outline of the shape a box is drawn as, in the 200 by 72 area every shape is drawn in. */
const outlineOf = (n: InternalNode): string => SHAPE_DEFS[shapeOf((n.data as BoxData).object)].path

/** Who takes an intercepted request, as this view can draw it: a box on the canvas, or a party that is not on it, by name. */
export type TakenBy = { node: string } | { name: string }

/**
 * Who takes an intercepted request, as `view` can draw it: the box that stands for the shape in this view, unless that is an end of the step (the view folds the
 * shape into one of them) or the view can't show it; then its name stands in, drawn as a marker. Undefined for a step that is not intercepted.
 */
export function takenBy(model: Model, view: string, a: Animation, placed: readonly [string, string]): TakenBy | undefined {
  if (a.by === undefined) return undefined
  if ('name' in a.by) return { name: a.by.name }
  const box = placeStep(model, view, { from: a.by.shape })?.[0]
  return box !== undefined && box !== placed[0] && box !== placed[1] ? { node: box } : { name: nameOf(model, a.by.shape) }
}

/** What `shape` needs to draw something at the one who takes a request: the box when it is on the canvas, else the name its marker carries. */
type Taker = { rect?: Rect; path?: string; name?: string }

/**
 * What one beat looks like before it starts. The frame loop below moves and shows it. The pipe beat and a gulp draw nothing of their own: the line is the lit line the canvas already draws.
 * The marks of an outcome (a puff, a bar, a clock, a note, a marker) are laid out where they belong by the effect below, once it has measured the route.
 */
function shape(b: Beat, i: number, from: Rect, to: Rect, paths: [string, string], taker: Taker): ReactNode {
  const r = b.on === 'to' ? to : from
  const path = b.on === 'to' ? paths[1] : paths[0]
  switch (b.do) {
    case 'blob': {
      const label = b.label === undefined ? undefined : shortLabel(b.label)
      const half = label === undefined ? 15 : label.length * 4 + 10
      const classes = ['blob', ...(b.tone === undefined ? [] : [b.tone]), ...(b.tint === undefined ? [] : ['tinted'])].join(' ')
      return (
        <g key={i} data-beat={i} style={HIDDEN}>
          <g className={classes} style={b.tint === undefined ? undefined : ({ '--req': tintColor(b.tint) } as CSSProperties)}>
            <g className="stretch">
              {label === undefined
                ? <circle r={15} />
                : <rect x={-half} y={-13} width={half * 2} height={26} rx={13} />}
              {b.ring === true && (label === undefined
                ? <circle className="halo" r={21} />
                : <rect className="halo" x={-half - 6} y={-19} width={half * 2 + 12} height={38} rx={19} />)}
            </g>
            {label === undefined
              ? <path className="glyph" d={GLYPHS[b.glyph!]} transform="translate(-9 -9) scale(0.75)" />
              : <text textAnchor="middle" dominantBaseline="central">{label}</text>}
          </g>
        </g>
      )
    }
    // The ring and the flash follow the outline of the shape they are on, whatever it is, so a hexagon flashes as a hexagon.
    case 'ring':
      return <path key={i} data-beat={i} className="ring" d={path} style={HIDDEN} />
    case 'flash':
      if (b.on === 'by') {
        // The one who takes a request lights up: a box as its own outline, a marker as the dashed pill.
        if (taker.path !== undefined && taker.rect !== undefined)
          return <path key={i} data-beat={i} className="flash" d={taker.path} transform={`translate(${taker.rect.x} ${taker.rect.y}) scale(${taker.rect.width / BOX.width} ${taker.rect.height / BOX.height})`} style={HIDDEN} />
        const size = markerSize(taker.name ?? '')
        return <rect key={i} data-beat={i} className="flash" width={size.width} height={size.height} rx={14} style={HIDDEN} />
      }
      return <path key={i} data-beat={i} className={b.tone === 'fail' ? 'flash fail' : 'flash'} d={path} transform={`translate(${r.x} ${r.y}) scale(${r.width / BOX.width} ${r.height / BOX.height})`} style={HIDDEN} />
    case 'wait':
      return <g key={i} data-beat={i} className="dots" style={HIDDEN}>{[-12, 0, 12].map(dx => <circle key={dx} cx={r.x + r.width / 2 + dx} cy={r.y - 14} r={3.5} />)}</g>
    case 'drop':
      return <path key={i} data-beat={i} className="glyph drop" d={GLYPHS[b.glyph!]} style={HIDDEN} />
    // A puff where a request is lost: a ring and ticks that go out and fade, and a cross that stays.
    case 'pop':
      return (
        <g key={i} data-beat={i} className="pop" style={b.tint === undefined ? HIDDEN : ({ ...HIDDEN, '--req': tintColor(b.tint) } as CSSProperties)}>
          <circle className="puff" r={1} />
          {Array.from({ length: TICKS }, (_, k) => <line key={k} className="tick" />)}
          <path className="cross" d="M-7 -7L7 7M7 -7L-7 7" />
        </g>
      )
    // The bar by the receiver's door that turns a request away.
    case 'bar':
      return <g key={i} data-beat={i} className="bar" style={HIDDEN}><line x1={0} y1={-22} x2={0} y2={22} /></g>
    // A dashed clock turning while a request waits: a ring and a dot going round it, and the hands a still picture needs.
    case 'clock':
      return (
        <g key={i} data-beat={i} className="clock" style={HIDDEN}>
          <circle className="dial" r={24} />
          <g className="orbit"><circle className="spark" cx={24} cy={0} r={3.5} /></g>
          <path className="hands" d="M0 0V-10M0 0L7 4" />
        </g>
      )
    case 'note':
      return <text key={i} data-beat={i} className="note" textAnchor="middle" dominantBaseline="central" style={HIDDEN}>{b.text}</text>
    // Whoever takes a request, drawn for the whole step: a party that is not on the canvas as a dashed pill with its name, a box as a dashed outline around it.
    case 'marker': {
      if (taker.rect !== undefined && taker.path !== undefined) {
        const t = taker.rect
        return <g key={i} data-beat={i} className="marker around" style={HIDDEN}><rect x={t.x - HALO} y={t.y - HALO} width={t.width + 2 * HALO} height={t.height + 2 * HALO} rx={16} /></g>
      }
      const size = markerSize(taker.name ?? '')
      return (
        <g key={i} data-beat={i} className="marker" style={HIDDEN}>
          <rect width={size.width} height={size.height} rx={14} />
          <text x={size.width / 2} y={size.height / 2} textAnchor="middle" dominantBaseline="central">{taker.name}</text>
        </g>
      )
    }
    default:
      return null
  }
}

/** A puff at one moment: the ring and the ticks go out and fade, and the cross settles. Called with `p` of 1 it is the cross alone. */
function drawPop(node: SVGElement, p: number): void {
  const [puff, ...rest] = Array.from(node.children) as SVGElement[]
  const cross = rest.pop()!
  puff.setAttribute('r', String(6 + 22 * p))
  puff.style.opacity = String(1 - p)
  rest.forEach((tick, k) => {
    const angle = (k / TICKS) * 2 * Math.PI + 0.3
    const [near, far] = [10 + 16 * p, 16 + 24 * p]
    tick.setAttribute('x1', String(Math.cos(angle) * near))
    tick.setAttribute('y1', String(Math.sin(angle) * near))
    tick.setAttribute('x2', String(Math.cos(angle) * far))
    tick.setAttribute('y2', String(Math.sin(angle) * far))
    tick.style.opacity = String(1 - p)
  })
  cross.setAttribute('transform', `scale(${0.5 + 0.5 * Math.min(1, p * 4)})`)
  cross.style.opacity = String(0.9 * Math.min(1, p * 5))
}

/** The bar at one moment: it flashes in thick and settles, and stays. */
function drawBar(node: SVGElement, p: number): void {
  node.style.opacity = String(Math.min(1, p * 8))
  node.firstElementChild?.setAttribute('stroke-width', String(7 + 6 * Math.max(0, 1 - p * 4)))
}

/** A mark that stays once its beat has started: the cross where a request was lost, the bar at the door, and the marker of who takes it. The rest show only while their beat runs. */
const stays = (b: Beat): boolean => b.do === 'pop' || b.do === 'bar' || b.do === 'marker'

type Props = {
  /** The boxes the step lands on in this view (ids of nodes on the canvas), in the step's direction. */
  ends: [string, string]
  animation: Animation
  /** Whether the step before ended at this step's source (see followsLanding). */
  afterLanding: boolean
  /** Whether it plays again after a rest, until the step is left. */
  repeat: boolean
  /** Who takes an intercepted request, as this view can draw it. Left out, the name or id the step gives is drawn as a marker. */
  by?: TakenBy
  /** Called once when the motion has finished, or after a moment when motion is reduced. */
  onDone: () => void
}

/**
 * Plays one step's animation over the canvas: a blob running along the step's line, and rings, flashes
 * and squashes on the boxes. Mount it keyed by the step (and replay), so a new step cancels the old one.
 * When the system asks for less motion nothing moves: it draws only where the outcome happened (a cross, a bar, a marker, a clock, the reason)
 * and reports that it is done after a moment.
 */
export function StepMotion({ ends, animation, afterLanding, repeat, by, onDone }: Props) {
  const style = useContext(LineStyleContext)
  const from = useInternalNode(ends[0])
  const to = useInternalNode(ends[1])
  const taken = useInternalNode(by !== undefined && 'node' in by ? by.node : '')
  const [svg, setSvg] = useState<SVGSVGElement | null>(null)
  const done = useRef(onDone)
  done.current = onDone
  const again = useRef(repeat)
  again.current = repeat
  const wake = useRef<(() => void) | undefined>(undefined)
  const still = reducedMotion()
  // The one who takes an intercepted request: a box when the view shows it, else a marker with a name.
  const named = by !== undefined && 'name' in by ? by.name : animation.by === undefined ? undefined : 'name' in animation.by ? animation.by.name : animation.by.shape
  const taker: Taker = taken ? { rect: rect(taken), path: outlineOf(taken) } : { name: named }

  useEffect(() => {
    if (repeat) wake.current?.()
  }, [repeat])

  useEffect(() => {
    if (!still) return
    const wait = setTimeout(() => done.current(), DWELL)
    return () => clearTimeout(wait)
  }, [still])

  useEffect(() => {
    if (!svg || !from || !to) return
    const [a, b] = [rect(from), rect(to)]
    const route = svg.querySelector<SVGPathElement>('.route')!
    const length = route.getTotalLength()
    const { beats, total } = beatsFor(animation, { length, afterLanding })
    const nodes = beats.map((_, i) => svg.querySelector<SVGElement>(`[data-beat="${i}"]`))
    const stretches = nodes.map(n => n?.querySelector<SVGElement>('.stretch') ?? null)

    // A point of the route as a fraction of it, and the way the route runs there.
    const spotAt = (fraction: number) => {
      const at = fraction * length
      const here = route.getPointAtLength(at)
      const behind = route.getPointAtLength(Math.max(0, at - 2))
      const ahead = route.getPointAtLength(Math.min(length, at + 2))
      return { x: here.x, y: here.y, dx: ahead.x - behind.x, dy: ahead.y - behind.y }
    }
    // Where the one who takes a request is: its box, or the dashed marker that hangs below the line where the request leaves it.
    const markerAt = beats.find(x => x.do === 'marker')?.along ?? 0.4
    const takerBox: Rect | undefined = (() => {
      if (taker.rect) return taker.rect
      if (taker.name === undefined) return undefined
      const size = markerSize(taker.name)
      const s = spotAt(markerAt)
      const o = markerSpot(s.dx, s.dy, size)
      return { x: s.x + o.x - size.width / 2, y: s.y + o.y - size.height / 2, ...size }
    })()
    // Where the blob leaves the line for the one who takes it, and the edge of it that it runs to.
    const depart = (beat: Beat) => spotAt(beat.start ?? 0)
    const arrive = (beat: Beat) => (takerBox ? entryPoint(depart(beat), takerBox) : depart(beat))

    // The marks of an outcome stand where they belong from the start; the frame loop only shows them and moves what moves.
    beats.forEach((beat, i) => {
      const node = nodes[i]
      if (!node) return
      if (beat.do === 'pop' || beat.do === 'clock') {
        const s = spotAt(beat.along!)
        node.setAttribute('transform', `translate(${s.x} ${s.y})`)
      } else if (beat.do === 'bar') {
        const s = spotAt(beat.along!)
        node.setAttribute('transform', `translate(${s.x} ${s.y}) rotate(${(Math.atan2(s.dy, s.dx) * 180) / Math.PI})`)
      } else if (beat.do === 'note') {
        if (beat.on === 'by') {
          if (takerBox) node.setAttribute('transform', `translate(${takerBox.x + takerBox.width / 2} ${takerBox.y + takerBox.height + HALO + 12})`)
        } else {
          const s = spotAt(beat.along!)
          const o = noteSpot(s.dx, s.dy, (beat.text ?? '').length)
          node.setAttribute('transform', `translate(${s.x + o.x} ${s.y + o.y})`)
        }
      } else if ((beat.do === 'marker' || beat.do === 'flash') && beat.on === 'by' && !taker.rect && takerBox) {
        node.setAttribute('transform', `translate(${takerBox.x} ${takerBox.y})`)
      }
    })

    // Reduced motion: nothing moves. What stays is where the outcome happened, once each, and the step card says what happened.
    if (still) {
      const shown = new Set<string>()
      beats.forEach((beat, i) => {
        const node = nodes[i]
        if (!node || !(beat.do === 'pop' || beat.do === 'bar' || beat.do === 'clock' || beat.do === 'note' || beat.do === 'marker')) return
        const key = `${beat.do} ${beat.on} ${beat.along ?? ''} ${beat.text ?? ''}`
        if (shown.has(key)) return
        shown.add(key)
        node.style.display = ''
        if (beat.do === 'pop') drawPop(node, 1)
        else if (beat.do === 'bar') drawBar(node, 1)
        else if (beat.do === 'clock') node.classList.add('still')
      })
      return
    }

    const flow = svg.closest('.react-flow') ?? document
    const tiles = { from: tile(ends[0], flow), to: tile(ends[1], flow) }
    // A timeout dims the lit lines through `--lit` on the canvas (see style.css). Only a motion that has a fade writes it, so the other steps of a stop never undo it.
    const fades = beats.some(b => b.do === 'fade')
    const canvas = fades ? svg.closest<HTMLElement>('.react-flow') : null
    const me = Symbol('motion')
    running.set(me, total)
    const who = { from: Symbol('from'), to: Symbol('to') } // two asks, so a step that is both its ends squashes by the larger
    let frameId = 0
    let start: number | undefined

    const frame = (t: number) => {
      const squash = { from: 0, to: 0 }
      beats.forEach((beat, i) => {
        const node = nodes[i]
        const on = stays(beat) ? t >= beat.at : active(beat, t)
        const p = progress(beat, t)
        if (node) node.style.display = on ? '' : 'none'
        if (beat.do === 'pipe') return
        else if (beat.do === 'gulp' && on && (beat.on === 'from' || beat.on === 'to')) squash[beat.on] = Math.max(squash[beat.on], bump(p))
        else if (!node || !on) return
        else if (beat.do === 'blob') {
          let here: { x: number; y: number }
          let angle: number
          if (beat.on === 'by') {
            // Off the line, straight to the one who takes it.
            const [leave, land] = [depart(beat), arrive(beat)]
            here = { x: leave.x + (land.x - leave.x) * ease(p), y: leave.y + (land.y - leave.y) * ease(p) }
            angle = (Math.atan2(land.y - leave.y, land.x - leave.x) * 180) / Math.PI
          } else {
            const pos = distance(beat.dir, p, length, beat)
            here = route.getPointAtLength(pos)
            const behind = route.getPointAtLength(Math.max(0, pos - 2))
            const ahead = route.getPointAtLength(Math.min(length, pos + 2))
            angle = (Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI
          }
          // A blob keeps its shape unless the step asks for an effect (see EFFECTS), and one that waits where it is never moves for it. The glyph or the words in it are never stretched.
          const waiting = beat.start !== undefined && beat.start === beat.end
          const pose = animation.effect === undefined || waiting ? undefined : effectPose(animation.effect, beat.label !== undefined, angle, p)
          node.setAttribute('transform', pose ? `translate(${here.x} ${here.y + pose.dy}) rotate(${pose.turn})` : `translate(${here.x} ${here.y})`)
          stretches[i]?.setAttribute('transform', pose ? `rotate(${pose.rotate}) scale(${pose.x * pose.grow} ${pose.y * pose.grow}) rotate(${-pose.rotate})` : '')
        } else if (beat.do === 'ring') {
          const r = beat.on === 'to' ? b : a
          const grow = 6 + 22 * p
          // The outline, scaled about the middle of the shape to the size the ring has grown to.
          node.setAttribute('transform', `translate(${r.x + r.width / 2} ${r.y + r.height / 2}) scale(${(r.width + 2 * grow) / BOX.width} ${(r.height + 2 * grow) / BOX.height}) translate(${-BOX.width / 2} ${-BOX.height / 2})`)
          node.style.opacity = String(1 - p)
        } else if (beat.do === 'flash') node.style.opacity = String(FLASH * (1 - p))
        else if (beat.do === 'wait') [...node.children].forEach((dot, k) => ((dot as SVGElement).style.opacity = Math.floor(t / 150) % 3 === k ? '1' : '0.3'))
        else if (beat.do === 'drop') {
          const r = beat.on === 'to' ? b : a
          node.setAttribute('transform', `translate(${r.x + r.width / 2 - 13} ${r.y - 50 + 50 * ease(p) - 13}) scale(1.08)`)
          node.style.opacity = String(1 - Math.max(0, (p - 0.8) / 0.2))
        } else if (beat.do === 'pop') drawPop(node, p)
        else if (beat.do === 'bar') drawBar(node, p)
        else if (beat.do === 'clock' || beat.do === 'note') node.style.opacity = String(tubeOpacity(beat, t))
        else if (beat.do === 'marker') node.style.opacity = String(Math.min(1, (t - beat.at) / 150))
      })
      for (const side of ['from', 'to'] as const) {
        const el = tiles[side]
        if (el) squashTile(el, who[side], squash[side])
      }
      canvas?.style.setProperty('--lit', String(litOpacity(beats, t)))
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
      frameId = keepsPlaying(since, total, again.current) ? requestAnimationFrame(loop) : 0
    }
    frameId = requestAnimationFrame(loop)
    // Repeat turned on after the motion is over plays it again from the start.
    wake.current = () => {
      if (frameId !== 0) return
      start = undefined
      frameId = requestAnimationFrame(loop)
    }
    return () => {
      wake.current = undefined
      running.delete(me)
      cancelAnimationFrame(frameId)
      canvas?.style.removeProperty('--lit')
      for (const side of ['from', 'to'] as const) {
        const el = tiles[side]
        if (el) squashTile(el, who[side], 0)
      }
    }
  }, [svg])

  if (!from || !to) return null
  const d = pathBetween(style, from, to)
  const [a, b] = [rect(from), rect(to)]
  return (
    <ViewportPortal>
      <svg ref={setSvg} className="motion" aria-hidden="true">
        <path className="route" d={d} />
        {beatsFor(animation, { length: 0, afterLanding }).beats.map((beat, i) => shape(beat, i, a, b, [outlineOf(from), outlineOf(to)], taker))}
      </svg>
    </ViewportPortal>
  )
}
