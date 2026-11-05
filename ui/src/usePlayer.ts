import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PlayerClock, SPEEDS } from './clock.ts'
import type { Speed } from './clock.ts'

/** How far a nudge moves a paused step, in ms of player time. */
const NUDGE = 100
import type { Flow } from '../../src/core/model.ts'
import type { Stop } from '../../src/core/structure.ts'
import { DWELL, GAP } from './motion.ts'
import { readPref, writePref } from './store.ts'
import type { Spot } from './trail.ts'

/** The step (and replay) on show, as the player's clock and the step's motions know it: a new key is a new step to play. */
export const stepKeyOf = (flow: string, stop: number, replays: number): string => `${flow}:${stop}:${replays}`

/** A step key without its stop: the same for every stop of a flow until it is replayed or another flow plays. */
export const runKeyOf = (stepKey: string): string => {
  const replays = stepKey.lastIndexOf(':')
  return `${stepKey.slice(0, stepKey.lastIndexOf(':', replays - 1))}${stepKey.slice(replays)}`
}

/** The speed kept from last time, or normal speed. */
const savedSpeed = (): Speed => SPEEDS.find(s => String(s) === readPref('flowy.speed')) ?? 1

/** The flow playing and where it is: `step` is a stop (see structure.ts), `trail` the flows left behind to come back to. */
export type Play = { flow: string; step: number; trail?: Spot[] }

/**
 * Which flow is playing, and the small settings of the player: R counts up and a new count plays the step again; whether a step that moves plays again after a rest (kept
 * across visits); whether a finished step goes on to the next one (Autoplay, kept across visits too, except in a pane of a comparison, which opens with it off); the step
 * (and replay) whose motion has finished; and the player's clock (see clock.ts), with whether it is paused.
 */
export function usePlayer({ initialFlow, initialStep = 0, pane = false }: { initialFlow: () => string | undefined; initialStep?: number; pane?: boolean }) {
  const [playing, setPlaying] = useState<Play | undefined>(() => {
    const flow = initialFlow()
    return flow === undefined ? undefined : { flow, step: initialStep }
  })
  const [replays, setReplays] = useState(0)
  const [repeat, setRepeat] = useState(() => readPref('flowy.repeat') !== 'off') // whether a step that moves plays again after a rest
  const toggleRepeat = () => {
    setRepeat(!repeat)
    writePref('flowy.repeat', repeat ? 'off' : 'on') // storage blocked: the choice lasts until the page closes
  }
  const [autoplay, setAutoplay] = useState(() => !pane && readPref('flowy.autoplay') === 'on')
  const toggleAutoplay = () => {
    setAutoplay(!autoplay)
    if (!pane) writePref('flowy.autoplay', autoplay ? 'off' : 'on') // storage blocked: the choice lasts until the page closes
  }
  const [settledKey, setSettledKey] = useState('')
  const replay = () => setReplays(n => n + 1)
  const [clock] = useState(() => {
    const made = new PlayerClock()
    made.setRate(savedSpeed())
    return made
  })
  const paused = useSyncExternalStore(fn => clock.subscribe(fn), () => clock.paused)
  const speed = useSyncExternalStore(fn => clock.subscribe(fn), () => clock.rate)
  const setSpeed = (s: Speed) => {
    clock.setRate(s)
    writePref('flowy.speed', String(s)) // storage blocked: the speed lasts until the page closes
  }
  return { playing, setPlaying, replays, replay, repeat, toggleRepeat, autoplay, setAutoplay, toggleAutoplay, settledKey, setSettledKey, clock, paused, speed, setSpeed }
}

/**
 * Stepping through the flow that plays, and Play and Pause. The reader works out what is on screen (`flow`, its `stops`, the `stopIndex`, whether a step is `moving`, how
 * many `motions` it has) and this keeps time on the player's `clock`: a stop settles when every motion in it has finished, not the first. Play and Pause are the clock and
 * nothing else: Pause stops it where it is, so a step's motion and the waits stand still, and it stays paused through Back and Next. Autoplay only takes away the stop between
 * steps: a step that doesn't move waits a moment, then each finished step is followed by the next, while the clock runs.
 */
