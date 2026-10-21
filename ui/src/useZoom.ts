import { useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Model } from '../../src/core/model.ts'
import type { Move } from './edit.ts'
import { toGraph } from './graph.ts'

const LEAVE = 220 // ms the old view takes to fly off; keep in sync with the leave-* keyframes in style.css
const ARRIVE = 320 // ms the new view takes to settle; keep in sync with the arrive-* keyframes

/**
 * A move between views, heading `to` a view. In and out zoom about (x, y) on the canvas. Across slides:
 * the old view moves away from (x, y) and the new one comes in from that side; (dx, dy) is that way, in
 * percent of the canvas.
 */
export type Motion = { dir: Move; phase: 'leave' | 'arrive'; x: number; y: number; dx: number; dy: number; to: string }

/**
 * The zoom between views: the old one flies off, then the new one settles. `go` opens a view at once and is the reader's; this runs it on a timer. Opening a view by
 * any other way calls `cancelMotion` first, so a zoom on the way does not land on top of it.
 */
export function useZoom({ canvas, model, go }: { canvas: RefObject<HTMLElement | null>; model: Model; go: (id: string) => void }) {
  const [motion, setMotion] = useState<Motion>()
  const motionTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const cancelMotion = () => {
    clearTimeout(motionTimer.current)
    setMotion(undefined)
  }
  /** Open `id` with a zoom. A second zoom on the way, or reduced motion, opens it straight away. */
  const zoomTo = (id: string, dir: Move, x: number, y: number) => {
    if (motion || matchMedia('(prefers-reduced-motion: reduce)').matches) return go(id)
    const r = canvas.current?.getBoundingClientRect()
    const [ux, uy] = [x - (r?.width ?? 0) / 2, y - (r?.height ?? 0) / 2]
    const length = Math.hypot(ux, uy) || 1 // a box dead in the middle slides nowhere and just fades
    const slide = { dx: (ux / length) * 25, dy: (uy / length) * 25 }
    // A busy view takes a while to lay out the first time. The old one is still flying off (transform and opacity run off the main
    // thread), so work the new one out now, behind that, instead of when it should arrive.
    setTimeout(() => toGraph(model, id), 30)
    setMotion({ dir, phase: 'leave', x, y, ...slide, to: id })
    motionTimer.current = setTimeout(() => {
      go(id)
      setMotion({ dir, phase: 'arrive', x, y, ...slide, to: id })
      motionTimer.current = setTimeout(() => setMotion(undefined), ARRIVE)
    }, LEAVE)
  }
  /** Zoom out to `id`, about the middle of the canvas: the box's place in the outer view isn't known until it's drawn. */
  const zoomOut = (id: string) => {
    const r = canvas.current?.getBoundingClientRect()
    zoomTo(id, 'out', (r?.width ?? 0) / 2, (r?.height ?? 0) / 2)
  }
  return { motion, cancelMotion, zoomTo, zoomOut }
}
