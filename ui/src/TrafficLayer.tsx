import { useEffect, useMemo, useRef } from 'react'
import { useStore, useStoreApi } from '@xyflow/react'
import type { LineTraffic } from '../../src/core/perf/types.ts'
import { colorPair } from '../../src/core/look.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { depthIn } from './graph.ts'
import type { BoxData, Outline, Rect } from './graph.ts'
import { outline, pathBetween, rect } from './Line.tsx'
import { extend, flatten, pointAt } from './pathpoints.ts'
import { advance, cutBy, ghost, howBehind, moteLook, newStream, visibility } from './traffic.ts'
import type { Stream } from './traffic.ts'

/** A shape a line runs behind: where it is and its outline. */
type Shape = { rect: Rect; edge: Outline }

/** How far a particle runs on into a shape that opens, and starts out inside one, so it is wholly hidden before it is gone (in the diagram's units, whatever the zoom). */
const REACH = 48

/**
 * A line's way for the layer: the path that runs on into the shapes at its ends that open, the same without the run into its end (a rejected call stops at the
 * bar there), the shapes at its start and end that open, and the shapes it runs behind.
 */
type Way = { path: ReturnType<typeof flatten>; bounce: ReturnType<typeof flatten>; from?: Shape; to?: Shape; shapes: Shape[] }

/** Cuts the drawing to what is outside `s`: a particle that goes into a shape that opens is not seen on it. Undo it with `ctx.restore()`. */
const outside = (ctx: CanvasRenderingContext2D, s: Shape): void => {
  ctx.save()
  ctx.beginPath()
  ctx.rect(-1e6, -1e6, 2e6, 2e6)
  if (s.edge.length === 0) ctx.rect(s.rect.x, s.rect.y, s.rect.width, s.rect.height)
  else s.edge.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(s.rect.x + x, s.rect.y + y) : ctx.lineTo(s.rect.x + x, s.rect.y + y)))
  ctx.clip('evenodd')
}

/**
 * Cuts the drawing to what is outside all of `shapes` and `labels`, so a line's stripes are not seen over a shape it runs behind or into, or over a label on it. Undo it with `ctx.restore()`.
 * (A particle fades as it goes behind something; stripes simply stop at its edge.)
 */
const outsideAll = (ctx: CanvasRenderingContext2D, shapes: Shape[], labels: Rect[]): void => {
  ctx.save()
  ctx.beginPath()
  ctx.rect(-1e6, -1e6, 2e6, 2e6)
  for (const s of shapes) {
    if (s.edge.length === 0) ctx.rect(s.rect.x, s.rect.y, s.rect.width, s.rect.height)
    else {
      s.edge.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(s.rect.x + x, s.rect.y + y) : ctx.lineTo(s.rect.x + x, s.rect.y + y)))
      ctx.closePath()
    }
  }
  for (const l of labels) ctx.rect(l.x, l.y, l.width, l.height)
  ctx.clip('evenodd')
}

/**
 * The dashes of stripes at a level of busyness (0 to 1): how long, how far apart, and how fast they move along the line, in the diagram's units (and a second), so they grow and shrink with the line and its
 * arrowhead as the diagram is zoomed. Busier is closer together and a good deal quicker: a quiet line crawls and the busiest runs.
 */
