import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { Flow, Model, Step } from '../../src/core/model.ts'
import { animationOf, beatsFor, followsLanding } from '../../src/core/animation.ts'
import { dotPayload, motionOf } from '../../src/core/payloads.ts'
import { channelsAt, kindsOf } from '../../src/core/channels.ts'
import { captionOf, progressOf } from '../../src/core/captions.ts'
import { marksOf, statesAt } from '../../src/core/states.ts'
import type { StateMark } from '../../src/core/states.ts'
import { otherLaneSteps, stopsOf } from '../../src/core/structure.ts'
import { slotsOf } from '../../src/core/lanes.ts'
import { pairMode } from '../../src/core/model.ts'
import { strandOf } from '../../src/core/strands.ts'
import { computeView, placeStep } from '../../src/core/views.ts'
import type { Playing } from './graph.ts'
import type { Recording } from './Recorder.tsx'
import type { OpenChannel } from './Channels.tsx'
import { takenBy } from './StepMotion.tsx'
import type { PlayerClock } from './clock.ts'
import { createPartStore, NO_PLANS, planOf } from './parts.ts'
import type { PartPlan } from './parts.ts'
import { stepKeyOf } from './usePlayer.ts'
import type { Play } from './usePlayer.ts'

export const NO_MARKS: Record<string, StateMark> = {} // the same object every time, so a flow with no states never rebuilds the graph for them

/**
 * What is on screen for the flow that plays on one canvas: its stops, the stop shown, the states at it, the `Playing` the graph is built from, the steps that move and
 * the caption. `flow` is undefined when no flow plays on this canvas (while editing, or while Performance or Failures is open); `recording` is the flow being
 * recorded in edit mode, whose steps so far are drawn the same way. `clock` is the player's: the lines of a pair that a step rides open away from it by the clock's time
 * (`parts`, see parts.ts), so the canvas provides that store to its lines.
 */
