import { useEffect, useRef, useState } from 'react'
import { easedSpread, spreadProgress } from '../../src/core/lanes.ts'

/**
 * How far a pair of lines side by side is spread on screen right now (the `s` of its pose, see src/core/lanes.ts). The page says where the pair is going (`goal`: true while it is
 * selected or focused, see focusEdges) and this eases there over SPREAD_MS, the same going out as coming back, so the lanes do not jump from under the pointer. Under reduced motion
 * it snaps. A line that mounts already spread starts there, so opening a view animates nothing.
 *
 * Every line of a pair asks for itself and they start in the same commit, so they move together. The value is cut to 32 steps, which is what the lane store keeps a path for, so an
 * ease is a handful of paths made once and not one for each frame.
 */
export function useEasedSpread(goal: boolean): number {
  const target = goal ? 1 : 0
  const progress = useRef(target)
  const [shown, setShown] = useState(target)
  useEffect(() => {
    if (progress.current === target) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      progress.current = target
      setShown(target)
      return
    }
    let last = performance.now()
    let frame = 0
    const tick = (now: number) => {
      progress.current = spreadProgress(progress.current, target, now - last)
      last = now
      setShown(Math.round(easedSpread(progress.current) * STEPS) / STEPS)
      if (progress.current !== target) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])
  return shown
}

const STEPS = 32
