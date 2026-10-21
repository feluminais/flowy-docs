import { useEffect, useMemo, useRef } from 'react'
import { useStore, useStoreApi } from '@xyflow/react'
import type { LineTraffic } from '../../src/core/perf.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { depthIn } from './graph.ts'
import type { Outline, Rect } from './graph.ts'
import { outline, pathBetween, rect } from './Line.tsx'
import { flatten, pointAt } from './pathpoints.ts'
import { advance, ghost, howBehind, newStream, visibility } from './traffic.ts'
import type { Stream } from './traffic.ts'

/** A shape a line runs behind: where it is and its outline. */
type Shape = { rect: Rect; edge: Outline }

/**
 * How far behind something the particle at (x, y) is, 0 to 1: the most of any shape its line runs behind, or label, which sits on its line with
 * the canvas's own background. 0 when it is clear of them all, so most particles cost a bounds check or two.
 */
const behindOf = (shapes: Shape[], labels: Rect[], x: number, y: number, ramp: number): number => {
  let most = 0
  const near = (r: Rect) => x > r.x - ramp && x < r.x + r.width + ramp && y > r.y - ramp && y < r.y + r.height + ramp
  for (const s of shapes) if (near(s.rect)) most = Math.max(most, howBehind(depthIn(s.rect, s.edge, x, y), ramp))
  for (const l of labels) if (near(l)) most = Math.max(most, howBehind(depthIn(l, [], x, y), ramp))
  return most
}

/**
 * Where the things that sit over the lines are, in the diagram's own units: the rectangle behind each label showing, and the card a shape shows
 * when it is pointed at (once it has faded in). The page owns them, so they are read from it.
 */
const labelsIn = (el: HTMLElement, [tx, ty, zoom]: [number, number, number]): Rect[] => {
  const root = el.getBoundingClientRect()
  return [...(el.closest('.react-flow')?.querySelectorAll('.react-flow__edge-textbg, .teaser') ?? [])].flatMap(n => {
    const r = n.getBoundingClientRect()
    if (r.width === 0 || (n.classList.contains('teaser') && Number(getComputedStyle(n).opacity) < 0.05)) return []
    return [{ x: (r.left - root.left - tx) / zoom, y: (r.top - root.top - ty) / zoom, width: r.width / zoom, height: r.height / zoom }]
  })
}

/**
 * The traffic on the lines: small particles running from one shape to the other, as many and as fast as the load says (see
 * traffic() in core/perf.ts), and the ones that fail dying away short of the end. One canvas over the diagram, drawn with
 * the same camera as the shapes. Each line's path is flattened once, because asking the browser for a point on a path takes
 * about 28 µs and a busy view has thousands of particles a frame. Where its line runs behind a shape that is not one of its ends,
 * or under a label, a particle is still drawn, going faint and a little smaller as it goes behind and back as it comes out, so the
 * flow reads through what covers it. Reduced motion draws none: the caller leaves this out.
 */
export function TrafficLayer({ lines, style }: { lines: LineTraffic[]; style: LineStyle }) {
  const store = useStoreApi()
  // Where every shape is and how big it is, as text: it changes exactly when a line's path would, and only then does the layer draw itself again.
  const where = useStore(s => [...s.nodeLookup.values()].map(n => `${n.id} ${n.internals.positionAbsolute.x} ${n.internals.positionAbsolute.y} ${n.measured.width} ${n.measured.height}`).join(','))
  const canvas = useRef<HTMLCanvasElement>(null)
  // One polyline per line, made again when a shape moves or the style of lines changes, with the shapes it runs behind: every shape but its own two ends.
  const paths = useMemo(
    () => {
      const boxes = store.getState().nodeLookup
      const shapes = [...boxes.values()].filter(n => n.type === 'box').map(n => ({ id: n.id, rect: rect(n), edge: outline(n) }))
      return lines.map(l => {
        const a = boxes.get(l.from)
        const b = boxes.get(l.to)
        return a && b ? { path: flatten(pathBetween(style, a, b)), shapes: shapes.filter(s => s.id !== l.from && s.id !== l.to) } : undefined
      })
    },
    [lines, where, style, store],
  )
  const now = useRef({ lines, paths })
  now.current = { lines, paths }
  const streams = useRef(new Map<string, Stream>())

  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext('2d')!
    let frame = 0
    let last = performance.now()
    let colours = { ok: '#2563eb', bad: '#b91c1c' }
    let colourAt = 0
    const draw = (t: number) => {
      const ms = Math.min(100, t - last) // a tab that was asleep doesn't pour out everything it missed
      last = t
      if (t - colourAt > 500) {
        const css = getComputedStyle(el)
        colours = { ok: css.getPropertyValue('--accent').trim() || colours.ok, bad: css.getPropertyValue('--danger').trim() || colours.bad }
        colourAt = t
      }
      const dpr = window.devicePixelRatio || 1
      const [w, h] = [Math.round(el.clientWidth * dpr), Math.round(el.clientHeight * dpr)]
      if (el.width !== w || el.height !== h) {
        el.width = w
        el.height = h
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const transform = store.getState().transform
      const [tx, ty, zoom] = transform
      ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, tx * dpr, ty * dpr)
      const labels = labelsIn(el, transform)
      const { lines, paths } = now.current
      const alive = new Set<string>()
      lines.forEach((line, i) => {
        if (!paths[i]) return
        const { path, shapes } = paths[i]!
        const key = `${line.from} ${line.to}`
        alive.add(key)
        let stream = streams.current.get(key)
        if (!stream) streams.current.set(key, (stream = newStream()))
        advance(stream, line, ms, Math.random)
        const radius = (2.2 + line.width / 2) / zoom // a few pixels on screen, whatever the zoom
        const ramp = radius * 2 // how far either side of an outline a particle takes to go from clear to well behind
        ctx.fillStyle = colours.ok
        ctx.beginPath()
        const faint: [number, number, number][] = [] // the ones behind something, drawn after the rest one at a time
        for (const m of stream.motes) {
          if (m.fails) continue
          const [x, y] = pointAt(path, m.s)
          const b = behindOf(shapes, labels, x, y, ramp)
          if (b > 0) {
            faint.push([x, y, b])
            continue
          }
          ctx.moveTo(x + radius, y)
          ctx.arc(x, y, radius, 0, Math.PI * 2)
        }
        ctx.fill()
        for (const [x, y, b] of faint) {
          const g = ghost(b)
          ctx.globalAlpha = g.alpha
          ctx.beginPath()
          ctx.arc(x, y, radius * g.scale, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.fillStyle = colours.bad
        for (const m of stream.motes) {
          if (!m.fails) continue
          const [x, y] = pointAt(path, m.s)
          const g = ghost(behindOf(shapes, labels, x, y, ramp))
          ctx.globalAlpha = visibility(m) * g.alpha
          ctx.beginPath()
          ctx.arc(x, y, radius * g.scale, 0, Math.PI * 2)
          ctx.fill()
        }
        ctx.globalAlpha = 1
      })
      for (const key of streams.current.keys()) if (!alive.has(key)) streams.current.delete(key) // a line the view no longer has
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [store])

  return <canvas ref={canvas} className="traffic" aria-hidden="true" />
}
