import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { PlayerClock } from './clock.ts'

/** How far a nudge moves a paused step, in ms of player time. */
const NUDGE = 100
import type { Flow } from '../../src/core/model.ts'
import type { Stop } from '../../src/core/structure.ts'
import { DWELL, GAP } from './motion.ts'
import { readPref, writePref } from './store.ts'
import type { Spot } from './trail.ts'

/** The flow playing and where it is: `step` is a stop (see structure.ts). `auto` is Play, `trail` the flows left behind to come back to. */
export type Play = { flow: string; step: number; auto?: boolean; trail?: Spot[] }

/**
 * Which flow is playing, and the small settings of the player: R counts up and a new count plays the step again; whether a step that moves plays again after a rest (kept
 * across visits); the step (and replay) whose motion has finished; and the player's clock (see clock.ts), with whether it is paused.
 */
export function usePlayer({ initialFlow, initialStep = 0 }: { initialFlow: () => string | undefined; initialStep?: number }) {
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
  const [settledKey, setSettledKey] = useState('')
  const replay = () => setReplays(n => n + 1)
  const [clock] = useState(() => new PlayerClock())
  const paused = useSyncExternalStore(fn => clock.subscribe(fn), () => clock.paused)
  return { playing, setPlaying, replays, replay, repeat, toggleRepeat, settledKey, setSettledKey, clock, paused }
}

/**
 * Stepping through the flow that plays, and Play and Pause. The reader works out what is on screen (`flow`, its `stops`, the `stopIndex`, whether a step is `moving`, how
 * many `motions` it has) and this keeps time on the player's `clock`: a stop settles when every motion in it has finished, not the first, and with Play on, a step that
 * doesn't move waits a moment, then each finished step is followed by the next. Pause stops the clock where it is, so a step's motion and the waits stand still. Taking a
 * step yourself plays that step and holds on its end (or on its first moment, while paused).
 */
export function usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions, settledKey, setSettledKey, clock, paused }: {
  playing: Play | undefined; setPlaying: (p: Play | undefined) => void; flow: Flow | undefined; stops: Stop[]; stopIndex: number; stepKey: string; moving: boolean; motions: number
  settledKey: string; setSettledKey: (key: string) => void; clock: PlayerClock; paused: boolean
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
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, stops.length - 1)), auto: false })
  /** Whether the button says Pause: Play is on, or the step you took is still moving. */
  const showsPause = !paused && (playing?.auto === true || (moving && settledKey !== stepKey))
  const togglePlay = () => {
    if (!playing || !flow) return
    if (showsPause) {
      clock.pause()
      setPlaying({ ...playing, auto: false })
      return
    }
    // From the last step once it is over, Play starts the flow again; anywhere else it carries on from where it stands.
    const over = stopIndex === stops.length - 1 && (!moving || settledKey === stepKey)
    clock.play()
    setPlaying({ ...playing, step: over ? 0 : stopIndex, auto: true })
  }
  /** A moment back or on (100 ms of player time), while paused. */
  const nudge = (by: -1 | 1) => {
    if (paused) clock.seek(clock.elapsed() + by * NUDGE)
  }
  useEffect(() => {
    if (stepKey !== '') clock.begin(stepKey)
  }, [stepKey])
  // Another flow, or none: the player starts running again, so a flow is never opened frozen.
  useEffect(() => {
    clock.play()
  }, [playing?.flow])
  useEffect(() => {
    if (!playing?.auto || moving) return
    return clock.after(DWELL, () => setSettledKey(stepKey))
  }, [playing?.auto, moving, stepKey])
  useEffect(() => {
    if (!playing?.auto || !flow || settledKey !== stepKey) return
    return clock.after(GAP, () => setPlaying(stopIndex < stops.length - 1 ? { ...playing, step: stopIndex + 1 } : { ...playing, auto: false }))
  }, [playing?.auto, settledKey, stepKey])
  return { finished, stepTo, togglePlay, showsPause, nudge }
}