export function useFlowStage({ model, view, flow, playing, replays, recording, clock }: {
  model: Model; view: string; flow: Flow | undefined; playing: Play | undefined; replays: number; recording?: Recording; clock: PlayerClock
}) {
  // The player moves through stops, not steps: a stop is what is on screen at once (see structure.ts). `playing.step` is a stop.
  const stops = useMemo(() => (flow ? stopsOf(flow) : []), [flow])
  const stopIndex = flow && playing ? Math.max(0, Math.min(playing.step, stops.length - 1)) : 0
  const stop = flow ? stops[stopIndex] : undefined
  // Where shapes stand at this stop: the flow's start and each step's changes up to it (nothing is stored, so stepping back needs no undo).
  const flowMarks = useMemo(() => (flow && stop ? marksOf(model, statesAt(flow, stops, stopIndex)) : NO_MARKS), [model, flow, stop, stops, stopIndex])

  // Where a project draws a line for each connection, the view's lines (strands) and their places among the lines of their pairs: a step rides one of them.
  const laid = useMemo(() => (pairMode(model) === 'separate' ? computeView(model, view) : undefined), [model, view])
  const slots = useMemo(() => (laid?.strands === undefined ? undefined : slotsOf(laid.strands)), [laid])

  // A drag re-renders on every mouse move, and dagre takes tens of ms on a big view, so the graph is
  // rebuilt only when what it is built from changes. `flow`, `recording` and `model` keep their identity between renders.
  const shown = useMemo<Playing | undefined>(() => {
    const placeSteps = (steps: Step[]) => steps.map(s => placeStep(model, view, s))
    if (flow && stops[stopIndex]) {
      // A shape that takes a request off the line (`by`) is lit with the step, so it does not sit at the faint level while it flashes.
      const also = stops[stopIndex].steps.flatMap(i => {
        const taker = animationOf(flow.steps[i])?.by
        const at = taker && 'shape' in taker ? placeStep(model, view, { from: taker.shape }) : null
        return at ? [at[0]] : []
      })
      const ends = placeSteps(flow.steps)
      const strands = laid === undefined ? undefined : ends.map((placed, i) => (placed ? strandOf(model, laid, flow.steps[i], placed)?.id : undefined))
      return { ends, steps: stops[stopIndex].steps, faint: otherLaneSteps(stops, stopIndex), ...(also.length > 0 ? { also } : {}), ...(strands === undefined ? {} : { strands }) }
    }
    if (!recording) return undefined
    const done = placeSteps(Object.hasOwn(model.flows, recording.id) ? model.flows[recording.id].steps : [])
    if (!recording.from || !recording.to) return { ends: done }
    const next: Step = { from: recording.from, text: '', ...(recording.to === recording.from ? {} : { to: recording.to }), ...(recording.via ? { via: recording.via } : {}) }
    const ends = [...done, placeStep(model, view, next)]
    // Where each connection is a line of its own, the lines the steps so far ride, and the one the click on a line picked for the step being recorded.
    const steps = [...(Object.hasOwn(model.flows, recording.id) ? model.flows[recording.id].steps : []), next]
    const strands = laid === undefined ? undefined : ends.map((placed, i) => (placed ? strandOf(model, laid, steps[i], placed)?.id : undefined))
    return { ends, step: done.length, ...(strands === undefined ? {} : { strands }) }
  }, [model, view, laid, flow, stops, stopIndex, recording])
  const stepKey = flow && playing ? stepKeyOf(playing.flow, stopIndex, replays) : ''
  const strandsById = useMemo(() => (laid?.strands === undefined ? undefined : new Map(laid.strands.map(s => [s.id, s]))), [laid])
  // Where a step rides one line of a pair of several, the others part around it (see parts.ts): for each such pair, which of its lines the stop lights, and when the earliest
  // `part` beat of the stop's steps on it starts (a step with no motion parts at once).
  const plans = useMemo<ReadonlyMap<string, PartPlan>>(() => {
    if (!flow || !stop || laid?.strands === undefined || shown?.strands === undefined) return NO_PLANS
    return planOf(laid.strands, stop.steps.map(i => {
      const id = shown.strands![i]
      const placed = shown.ends[i]
      const animation = motionOf(model, flow.steps[i])
      const lanes = id === undefined ? undefined : strandsById?.get(id)?.lanes
      return { strand: id, ...(animation && placed && lanes !== undefined ? { beats: beatsFor(animation, { length: 0, afterLanding: stop.before.some(j => followsLanding(shown.ends[j], placed)), lanes }).beats } : {}) }
    }))
  }, [model, flow, stop, laid, shown, strandsById])
  // The store the lines of this canvas read their parting from, and a new plan for it at every stop. The clock begins the stop first (the step's motions and the player say it too,
  // and the same key again does nothing), so the plan starts from the stop's first moment. Another flow, or a stop other than the next or the one before, is a jump.
  const parts = useMemo(() => createPartStore(clock), [clock])
  useEffect(() => parts.attach(), [parts]) // hears the clock only while mounted; an effect run again after a cleanup (StrictMode) attaches it again
  const last = useRef<{ flow: string; stop: number }>(undefined)
  const planned = JSON.stringify([...plans])
  useLayoutEffect(() => {
    const before = last.current
    const jump = before !== undefined && playing !== undefined && (before.flow !== playing.flow || Math.abs(before.stop - stopIndex) > 1)
    parts.set(stepKey, plans, { jump, still: matchMedia('(prefers-reduced-motion: reduce)').matches })
    last.current = stepKey === '' || playing === undefined ? undefined : { flow: playing.flow, stop: stopIndex }
  }, [parts, stepKey, planned])
  // Every step of the stop that moves, with where it lands in this view. A step the view can't show doesn't move. Its dots say what its payloads are called.
  const animated = flow && stop ? stop.steps.flatMap(i => {
    const a = motionOf(model, flow.steps[i])
    const p = shown?.ends[i]
    // What its dots carry: the reply on the answer's way back, the payload on every other dot (see DotCard).
    const lane = shown?.strands?.[i]
    const slot = lane === undefined ? undefined : slots?.get(lane)
    const pair = lane === undefined ? undefined : strandsById?.get(lane)?.pair
    const strand = lane !== undefined && slot !== undefined ? { id: lane, slot, ...(pair === undefined ? {} : { pair }), ...(pair !== undefined && plans.get(pair) !== undefined ? { lit: plans.get(pair)!.lit } : {}) } : undefined
    return a && p ? [{ i, animation: a, placed: p, by: takenBy(model, view, a, p), strand, sends: dotPayload(model, flow.steps[i]), reply: dotPayload(model, flow.steps[i], 'reply') }] : []
  }) : []
  const moving = animated.length > 0
  // What the flow has left open by this stop, with where it lands in this view. A stream and a listener need two boxes of the view; a job needs only the one it runs on.
  const channels = useMemo(() => (flow && stop ? channelsAt(flow, stops, stopIndex) : []), [flow, stop, stops, stopIndex])
  const open = flow && stop ? channels.flatMap<OpenChannel>(channel => {
    const placed = placeStep(model, view, { from: channel.from, to: channel.to })
    if (!placed || (channel.kind !== 'job' && placed[0] === placed[1])) return []
    // The step whose motion decides when it appears or goes: the one that opens it, or the one in this stop that closes it.
    const by = channel.opening ? channel.step : stop.steps.find(i => animationOf(flow.steps[i])?.closes === channel.name)
    const motion = by === undefined ? undefined : animationOf(flow.steps[by])
    // Where each connection is a line of its own, a stream and a listener belong to the line of the step that opened them.
    const lane = shown?.strands?.[channel.step]
    const ref = lane === undefined ? undefined : strandsById?.get(lane)
    const slot = lane === undefined ? undefined : slots?.get(lane)
    return [{ channel, placed, ...(motion === undefined ? {} : { motion }), ...(lane !== undefined && slot !== undefined && ref !== undefined ? { strand: { id: lane, slot, pair: ref.pair } } : {}) }]
  }) : []
  const channelKinds = kindsOf(open.map(o => o.channel))
  const caption = flow && stop ? captionOf(flow, stop) : undefined
  const progress = useMemo(() => (flow ? progressOf(flow, stops) : undefined), [flow, stops])
  const marks = flow && stop && caption ? stop.steps.flatMap((i, n) => {
    const p = shown?.ends[i]
    return p && stop.kind && caption.marks[n] !== '' ? [{ ends: p, text: caption.marks[n], kind: stop.kind }] : []
  }) : []
  return { stops, stopIndex, stop, flowMarks, shown, animated, moving, stepKey, caption, progress, marks, open, channelKinds, parts }
}
