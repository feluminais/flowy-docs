/**
 * The state a shape is in. A shape is Running unless a flow says otherwise: a flow's `states` say where shapes stand before step 1,
 * and a step's `states` change some of them, from that stop on, until another step changes them again. This file folds those along a
 * flow's stops into `{ shape id: state }` and rolls a container's inside-state up for the overview. Nothing here draws, and nothing needs
 * a browser. desktop/Flowy.Core/States.cs is a port, and desktop/fixtures/states.ts keeps the two equal.
 */
import { getObject, ROOT } from './model.ts'
import type { Flow, Model } from './model.ts'
import { stopBefore } from './structure.ts'
import type { Stop } from './structure.ts'
import { isMap, own } from './text.ts'
import { chain } from './views.ts'

export const STATE_NAMES = ['running', 'starting', 'stopping', 'stopped', 'restarting', 'degraded'] as const
export type StateName = (typeof STATE_NAMES)[number]
export const isStateName = (v: unknown): v is StateName => STATE_NAMES.some(n => n === v)
/** The words a person says. The file holds the lowercase word. */
export const STATE_LABELS: Record<StateName, string> = {
  running: 'Running', starting: 'Starting', stopping: 'Stopping', stopped: 'Stopped', restarting: 'Restarting', degraded: 'Degraded',
}

/** Shape id to state. A shape not in it is Running. */
export type States = Record<string, StateName>

/**
 * The well-formed entries of a `states` value: a mapping whose values are state words. Anything else is left out (check() reports it, so a
 * bad file still plays). A shape id is not looked up here; marksOf drops the ones the model does not have.
 */
export function readStates(raw: unknown): States {
  const out: States = {}
  if (isMap(raw)) for (const [id, state] of Object.entries(raw)) if (isStateName(state)) own(out, id, state)
  return out
}

/** Whether a flow says anything about states, in its start or in any step. A flow that does not folds to nothing and draws nothing. */
export const usesStates = (flow: Flow): boolean => flow.states !== undefined || flow.steps.some(s => s.states !== undefined)

const USE = `use ${STATE_NAMES.join(', ')}`
const SHAPE_MAP = 'states must map shape ids to states'

/**
 * What is wrong with a flow's `states` and its steps', in this order: the flow's own, then each step's (in file order), then each parallel
 * stop whose lanes set one shape to different states. A step's problem has its 0-based `step` and is worded to follow "step N: "; the others
 * stand alone. `exists` says whether an id is a shape. A value that is not a mapping is one problem and reads as no states.
 */
export function stateProblems(flow: Flow, stops: Stop[], exists: (id: string) => boolean): { step?: number; message: string }[] {
  const out: { step?: number; message: string }[] = []
  const check = (raw: unknown, step?: number) => {
    const add = (message: string) => out.push(step === undefined ? { message } : { step, message })
    if (raw === undefined) return
    if (!isMap(raw)) { add(SHAPE_MAP); return }
    for (const [id, state] of Object.entries(raw)) {
      if (!exists(id)) add(`states: unknown shape "${id}"`)
      if (typeof state !== 'string') add(`states: "${id}" needs a state word (${USE})`)
      else if (!isStateName(state)) add(`states: unknown state "${state}" for "${id}" (${USE})`)
    }
  }
  check(flow.states)
  flow.steps.forEach((s, i) => check(s.states, i))

  // Two lanes of one parallel stop that leave a shape in different states: the picture still follows the later lane, but the file contradicts itself.
  for (const stop of stops) {
    if (stop.steps.length < 2) continue
    const first = new Map<string, StateName>()
    const told = new Set<string>()
    for (const i of stop.steps) {
      const step = flow.steps[i]
      if (step === undefined) continue
      for (const [id, state] of Object.entries(readStates(step.states))) {
        const seen = first.get(id)
        if (seen === undefined) first.set(id, state)
        else if (seen !== state && !told.has(id)) {
          told.add(id)
          out.push({ step: i, message: `shape "${id}" is set to both ${seen} and ${state} in one stop` })
        }
      }
    }
  }
  return out
}

/**
 * Where every shape stands at stop `k`: the flow's `states`, then the `states` of each stop along the `before` chain up to and including `k`,
 * the later one winning. The chain is followed, not the file order, so a branch lane starts from the state before the branch and the last
 * lane's changes are the ones that carry on after it. Nothing is stored between stops, so stepping back needs no undo. Total: a `k` that is
 * not a stop, or a flow with no stops, gives the flow's start. A flow with no `states` anywhere gives `{}` at once.
 */
export function statesAt(flow: Flow, stops: Stop[], k: number): States {
  const out = readStates(flow.states)
  if (!flow.steps.some(s => s.states !== undefined) || !Number.isInteger(k) || k < 0 || k >= stops.length) return out
  // Walked back first, then applied from the start. A stop only ever follows an earlier one, so this ends; the bound is for stops that came from elsewhere.
  const path: number[] = []
  for (let at: number | undefined = k; at !== undefined && path.length <= stops.length; at = stopBefore(stops, at)) path.push(at)
  for (let p = path.length - 1; p >= 0; p--) {
    for (const i of stops[path[p]].steps) {
      const step = flow.steps[i]
      if (step === undefined) continue
      for (const [id, state] of Object.entries(readStates(step.states))) own(out, id, state)
    }
  }
  return out
}

/** A shape that is not Running (`state`), and whether that is only because something inside it is not (`inside`). */
export type StateMark = { state: StateName; inside: boolean }

/** Worst first: what a container shows at the overview when several things inside it are not running. */
const WORST: readonly StateName[] = ['stopped', 'restarting', 'degraded', 'stopping', 'starting']

/**
 * What to draw for each shape: every shape of the model whose state is not Running, with `inside: false`; and every shape that holds one
 * and has no state of its own, with the worst state below it and `inside: true`. A shape with its own entry (Running included) shows that
 * and no roll-up. Running entries and ids the model does not have are dropped.
 */
export function marksOf(model: Model, states: States): Record<string, StateMark> {
  const marks: Record<string, StateMark> = {}
  const set = (id: string, mark: StateMark) => own(marks, id, mark)
  const entries = Object.entries(states).filter(([id, state]) => state !== 'running' && getObject(model, id) !== undefined)
  for (const [id, state] of entries) set(id, { state, inside: false })
  for (const [id, state] of entries) {
    for (const above of chain(model, id).slice(1)) {
      if (above === ROOT || Object.hasOwn(states, above)) continue
      const seen = Object.hasOwn(marks, above) ? marks[above].state : undefined
      if (seen === undefined || WORST.indexOf(state) < WORST.indexOf(seen)) set(above, { state, inside: true })
    }
  }
  return marks
}
