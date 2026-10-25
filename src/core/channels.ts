/**
 * What a step leaves open. A step's `animation` may open a channel (`opens: stream`, `listener` or `job`) and a later step may close it
 * (`closes: <name>`). This file folds those along a flow's stops into the channels that are open at each one, so a player can keep drawing
 * them after the step that opened them. Nothing here draws, and nothing needs a browser.
 * desktop/Flowy.Core/Channels.cs is a port, and desktop/fixtures/channels.ts keeps the two equal.
 */
import { animationOf, CHANNEL_KINDS, DEFAULT_END } from './animation.ts'
import type { ChannelEnd, ChannelKind } from './animation.ts'
import type { Flow } from './model.ts'
import { stopBefore, stopIndexOf } from './structure.ts'
import type { Stop } from './structure.ts'

/** The words a person says. */
export const CHANNEL_LABELS: Record<ChannelKind, string> = { stream: 'Open stream', listener: 'Listening', job: 'Running job' }

/**
 * A channel that is open at a stop. `step` is the file step number (from 0) that opened it, `from` and `to` are that step's ends, `end` is the one it
 * points at. `opening` is true at the stop that opens it, `closing` at the stop that closes it (it is still there, and goes when the step has played).
 */
export type Channel = { step: number; kind: ChannelKind; name?: string; from: string; to: string; end: ChannelEnd; opening: boolean; closing: boolean }

/** The stops that lead to stop `k`, first to last, following the `before` chain as statesAt does. Empty for a `k` that is not a stop. */
function pathTo(stops: Stop[], k: number): number[] {
  if (!Number.isInteger(k) || k < 0 || k >= stops.length) return []
  const path: number[] = []
  for (let at: number | undefined = k; at !== undefined && path.length <= stops.length; at = stopBefore(stops, at)) path.push(at)
  return path.reverse()
}

/** What stop `k` does to the open channels: the channels it opens and the names it closes, in the order of its steps. */
function changesOf(flow: Flow, stop: Stop): { opened: Channel[]; closed: string[] } {
  const opened: Channel[] = []
  const closed: string[] = []
  for (const i of stop.steps) {
    const step = flow.steps[i]
    const a = step === undefined ? undefined : animationOf(step)
    if (step === undefined || a === undefined) continue
    if (a.opens !== undefined && step.to !== undefined)
      opened.push({ step: i, kind: a.opens, ...(a.name === undefined ? {} : { name: a.name }), from: step.from, to: step.to, end: a.towards ?? DEFAULT_END[a.opens], opening: true, closing: false })
    if (a.closes !== undefined) closed.push(a.closes)
  }
  return { opened, closed }
}

/** The key that tells one channel from another: its name, else the step that opened it (so an unnamed channel stays open to the end). */
const keyOf = (c: Pick<Channel, 'name' | 'step'>): string => (c.name === undefined ? `#${c.step}` : `name:${c.name}`)

/**
 * The channels open at stop `k`, in the order they were opened: the ones opened by the stops that lead to it (the `before` chain, as statesAt follows),
 * the ones it opens itself (`opening`), and the ones it closes (`closing`), which are still there while the step plays. A channel opened again under a
 * name that is open replaces it. Nothing is stored between stops, so stepping back needs no undo. Total: a `k` that is not a stop gives none.
 */
export function channelsAt(flow: Flow, stops: Stop[], k: number): Channel[] {
  const open = new Map<string, Channel>()
  if (!flow.steps.some(s => s.animation !== undefined)) return []
  const path = pathTo(stops, k)
  path.forEach((at, n) => {
    const last = n === path.length - 1
    const { opened, closed } = changesOf(flow, stops[at])
    for (const name of closed) {
      const found = open.get(`name:${name}`)
      if (found === undefined) continue
      if (last) open.set(`name:${name}`, { ...found, opening: false, closing: true })
      else open.delete(`name:${name}`)
    }
    for (const c of opened) {
      open.delete(keyOf(c)) // a re-open goes to the end of the order
      open.set(keyOf(c), last ? c : { ...c, opening: false })
    }
  })
  return [...open.values()]
}

/** Whether any step of the flow opens or closes a channel. A flow that does not draws nothing of the kind. */
export const usesChannels = (flow: Flow): boolean =>
  flow.steps.some(s => {
    const a = animationOf(s)
    return a !== undefined && (a.opens !== undefined || a.closes !== undefined)
  })

/** The kinds of channel the list holds, in the order of CHANNEL_KINDS, for a key that shows only what is on screen. */
export const kindsOf = (channels: readonly Channel[]): ChannelKind[] => CHANNEL_KINDS.filter(k => channels.some(c => c.kind === k))

/** The named channels that are open on arriving at stop `k`: what the stop before it left open, without the ones that stop closed. */
function openBefore(flow: Flow, stops: Stop[], k: number): (Channel & { name: string })[] {
  const prior = stopBefore(stops, k)
  return prior === undefined ? [] : channelsAt(flow, stops, prior).filter((c): c is Channel & { name: string } => !c.closing && c.name !== undefined)
}

/** The channels step `step` (a file step number) can close: the named ones open when its stop is reached. For the form that picks one. */
export const closableAt = (flow: Flow, stops: Stop[], step: number): { name: string; kind: ChannelKind }[] =>
  openBefore(flow, stops, stopIndexOf(stops, step)).map(c => ({ name: c.name, kind: c.kind }))

/**
 * What is wrong with the channels of a flow, in the order of its stops, each worded to follow "step N: " with its 0-based `step`: a step that closes a
 * name nothing has open at that point (the message lists what is open), and one that opens a name that is already open.
 */
export function channelProblems(flow: Flow, stops: Stop[]): { step: number; message: string }[] {
  const out: { step: number; message: string }[] = []
  if (!usesChannels(flow)) return out
  // What each stop leaves open, worked out once in stop order (a stop's `before` chain only goes back), as channelsAt folds it: walking the
  // chain again for every stop would cost the square of the steps, on every check of a long flow.
  const after: Map<string, Channel>[] = []
  stops.forEach((stop, k) => {
    const prior = stopBefore(stops, k)
    const before = prior === undefined ? new Map<string, Channel>() : after[prior]
    const names = [...before.values()].flatMap(c => (c.name === undefined ? [] : [c.name]))
    const { opened, closed } = changesOf(flow, stop)
    const open = new Map(before)
    for (const name of closed) open.delete(`name:${name}`)
    for (const c of opened) {
      open.delete(keyOf(c))
      open.set(keyOf(c), { ...c, opening: false })
    }
    after[k] = open
    for (const i of stop.steps) {
      const a = animationOf(flow.steps[i])
      if (a?.closes !== undefined && !names.includes(a.closes))
        out.push({ step: i, message: `closes "${a.closes}", but nothing by that name is open${names.length === 0 ? '' : ` (open: ${names.join(', ')})`}` })
      const again = opened.find(c => c.step === i)
      if (again?.name !== undefined && names.includes(again.name) && !closed.includes(again.name)) out.push({ step: i, message: `opens "${again.name}", which is already open` })
    }
  })
  return out
}
