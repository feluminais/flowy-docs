import { useMemo } from 'react'
import type { Flow, Model, Step } from '../../src/core/model.ts'
import { animationOf } from '../../src/core/animation.ts'
import { channelsAt, kindsOf } from '../../src/core/channels.ts'
import { captionOf, progressOf } from '../../src/core/captions.ts'
import { marksOf, statesAt } from '../../src/core/states.ts'
import type { StateMark } from '../../src/core/states.ts'
import { otherLaneSteps, stopsOf } from '../../src/core/structure.ts'
import { placeStep } from '../../src/core/views.ts'
import type { Playing } from './graph.ts'
import type { Recording } from './Recorder.tsx'
import type { OpenChannel } from './Channels.tsx'
import { takenBy } from './StepMotion.tsx'
import type { Play } from './usePlayer.ts'

export const NO_MARKS: Record<string, StateMark> = {} // the same object every time, so a flow with no states never rebuilds the graph for them

/**
 * What is on screen for the flow that plays on one canvas: its stops, the stop shown, the states at it, the `Playing` the graph is built from, the steps that move and
 * the caption. `flow` is undefined when no flow plays on this canvas (while editing, or while Performance or Failures is open); `recording` is the flow being
 * recorded in edit mode, whose steps so far are drawn the same way.
 */
export function useFlowStage({ model, view, flow, playing, replays, recording }: {
  model: Model; view: string; flow: Flow | undefined; playing: Play | undefined; replays: number; recording?: Recording
}) {
  // The player moves through stops, not steps: a stop is what is on screen at once (see structure.ts). `playing.step` is a stop.
  const stops = useMemo(() => (flow ? stopsOf(flow) : []), [flow])
  const stopIndex = flow && playing ? Math.max(0, Math.min(playing.step, stops.length - 1)) : 0
  const stop = flow ? stops[stopIndex] : undefined
  // Where shapes stand at this stop: the flow's start and each step's changes up to it (nothing is stored, so stepping back needs no undo).
  const flowMarks = useMemo(() => (flow && stop ? marksOf(model, statesAt(flow, stops, stopIndex)) : NO_MARKS), [model, flow, stop, stops, stopIndex])

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
      return { ends: placeSteps(flow.steps), steps: stops[stopIndex].steps, faint: otherLaneSteps(stops, stopIndex), ...(also.length > 0 ? { also } : {}) }
    }
    if (!recording) return undefined
    const done = placeSteps(Object.hasOwn(model.flows, recording.id) ? model.flows[recording.id].steps : [])
    return recording.from && recording.to
      ? { ends: [...done, placeStep(model, view, { from: recording.from, to: recording.to === recording.from ? undefined : recording.to })], step: done.length }
      : { ends: done }
  }, [model, view, flow, stops, stopIndex, recording])
  // Every step of the stop that moves, with where it lands in this view. A step the view can't show doesn't move.
  const animated = flow && stop ? stop.steps.flatMap(i => {
    const a = animationOf(flow.steps[i])
    const p = shown?.ends[i]
    return a && p ? [{ i, animation: a, placed: p, by: takenBy(model, view, a, p) }] : []
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
    return [{ channel, placed, ...(motion === undefined ? {} : { motion }) }]
  }) : []
  const channelKinds = kindsOf(open.map(o => o.channel))
  const stepKey = flow && playing ? `${playing.flow}:${stopIndex}:${replays}` : ''
  const caption = flow && stop ? captionOf(flow, stop) : undefined
  const progress = useMemo(() => (flow ? progressOf(flow, stops) : undefined), [flow, stops])
  const marks = flow && stop && caption ? stop.steps.flatMap((i, n) => {
    const p = shown?.ends[i]
    return p && stop.kind && caption.marks[n] !== '' ? [{ ends: p, text: caption.marks[n], kind: stop.kind }] : []
  }) : []
  return { stops, stopIndex, stop, flowMarks, shown, animated, moving, stepKey, caption, progress, marks, open, channelKinds }
}
