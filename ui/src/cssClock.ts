import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { PlayerClock } from './clock.ts'

/** The canvas's own animations when the view changes (style.css): they belong to the camera, not to the flow, and never wait for the player. */
const VIEW_CHANGES = new Set(['leave-in', 'arrive-in', 'leave-out', 'arrive-out', 'leave-across', 'arrive-across', 'fade-in'])

const flowAnimations = (root: HTMLElement): CSSAnimation[] =>
  root.getAnimations({ subtree: true }).filter((a): a is CSSAnimation => a instanceof CSSAnimation && !VIEW_CHANGES.has(a.animationName))

const finite = (a: Animation) => Number.isFinite(a.effect?.getTiming().iterations ?? 1)

/**
 * Makes the flow's CSS animations under `root` keep the player's time, as the step motion does: a channel opening or closing, the dots of a stream, a clock turning,
 * a state's outline. Paused, they stand still; at another speed they run at it; and a seek sets the ones the stop on show began (its channel coming in, say) to the
 * clock's moment. Animations that began at an earlier stop are only paused and played, so a channel that has opened never comes in again. Off (`on` false), it
 * leaves them all alone: the reader's canvas holds the panes of a comparison, which keep their own time.
 */
export function useCssClock(root: RefObject<HTMLElement | null>, clock: PlayerClock, stepKey: string, on = true): void {
  const seen = useRef(new WeakSet<Animation>())
  const ours = useRef(new WeakSet<Animation>()) // what the stop on show began
  const apply = (seek: boolean) => {
    const el = root.current
    if (!el || !on) return
    const at = clock.elapsed()
    for (const a of flowAnimations(el)) {
      seen.current.add(a)
      if (a.playbackRate !== clock.rate) a.updatePlaybackRate(clock.rate)
      if (seek && ours.current.has(a) && finite(a)) a.currentTime = at
      if (clock.paused) {
        if (a.playState === 'running') a.pause()
      } else if (a.playState === 'paused') a.play() // a finished one stays finished: play() would start it over
    }
  }
  // A new stop: what is running now and wasn't before, it began.
  useLayoutEffect(() => {
    const el = root.current
    if (!el || !on) return
    ours.current = new WeakSet()
    for (const a of flowAnimations(el)) if (!seen.current.has(a)) ours.current.add(a)
    apply(false)
  }, [stepKey])
  useEffect(() => {
    const el = root.current
    if (!on) return
    // A seek or a restart moves time; a pause, a play or a speed don't, so those leave each animation's place alone.
    let jumps = clock.jumps
    const heard = clock.subscribe(() => {
      apply(clock.jumps !== jumps)
      jumps = clock.jumps
    })
    // An animation that starts while paused (a state that changes on a step taken while paused) is held at once.
    const started = (e: AnimationEvent) => {
      if (clock.paused && !VIEW_CHANGES.has(e.animationName)) apply(false)
    }
    el?.addEventListener('animationstart', started, true)
    return () => {
      heard()
      el?.removeEventListener('animationstart', started, true)
    }
  }, [clock, on])
}
