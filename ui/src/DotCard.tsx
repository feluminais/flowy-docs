import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOnViewportChange, useReactFlow, useStore } from '@xyflow/react'
import type { Shown } from '../../src/core/payloads.ts'
import type { PlayerClock } from './clock.ts'
import { ArrowLeft, ArrowRight } from './icons.tsx'
import { cardSpot } from './motion.ts'
import { PayloadBody } from './Payloads.tsx'
import type { DotAt } from './StepMotion.tsx'

/** A dot of the paused moment and what it carries. */
export type CarryingDot = { at: DotAt; shown: Shown; back: boolean }

type Carried = { shown: Shown; back: boolean }

/** The dots each moving step drew at the paused moment (by its index), each with what it carries: an answering dot the reply, any other the payload. Dots that carry nothing are left out. */
export function carriedBy(animated: { i: number; sends?: Carried; reply?: Carried }[], dotsBy: Record<number, DotAt[]>): CarryingDot[] {
  return animated.flatMap(m => (dotsBy[m.i] ?? []).flatMap(at => {
    const p = at.tone === 'reply' ? m.reply : m.sends
    return p ? [{ at, ...p }] : []
  }))
}

/** How far round a dot the pointer still finds it, and how long the card waits for the pointer to come back before it goes. */
const SLACK = 6
const GRACE = 200

type Box = { x: number; y: number; width: number; height: number }

/** A box of the page, in the canvas's own pixels. */
const within = (el: Element, origin: DOMRect): Box => {
  const r = el.getBoundingClientRect()
  return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height }
}

/**
 * The payload card on a paused dot: while the clock is paused, the dot under the pointer (a dot that carries a payload) shows what it carries beside
 * it, kept inside the canvas and clear of the player card and the panels. The card stays while the pointer is on it, so its code can be read, scrolled and copied.
 * It goes when the pointer has left both, and on Play, a jump, a new step, a pan or a zoom, and Esc. The pointer is followed on the canvas itself, so a wheel or
 * a drag over a dot still zooms and pans; the `.dot-hit` marks only say where each dot can be found.
 */
export function DotCard({ dots, clock, stepKey }: { dots: CarryingDot[]; clock: PlayerClock; stepKey: string }) {
  const { flowToScreenPosition } = useReactFlow()
  const wrapper = useStore(s => s.domNode)
  useStore(s => s.transform) // the dots move on screen with the camera
  const [open, setOpen] = useState<number>()
  const card = useRef<HTMLElement>(null)
  const leaving = useRef<ReturnType<typeof setTimeout>>(undefined)
  const close = () => {
    clearTimeout(leaving.current)
    setOpen(undefined)
  }
  const stay = () => clearTimeout(leaving.current)
  const leave = () => {
    clearTimeout(leaving.current)
    leaving.current = setTimeout(() => setOpen(undefined), GRACE)
  }

  useEffect(() => clock.subscribe(close), [clock])
  useEffect(close, [stepKey])
  useEffect(() => () => clearTimeout(leaving.current), [])
  useOnViewportChange({ onStart: close })
  // Esc takes the card away before anything else hears it, so the panel or the level stays as it was.
  useEffect(() => {
    if (open === undefined) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      close()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const origin = wrapper?.getBoundingClientRect()
  const onScreen = (at: DotAt): Box | undefined => {
    if (!origin) return undefined
    const a = flowToScreenPosition({ x: at.x - at.halfWidth, y: at.y - at.halfHeight })
    const b = flowToScreenPosition({ x: at.x + at.halfWidth, y: at.y + at.halfHeight })
    return { x: a.x - origin.x, y: a.y - origin.y, width: b.x - a.x, height: b.y - a.y }
  }
  const shown = open === undefined ? undefined : dots[open]
  const dotBox = shown && onScreen(shown.at)

  // The dot under the pointer opens its card; off every dot and off the card, the card goes after a moment.
  const boxes = useRef<Box[]>([])
  boxes.current = dots.flatMap(d => onScreen(d.at) ?? [])
  useEffect(() => {
    if (!wrapper) return
    const onMove = (e: PointerEvent) => {
      if (card.current?.contains(e.target as Node)) return stay() // selecting or copying its code
      if (e.buttons !== 0) return close() // a drag over the canvas: the card goes, and stays gone until the drag is over
      const frame = wrapper.getBoundingClientRect()
      const [x, y] = [e.clientX - frame.x, e.clientY - frame.y]
      const i = boxes.current.findIndex(b => x >= b.x - SLACK && x <= b.x + b.width + SLACK && y >= b.y - SLACK && y <= b.y + b.height + SLACK)
      if (i < 0) return leave()
      stay()
      setOpen(i)
    }
    const onOut = (e: PointerEvent) => {
      if (!wrapper.contains(e.relatedTarget as Node | null)) leave()
    }
    wrapper.addEventListener('pointermove', onMove)
    wrapper.addEventListener('pointerout', onOut)
    return () => {
      wrapper.removeEventListener('pointermove', onMove)
      wrapper.removeEventListener('pointerout', onOut)
    }
  }, [wrapper])

  // Placed once it is drawn and its size is known.
  useLayoutEffect(() => {
    const el = card.current
    if (!el || !wrapper || !dotBox) return
    const frame = wrapper.getBoundingClientRect()
    const avoid = [...document.querySelectorAll('.player, .panel')].map(e => within(e, frame)).filter(b => b.width > 0 && b.height > 0)
    const spot = cardSpot(dotBox, { width: el.offsetWidth, height: el.offsetHeight }, { x: 0, y: 0, width: frame.width, height: frame.height }, avoid)
    el.style.left = `${spot.x}px`
    el.style.top = `${spot.y}px`
    el.style.visibility = 'visible'
  })

  if (!origin) return null
  const Arrow = shown?.back ? ArrowLeft : ArrowRight
  return (
    <>
      {dots.map((d, i) => {
        const box = onScreen(d.at)!
        return (
          <div key={i} className="dot-hit" aria-hidden="true" style={{ left: box.x - SLACK, top: box.y - SLACK, width: box.width + 2 * SLACK, height: box.height + 2 * SLACK }} />
        )
      })}
      {shown && (
        // A card of its own for each dot, measured where nothing has placed it yet and starting at its top.
        <aside key={open} ref={card} className="dot-card" aria-label={shown.shown.name} style={{ visibility: 'hidden' }}>
          <h3><span className="dirn" aria-hidden="true"><Arrow size={14} /></span>{shown.shown.name}{shown.back && <span className="visually-hidden">, comes back</span>}</h3>
          <PayloadBody shown={shown.shown} />
        </aside>
      )}
    </>
  )
}
