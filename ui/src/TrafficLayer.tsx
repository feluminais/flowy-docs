import { useEffect, useMemo, useRef } from 'react'
import { useStore, useStoreApi } from '@xyflow/react'
import type { LineTraffic } from '../../src/core/perf.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { covers } from './graph.ts'
import type { Outline } from './graph.ts'
import { outline, pathBetween, rect } from './Line.tsx'
import { flatten, pointAt } from './pathpoints.ts'
import { advance, newStream, visibility } from './traffic.ts'
import type { Stream } from './traffic.ts'

/** A shape a line runs behind: where it is and its outline. */
type Behind = { rect: ReturnType<typeof rect>; edge: Outline }

/** Whether a particle at (x, y) is under a shape the line runs behind: the line is hidden there, so the particle is too. */
const hidden = (behind: Behind[], x: number, y: number, radius: number) => {
  for (const s of behind) if (covers(s.rect, s.edge, x, y, radius)) return true
  return false
}

/**
 * The traffic on the lines: small particles running from one shape to the other, as many and as fast as the load says (see
 * traffic() in core/perf.ts), and the ones that fail dying away short of the end. One canvas over the diagram, drawn with
 * the same camera as the shapes. Each line's path is flattened once, because asking the browser for a point on a path takes
 * about 28 µs and a busy view has thousands of particles a frame. A particle is not drawn where its line runs behind a shape
 * that is not one of its ends, as the line itself isn't. Reduced motion draws none: the caller leaves this out.
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
        return a && b ? { path: flatten(pathBetween(style, a, b)), behind: shapes.filter(s => s.id !== l.from && s.id !== l.to) } : undefined
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
      const [tx, ty, zoom] = store.getState().transform
      ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, tx * dpr, ty * dpr)
      const { lines, paths } = now.current
      const alive = new Set<string>()
      lines.forEach((line, i) => {
        if (!paths[i]) return
        const { path, behind } = paths[i]!
        const key = `${line.from} ${line.to}`
        alive.add(key)
        let stream = streams.current.get(key)
        if (!stream) streams.current.set(key, (stream = newStream()))
        advance(stream, line, ms, Math.random)
        const radius = (2.2 + line.width / 2) / zoom // a few pixels on screen, whatever the zoom
        ctx.fillStyle = colours.ok
        ctx.beginPath()
        for (const m of stream.motes) {
          if (m.fails) continue
          const [x, y] = pointAt(path, m.s)
          if (hidden(behind, x, y, radius)) continue
          ctx.moveTo(x + radius, y)
          ctx.arc(x, y, radius, 0, Math.PI * 2)
        }
        ctx.fill()
        ctx.fillStyle = colours.bad
        for (const m of stream.motes) {
          if (!m.fails) continue
          const [x, y] = pointAt(path, m.s)
          if (hidden(behind, x, y, radius)) continue
          ctx.globalAlpha = visibility(m)
          ctx.beginPath()
          ctx.arc(x, y, radius, 0, Math.PI * 2)
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
