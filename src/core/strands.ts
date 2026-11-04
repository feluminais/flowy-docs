import type { Model, Step } from './model.ts'
import { lineKey, placeEnds, placeStep } from './views.ts'
import type { Strand, View } from './views.ts'

/**
 * Which line of a pair a flow step rides, where a project draws a line for each connection (`pairs: separate`, see View.strands). The step says it with `via`, the label of the
 * connection; when it does not, the payload, the direction or the order of the file decide. Everything here is pure, and both readers and the MCP tools call it.
 */

/** How a `via` is compared with a label: with the space at its ends cut off, and whatever the case. */
export const viaKey = (text: unknown): string => (typeof text === 'string' ? text.trim().toLowerCase() : '')

/**
 * The strands a step between `placed[0]` and `placed[1]` can ride, in the order they are tried: the strands of the pair that run the step's way, in lane order, then the strands
 * of a request or a stream that run against it, since the answer to a request comes back along the line the request went (the tail mark on the line says so). A strand of a
 * publish, a cached publish, an object update or an extension point has no answer to carry, so a step against one has no strand: it is drawn as a step line, as it always was.
 * Empty when the view draws one line for each pair.
 */
export function strandCandidates(view: View, placed: readonly [string, string]): Strand[] {
  if (view.strands === undefined) return []
  const pair = lineKey(placed[0], placed[1])
  const ofPair = view.strands.filter(s => s.pair === pair)
  const same = ofPair.filter(s => s.from === placed[0] && s.to === placed[1])
  const replies = ofPair.filter(s => s.from === placed[1] && s.to === placed[0] && (s.kind === 'request' || s.kind === 'stream'))
  return [...same, ...replies]
}

/**
 * The strand a step rides, or undefined when it rides none (the view draws one line for each pair, or no strand of the pair runs that way). `placed` is where the step lands on the
 * view (see placeStep). Of the candidates (see strandCandidates), the first of these decides:
 * 1. the one whose label is the step's `via`;
 * 2. the one whose connection lists the step's `payload` among its `payloads`;
 * 3. the one whose own connection runs between the step's own shapes (a step between two components, seen from the level above);
 * 4. the first, in lane order.
 * A `via` that matches nothing is not an error here, since the later rules still give an answer; check() reports it.
 */
export function strandOf(model: Model, view: View, step: Step, placed: readonly [string, string]): Strand | undefined {
  const candidates = strandCandidates(view, placed)
  if (candidates.length === 0) return undefined
  const via = viaKey(step.via)
  const named = via === '' ? undefined : candidates.find(s => viaKey(s.label) === via)
  if (named) return named
  const payload = typeof step.payload === 'string' ? step.payload : undefined
  const carrying = payload === undefined ? undefined : candidates.find(s => s.connections.some(i => {
    const listed = model.connections[i].payloads
    return Array.isArray(listed) && listed.includes(payload)
  }))
  if (carrying) return carrying
  const own = step.to === undefined ? undefined : candidates.find(s => s.connections.some(i => model.connections[i].from === step.from && model.connections[i].to === step.to))
  return own ?? candidates[0]
}

/** For each pair of shapes a view draws, the labels (as viaKey has them) of the connections that land on it. */
export type PairLabels = Map<string, Set<string>>

export function pairLabels(model: Model, view: string): PairLabels {
  const labels: PairLabels = new Map()
  for (const c of model.connections) {
    const ends = placeEnds(model, view, c.from, c.to)
    if (!ends) continue
    const key = lineKey(...ends)
    const set = labels.get(key)
    if (set) set.add(viaKey(c.label))
    else labels.set(key, new Set([viaKey(c.label)]))
  }
  return labels
}

/** Whether a step's `via` names a connection of the pair the step lands on, in either direction (an answer rides the line of its request). Anything but a text via names one. */
const names = (labels: PairLabels, step: Step, placed: readonly [string, string]): boolean =>
  viaKey(step.via) === '' || (labels.get(lineKey(placed[0], placed[1]))?.has(viaKey(step.via)) ?? false)

/**
 * What is wrong with a step's `via`, worded to follow "step N:": it names no connection between the shapes the step lands on, or undefined when it names one, there is no `via`, or
 * the step is not between two shapes of its view. `labels` are those of the view the step's flow plays on (see pairLabels). Only a wrong `via` is a problem: two
 * lines a step could ride are not, since the payload, the direction or the order still decide.
 */
export function viaProblem(labels: PairLabels, step: Step, placed: readonly [string, string] | null): string | undefined {
  if (typeof step.via !== 'string' || viaKey(step.via) === '' || step.to === undefined || placed === null || placed[0] === placed[1]) return undefined
  return names(labels, step, placed) ? undefined : `"via" ${JSON.stringify(step.via)} matches no connection from ${placed[0]} to ${placed[1]}`
}

/**
 * The steps whose `via` named a connection in `before` and names none in `after`: the ones a change of the connections (a label changed, a connection removed) leaves pointing
 * at nothing. `step` counts from 0.
 */
export function viaBroken(before: Model, after: Model): { flow: string; step: number }[] {
  const broken: { flow: string; step: number }[] = []
  const labels = new Map<string, [PairLabels, PairLabels]>()
  for (const [flow, f] of Object.entries(before.flows)) {
    if (!Array.isArray(f?.steps)) continue
    f.steps.forEach((step, i) => {
      if (viaKey(step?.via) === '' || step.to === undefined) return
      const placed = placeStep(before, f.view, step)
      if (!placed || placed[0] === placed[1]) return
      let seen = labels.get(f.view)
      if (!seen) labels.set(f.view, seen = [pairLabels(before, f.view), pairLabels(after, f.view)])
      if (names(seen[0], step, placed) && !names(seen[1], step, placed)) broken.push({ flow, step: i })
    })
  }
  return broken
}