export function usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions, settledKey, setSettledKey, clock, paused, replays, replay, repeat, autoplay }: {
  playing: Play | undefined; setPlaying: (p: Play | undefined) => void; flow: Flow | undefined; stops: Stop[]; stopIndex: number; stepKey: string; moving: boolean; motions: number
  settledKey: string; setSettledKey: (key: string) => void; clock: PlayerClock; paused: boolean; replays: number; replay: () => void; repeat: boolean; autoplay: boolean
}) {
  const finishedSteps = useRef(new Set<number>())
  useEffect(() => {
    finishedSteps.current = new Set()
  }, [stepKey])
  /** One motion of the stop is over. */
  const finished = (i: number) => {
    finishedSteps.current.add(i)
    if (finishedSteps.current.size >= motions) setSettledKey(stepKey)
  }
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, stops.length - 1)) })
  /** Nothing is left to run: a step that has played out and rests on its end, or with Autoplay the last step. */
  const atEnd = () => settledKey === stepKey && clock.elapsed() >= clock.length && (autoplay ? stopIndex === stops.length - 1 : moving && !repeat)
  /** Whether the button says Pause: the clock runs and there is something for it to run. */
  const showsPause = !paused && !atEnd()
  const [, redraw] = useState(0)
  /** The clock runs again. A step dragged back into its motion has the rest of it to play: the button says Play again when that is over. */
  const resume = () => {
    clock.play()
    const left = clock.length - clock.elapsed()
    if (left > 0 && settledKey === stepKey) clock.after(left, () => redraw(n => n + 1))
  }
  const togglePlay = () => {
    if (!playing || !flow) return
    if (showsPause) {
      clock.pause()
      return
    }
    const over = atEnd()
    resume()
    if (!over) return
    // Run out, Play goes round again: the step on its own, or with Autoplay the flow from its first step.
    if (autoplay && stopIndex > 0) setPlaying({ ...playing, step: 0 })
    else replay()
  }
  // Dragging the bar: it holds the player while the pointer is down and goes to the step and the moment under it; letting go carries on if it was playing.
  const wasOn = useRef<boolean | undefined>(undefined)
  const scrub = {
    start: () => {
      wasOn.current = showsPause
      clock.pause()
    },
    to: (stop: number, fraction: number) => {
      if (!playing || !flow) return
      const at = Math.max(0, Math.min(stop, stops.length - 1))
      if (at !== stopIndex) stepTo(at)
      clock.seekFraction(fraction, stepKeyOf(playing.flow, at, replays))
    },
    end: () => {
      if (wasOn.current) resume()
      wasOn.current = undefined
    },
  }
  /** A moment back or on (100 ms of player time), while paused. */
  const nudge = (by: -1 | 1) => {
    if (paused) clock.seek(clock.elapsed() + by * NUDGE)
  }
  // No flow ('') is a step of its own too, so the same step opened again starts from its first moment.
  useEffect(() => clock.begin(stepKey), [stepKey])
  // Another flow, or none: the player starts running again, so a flow is never opened frozen.
  useEffect(() => {
    clock.play()
  }, [playing?.flow])
  useEffect(() => {
    if (!autoplay || !flow || moving) return
    return clock.after(DWELL, () => setSettledKey(stepKey))
  }, [autoplay, flow === undefined, moving, stepKey])
  useEffect(() => {
    if (!autoplay || !playing || !flow || settledKey !== stepKey || stopIndex === stops.length - 1) return
    // A stop dragged (or nudged) back into its motion first plays the rest of it.
    return clock.after(GAP + Math.max(0, clock.length - clock.elapsed()), () => setPlaying({ ...playing, step: stopIndex + 1 }))
  }, [autoplay, flow === undefined, settledKey, stepKey])
  return { finished, stepTo, togglePlay, showsPause, nudge, scrub }
}