const stripePace = (busy: number): { dash: number; gap: number; speed: number } => ({ dash: 8, gap: 26 - 18 * busy, speed: 14 + 110 * busy })

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
 * flow reads through what covers it. A line that ends at a shape that opens runs on into it, and one that starts at such a shape comes out of it, but a particle is only drawn
 * outside the shape (cut by its outline), so the flow goes in and out of it and is never seen on it. A run's source sets the particles' colour and size (a line's `color` and `radius`), and a line that
 * says how its failing share fails draws a lost call as a ring where it pops and a rejected one as a call that stops at a bar at the end
 * of the line and comes back in the danger tone. A line that several sources share has a stream for each (a line's `source`), drawn in that
 * source's colour and running a little to its side of the path (its `offset`). A line with none of these draws in a loop of its own that
 * makes no object for a particle that doesn't fail. Reduced motion draws none: the caller leaves this out. `fade` is for the swap of two runs, which lays two layers over each other
 * for a moment: the one for the run coming on fades in, the one for the run going off fades out.
 */
export function TrafficLayer({ lines, style, fade }: { lines: LineTraffic[]; style: LineStyle; fade?: 'in' | 'out' }) {
  const store = useStoreApi()
  // Where every shape is and how big it is, as text: it changes exactly when a line's path would, and only then does the layer draw itself again.
  const where = useStore(s => [...s.nodeLookup.values()].map(n => `${n.id} ${n.internals.positionAbsolute.x} ${n.internals.positionAbsolute.y} ${n.measured.width} ${n.measured.height}`).join(','))
  const canvas = useRef<HTMLCanvasElement>(null)
  // Which lines there are and how each ends, as text: a polyline depends on nothing else about a line, so a change of load (new numbers on the same lines) does not make them again.
  const ways = lines.map(l => `${l.from} ${l.to} ${l.failure ?? ''}`).join(',')
  // One polyline per line, made again when a shape moves or the style of lines changes, with the shapes it runs behind: every shape but its own two ends.
  const paths = useMemo(
    () => {
      const boxes = store.getState().nodeLookup
      const shapes = [...boxes.values()].filter(n => n.type === 'box').map(n => ({ id: n.id, rect: rect(n), edge: outline(n) }))
      // The sources that share a line are entries of one path: it is flattened once, however many there are.
      const made = new Map<string, Way | undefined>()
      const opens = (n: { type?: string; data: unknown }) => n.type === 'box' && (n.data as BoxData).inside > 0
      return lines.map(l => {
        const key = `${l.from} ${l.to}`
        if (!made.has(key)) {
          const a = boxes.get(l.from)
          const b = boxes.get(l.to)
          if (a && b) {
            const path = flatten(pathBetween(style, a, b))
            const [before, after] = [opens(a) ? REACH : 0, opens(b) ? REACH : 0]
            made.set(key, {
              path: extend(path, before, after),
              bounce: extend(path, before, 0),
              from: opens(a) ? shapes.find(s => s.id === l.from) : undefined,
              to: opens(b) ? shapes.find(s => s.id === l.to) : undefined,
              shapes: shapes.filter(s => s.id !== l.from && s.id !== l.to),
            })
          } else made.set(key, undefined)
        }
        return made.get(key)
      })
    },
    // `ways` stands for the parts of `lines` that are read
    [ways, where, style, store],
  )
  const now = useRef({ lines, paths })
  now.current = { lines, paths }
  const streams = useRef(new Map<string, Stream>())
  const stripeAt = useRef(new Map<string, number>()) // how far each line's stripes have moved, in pixels

  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext('2d')!
    let frame = 0
    let last = performance.now()
    let colours = { ok: '#2563eb', bad: '#b91c1c', ink: '#888888' }
    let dark = false
    const tints = new Map<string, string>() // a source's colour for the theme the page is in now, by the name or hex it was written with
    let colourAt = 0
    // A colour that is dark in the light theme and light in the dark one, to tell which the page is in: light-dark() follows the page's colour scheme.
    el.style.color = 'light-dark(#000000, #ffffff)'
    /** The colour of a line's particles: its source's when it has one (a named colour for the theme, a hex as it is), else the accent. */
    const tint = (color: string | undefined): string => {
      if (color === undefined) return colours.ok
      let found = tints.get(color)
      if (found === undefined) {
        const pair = colorPair(color)
        found = pair ? pair[dark ? 1 : 0] : colours.ok
        tints.set(color, found)
      }
      return found
    }
    const draw = (t: number) => {
      const ms = Math.min(100, t - last) // a tab that was asleep doesn't pour out everything it missed
      last = t
      if (t - colourAt > 500) {
        const css = getComputedStyle(el)
        colours = { ok: css.getPropertyValue('--accent').trim() || colours.ok, bad: css.getPropertyValue('--danger').trim() || colours.bad, ink: css.getPropertyValue('--fg').trim() || colours.ink }
        dark = Number(/\d+/.exec(css.color)?.[0] ?? 0) > 127
        tints.clear()
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
        const way = paths[i]!
        // A rejected call stops at the bar at the end of the line, so it doesn't run on into the shape there.
        const path = line.failure === 'rejected' ? way.bounce : way.path
        const { shapes } = way
        const opening = [way.from, line.failure === 'rejected' ? undefined : way.to].filter(s => s !== undefined)
        // One stream for each source on a line (a run with one source has none to name).
        const key = line.source === undefined ? `${line.from} ${line.to}` : `${line.from} ${line.to} ${line.source}`
        alive.add(key)
        if (line.stripes !== undefined && line.stripes > 0) {
          // The calls: stripes moving along the line itself, closer and quicker the more calls there are, with every few of them red for the share of calls that fail.
          const pace = stripePace(line.stripes)
          const moved = (stripeAt.current.get(key) ?? 0) + (pace.speed * ms) / 1000
          stripeAt.current.set(key, moved)
          const apart = pace.dash + pace.gap
          const asideLine = (line.offset ?? 0) * 3
          outsideAll(ctx, [...opening, ...shapes], labels) // saves the state: restored below
          ctx.beginPath()
          path.xs.forEach((x, k) => {
            let [nx, ny] = [0, 0]
            if (asideLine !== 0) {
              const [bx, by] = [path.xs[Math.min(k + 1, path.xs.length - 1)] - path.xs[Math.max(k - 1, 0)], path.ys[Math.min(k + 1, path.ys.length - 1)] - path.ys[Math.max(k - 1, 0)]]
              const length = Math.hypot(bx, by) || 1
              ;[nx, ny] = [(-by / length) * asideLine, (bx / length) * asideLine]
            }
            if (k === 0) ctx.moveTo(x + nx, path.ys[k] + ny)
            else ctx.lineTo(x + nx, path.ys[k] + ny)
          })
          ctx.lineCap = 'round'
          ctx.lineWidth = Math.max(2.4, line.width + 0.9) // a little thicker than the line it runs on, and growing with it, so the two read as one arrow at any zoom
          ctx.globalAlpha = line.bare ? 0.6 : 0.95
          ctx.strokeStyle = line.bare ? colours.ink : tint(line.color) // a line with no numbers has plain light stripes
          ctx.setLineDash([pace.dash, pace.gap])
          ctx.lineDashOffset = -moved
          ctx.stroke()
          if (line.failed > 0) {
            // Every nth stripe is red, n being how many calls there are to one that fails.
            const every = Math.max(1, Math.round(1 / line.failed))
            ctx.strokeStyle = colours.bad
            ctx.setLineDash([pace.dash, apart * every - pace.dash])
            ctx.stroke()
          }
          ctx.setLineDash([])
          ctx.restore()
        }
        let stream = streams.current.get(key)
        if (!stream) streams.current.set(key, (stream = newStream()))
        advance(stream, line, ms, Math.random)
        const radius = ((2.2 + line.width / 2) * (line.radius ?? 1)) / zoom // a few pixels on screen, whatever the zoom, and bigger or smaller where the run's size says
        const ramp = radius * 2 // how far either side of an outline a particle takes to go from clear to well behind
        // Sources that share a line run a little apart, to either side of it, by steps of a usual dot and its room: so two on one path don't hide each other.
        const aside = (line.offset ?? 0) * ((2.2 + line.width / 2) / zoom) * 2.4
        const colour = tint(line.color)
        ctx.fillStyle = colour
        ctx.beginPath()
        const faint: [number, number, number, Shape | undefined][] = [] // the ones behind something or going into a shape that opens (the shape they are cut by), drawn after the rest one at a time
        const other: { x: number; y: number; bad: boolean; alpha: number; pop?: number; behind: number; cut?: Shape }[] = [] // the ones failing, drawn one at a time
        /** Where a particle is against the shapes it goes into or comes out of: wholly inside one (not drawn), or cut by the outline of one. */
        const against = (x: number, y: number): { gone: boolean; cut?: Shape } => {
          let cut: Shape | undefined
          for (const s of opening) {
            const how = cutBy(depthIn(s.rect, s.edge, x, y), radius)
            if (how === 'gone') return { gone: true }
            if (how === 'cut') cut = s
          }
          return { gone: false, cut }
        }
        let bar = 0 // how strongly the bar at the end of a rejected line shows: the strongest of its particles
        if (line.failure === undefined && aside === 0) {
          // The bare line: no style for its failures and none to share it with, so a particle is where it is, and one that fails fades. No object is made for a particle that doesn't fail.
          for (const m of stream.motes) {
            const [x, y] = pointAt(path, m.s)
            const here = against(x, y)
            if (here.gone) continue
            const b = behindOf(shapes, labels, x, y, ramp)
            if (m.fails !== 0) {
              other.push({ x, y, bad: true, alpha: visibility(m), behind: b, cut: here.cut })
              continue
            }
            if (b > 0 || here.cut) {
              faint.push([x, y, b, here.cut])
              continue
            }
            ctx.moveTo(x + radius, y)
            ctx.arc(x, y, radius, 0, Math.PI * 2)
          }
        } else {
          for (const m of stream.motes) {
            const look = moteLook(m, line.failure)
            let [x, y] = pointAt(path, look.at)
            if (aside !== 0) {
              // To the side of the path, by its direction a little either way along it.
              const [ax, ay] = pointAt(path, look.at - 0.02)
              const [bx, by] = pointAt(path, look.at + 0.02)
              const length = Math.hypot(bx - ax, by - ay) || 1
              x += (-(by - ay) / length) * aside
              y += ((bx - ax) / length) * aside
            }
            if (look.bar !== undefined && look.bar > bar) bar = look.bar
            const here = against(x, y)
            if (here.gone) continue
            const b = behindOf(shapes, labels, x, y, ramp)
            if (look.bad || look.alpha < 1 || look.pop !== undefined) {
              other.push({ x, y, bad: look.bad, alpha: look.alpha, pop: look.pop, behind: b, cut: here.cut })
              continue
            }
            if (b > 0 || here.cut) {
              faint.push([x, y, b, here.cut])
              continue
            }
            ctx.moveTo(x + radius, y)
            ctx.arc(x, y, radius, 0, Math.PI * 2)
          }
        }
        ctx.fill()
        for (const [x, y, b, cut] of faint) {
          const g = ghost(b)
          if (cut) outside(ctx, cut)
          ctx.globalAlpha = g.alpha
          ctx.beginPath()
          ctx.arc(x, y, radius * g.scale, 0, Math.PI * 2)
          ctx.fill()
          if (cut) ctx.restore()
        }
        for (const o of other) {
          const g = ghost(o.behind)
          if (o.cut) outside(ctx, o.cut)
          if (o.pop !== undefined) {
            // A lost call: a ring where it died, growing and fading.
            ctx.globalAlpha = (1 - o.pop) * g.alpha
            ctx.strokeStyle = colours.bad
            ctx.lineWidth = 1.6 / zoom
            ctx.beginPath()
            ctx.arc(o.x, o.y, radius * g.scale * (0.9 + 1.8 * o.pop), 0, Math.PI * 2)
            ctx.stroke()
          } else {
            ctx.fillStyle = o.bad ? colours.bad : colour
            ctx.globalAlpha = o.alpha * g.alpha
            ctx.beginPath()
            ctx.arc(o.x, o.y, radius * g.scale, 0, Math.PI * 2)
            ctx.fill()
          }
          if (o.cut) ctx.restore()
        }
        if (bar > 0) {
          // A rejected call meets a bar across the end of the line, strongest while one is at it.
          const [ex, ey] = pointAt(path, 1)
          const [px, py] = pointAt(path, 0.96)
          const length = Math.hypot(ex - px, ey - py) || 1
          const [nx, ny] = [-(ey - py) / length, (ex - px) / length]
          ctx.globalAlpha = bar
          ctx.strokeStyle = colours.bad
          ctx.lineWidth = 2.4 / zoom
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(ex + nx * radius * 2.4, ey + ny * radius * 2.4)
          ctx.lineTo(ex - nx * radius * 2.4, ey - ny * radius * 2.4)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      })
      for (const key of streams.current.keys()) if (!alive.has(key)) streams.current.delete(key) // a line the view no longer has
      for (const key of stripeAt.current.keys()) if (!alive.has(key)) stripeAt.current.delete(key)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [store])

  return <canvas ref={canvas} className={fade ? `traffic fade-${fade}` : 'traffic'} aria-hidden="true" />
}
