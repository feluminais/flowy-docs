import { useEffect, useRef, useState } from 'react'
import type { Flow } from '../../src/core/model.ts'
import type { Stop } from '../../src/core/structure.ts'
import { DWELL, GAP } from './motion.ts'
import { readPref, writePref } from './store.ts'
import type { Spot } from './trail.ts'

/** The flow playing and where it is: `step` is a stop (see structure.ts). `auto` is Play, `trail` the flows left behind to come back to. */
export type Play = { flow: string; step: number; auto?: boolean; trail?: Spot[] }

/**
 * Which flow is playing, and the small settings of the player: R counts up and a new count plays the step again; whether a step that moves plays again after a rest (kept
 * across visits); the step (and replay) whose motion has finished.
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
  return { playing, setPlaying, replays, replay, repeat, toggleRepeat, settledKey, setSettledKey }
}

/**
 * Stepping through the flow that plays, and Play. The reader works out what is on screen (`flow`, its `stops`, the `stopIndex`, whether a step is `moving`, how many
 * `motions` it has) and this keeps time: a stop settles when every motion in it has finished, not the first, and with Play on, a step that doesn't move waits a moment,
 * then each finished step is followed by the next. Taking a step yourself stops it.
 */
export function usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions, settledKey, setSettledKey }: {
  playing: Play | undefined; setPlaying: (p: Play | undefined) => void; flow: Flow | undefined; stops: Stop[]; stopIndex: number; stepKey: string; moving: boolean; motions: number
  settledKey: string; setSettledKey: (key: string) => void
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
  const togglePlay = () => {
    if (!playing || !flow) return
    const atEnd = stopIndex === stops.length - 1
    setPlaying(playing.auto ? { ...playing, auto: false } : { ...playing, step: atEnd ? 0 : stopIndex, auto: true })
  }
  useEffect(() => {
    if (!playing?.auto || moving) return
    const wait = setTimeout(() => setSettledKey(stepKey), DWELL)
    return () => clearTimeout(wait)
  }, [playing?.auto, moving, stepKey])
  useEffect(() => {
    if (!playing?.auto || !flow || settledKey !== stepKey) return
    const wait = setTimeout(() => setPlaying(stopIndex < stops.length - 1 ? { ...playing, step: stopIndex + 1 } : { ...playing, auto: false }), GAP)
    return () => clearTimeout(wait)
  }, [playing?.auto, settledKey, stepKey])
  return { finished, stepTo, togglePlay }
}
