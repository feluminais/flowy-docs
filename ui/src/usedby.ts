import { dependents, needsDecision } from '../../src/core/dependents.ts'
import type { Action, Dependent, Target } from '../../src/core/dependents.ts'
import { getObject } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import type { Resolution } from '../../src/core/ops.ts'

/**
 * The "Used by" panel's logic, with no React in it: what is waiting on the shapes and lines about to be deleted, what the reader has chosen for
 * each, what is still open, and how to say what was done. The rows come from dependents(); deleteWith applies the choices.
 */

/** What is chosen for one row: the action, and where to when it points at a shape (reroute, repoint, change view, move out). */
export type Choice = { action: Action; to?: string }
/** The choices so far, by the key of the row they settle. */
export type Choices = Record<string, Choice>

export type Plan = {
  /** The targets with the shapes inside them that were chosen to go too. */
  targets: Target[]
  rows: Dependent[]
  /** The rows that need a decision, leaving out those of a flow that is going. */
  asks: Dependent[]
  /** The asks with no usable choice yet. */
  open: Dependent[]
  /** What goes along with the targets and needs no choice. */
  along: Dependent[]
  /** The flows that are going. */
  flows: Set<string>
}

/** What each action is called on a row. */
export const ACTION_LABELS: Record<Action, string> = {
  removeStep: 'Remove step', reroute: 'Reroute to…', deleteFlow: 'Delete flow', changeView: 'Change view', removeMode: 'Remove mode',
  repoint: 'Repoint to…', changeScope: 'Change scope', moveOut: 'Move out', deleteWith: 'Delete too',
}

/** Actions that name a shape to go to, and so are not settled until one is picked. */
const NEEDS_SHAPE: readonly Action[] = ['reroute', 'repoint']

/** The action "remove everything" takes for a row: the flow itself when the row's steps are all of it. */
export function defaultChoice(row: Dependent): Choice {
  switch (row.kind) {
    case 'step': return { action: row.emptiesFlow ? 'deleteFlow' : 'removeStep' }
    case 'view': return { action: 'deleteFlow' }
    case 'mode': return { action: 'removeMode' }
    case 'scope': return { action: 'changeScope' }
    case 'child': return { action: 'deleteWith' }
    default: throw new Error(`a ${row.kind} row goes with the shape and has no choice`)
  }
}

/** Whether a choice settles a row: it is one of the row's actions, and has its shape when it needs one. */
export const settles = (row: Dependent, choice: Choice | undefined): boolean =>
  choice !== undefined && row.actions.includes(choice.action) && (!NEEDS_SHAPE.includes(choice.action) || (choice.to !== undefined && choice.to !== ''))

/** What deleting these targets comes to, given the choices so far. */
export function planOf(model: Model, targets: Target[], choices: Choices): Plan {
  let all = targets
  let rows = dependents(model, all)
  for (;;) {
    const more = rows.filter(r => r.kind === 'child' && choices[r.key]?.action === 'deleteWith').map(r => r.child as string)
    if (more.length === 0) break
    all = [...all, ...more.map(object => ({ object }))]
    rows = dependents(model, all)
  }
  const flows = new Set(rows.filter(r => choices[r.key]?.action === 'deleteFlow' && r.flow !== undefined && r.actions.includes('deleteFlow')).map(r => r.flow as string))
  const asks = rows.filter(needsDecision).filter(r => r.flow === undefined || !flows.has(r.flow))
  return { targets: all, rows, asks, open: asks.filter(r => !settles(r, choices[r.key])), along: rows.filter(r => !needsDecision(r)), flows }
}

/** The choices with every open row settled the way removing it does, over and over, as shapes chosen to go too bring rows of their own. */
export function removeAll(model: Model, targets: Target[], choices: Choices): Choices {
  const next = { ...choices }
  for (;;) {
    const { open } = planOf(model, targets, next)
    if (open.length === 0) return next
    for (const row of open) next[row.key] = defaultChoice(row)
  }
}

/** The choices with every step and every mode part that can move to `to` doing so. Rows that can't (a view, a shape inside, a line) are left as they were. */
export function rerouteAll(model: Model, targets: Target[], choices: Choices, to: string): Choices {
  const next = { ...choices }
  for (const row of planOf(model, targets, next).asks) {
    if (row.kind === 'step') next[row.key] = { action: 'reroute', to }
    else if (row.kind === 'mode' && row.part !== 'line') next[row.key] = { action: 'repoint', to }
  }
  return next
}

/** What deleteWith is told: a resolution for each row that is asking, and for the shapes chosen to go too. */
export function resolutionsOf(plan: Plan, choices: Choices): Resolution[] {
  const going = new Set(plan.targets.flatMap(t => ('object' in t ? [t.object] : [])))
  // A flow that is going is told by one of its rows; its other rows say nothing.
  const flowRows = [...plan.flows].flatMap(f => plan.rows.find(r => r.flow === f && choices[r.key]?.action === 'deleteFlow')?.key ?? [])
  const keys = new Set([...plan.asks.map(r => r.key), ...flowRows, ...[...going].map(id => `child:${id}`)])
  return Object.entries(choices).filter(([key, c]) => keys.has(key) && (!key.startsWith('child:') || c.action === 'deleteWith')).map(([key, c]) => ({ key, action: c.action, ...(c.to === undefined ? {} : { to: c.to }) }))
}

/** The shapes a row can be sent to: any that is not going, in the model's order. */
export function shapesLeft(model: Model, plan: Plan): string[] {
  const going = new Set(plan.targets.flatMap(t => ('object' in t ? [t.object] : [])))
  return Object.keys(model.objects).filter(id => !going.has(id) && getObject(model, id) !== undefined)
}

const nameOf = (model: Model, id: string): string => getObject(model, id)?.name || id

/** What a row says: the flow or analysis it sits in, where in it, and the shapes it names (to outline on the canvas). */
export function rowText(model: Model, row: Dependent): { title: string; where: string; shapes: string[] } {
  const flow = row.flow === undefined ? undefined : model.flows[row.flow]
  const analysis = row.analysis === undefined ? undefined : model.failures[row.analysis]
  switch (row.kind) {
    case 'step': {
      const step = flow?.steps[(row.step as number) - 1]
      const ends = [step?.from, step?.to].filter((id): id is string => typeof id === 'string')
      return { title: flow?.name ?? row.flow ?? '', where: `Step ${row.step}: ${ends.map(id => nameOf(model, id)).join(' → ')}`, shapes: ends }
    }
    case 'view': return { title: flow?.name ?? row.flow ?? '', where: 'View', shapes: [] }
    case 'mode': {
      const mode = analysis?.modes[row.mode as string]
      const part = row.part === 'line' ? 'Line' : row.part === 'on' ? 'On' : row.part === 'from' ? 'From' : 'To'
      const shapes = row.part === 'line' ? [mode?.from, mode?.to] : [row.part === 'on' ? mode?.on : row.part === 'from' ? mode?.from : mode?.to]
      return { title: analysis?.name ?? row.analysis ?? '', where: `${mode?.mode || row.mode}: ${part}`, shapes: shapes.filter((id): id is string => typeof id === 'string') }
    }
    case 'scope': return { title: analysis?.name ?? row.analysis ?? '', where: 'Scope', shapes: [] }
    case 'child': return { title: nameOf(model, row.child as string), where: 'Inside it', shapes: [row.child as string] }
    default: return { title: row.of, where: '', shapes: [] }
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What went along with the targets, in a few words: "2 lines, 1 state". Empty when nothing did. */
export function alongText(along: Dependent[]): string {
  const n = (kinds: Dependent['kind'][]) => along.filter(r => kinds.includes(r.kind)).length
  return [
    n(['line']) && count(n(['line']), 'line'),
    n(['start', 'stepState']) && count(n(['start', 'stepState']), 'state'),
    n(['affects']) && count(n(['affects']), 'affected shape'),
  ].filter(Boolean).join(', ')
}

/** The notice after a delete: what went, what was done about what depended on it, and what went along. */
export function doneText(model: Model, plan: Plan, choices: Choices, targets: Target[]): string {
  const shapes = targets.flatMap(t => ('object' in t ? [t.object] : []))
  const what = shapes.length === 1 ? nameOf(model, shapes[0]) : shapes.length > 1 ? `${shapes.length} shapes` : 'the line'
  const by = (action: Action) => plan.asks.filter(r => choices[r.key]?.action === action).length
  const parts = [
    by('removeStep') && `${count(by('removeStep'), 'step')} removed`,
    by('reroute') && `${count(by('reroute'), 'step')} rerouted`,
    plan.flows.size && `${count(plan.flows.size, 'flow')} deleted`,
    by('removeMode') && `${count(by('removeMode'), 'mode')} removed`,
    by('repoint') && `${count(by('repoint'), 'mode')} repointed`,
    by('changeView') && `${count(by('changeView'), 'flow')} moved`,
    by('moveOut') && `${count(by('moveOut'), 'shape')} moved out`,
  ].filter(Boolean)
  const along = alongText(plan.along)
  return [`Deleted ${what}.`, parts.length ? `${parts.join(', ')}.`.replace(/^./, c => c.toUpperCase()) : '', along ? `Went with it: ${along}.` : ''].filter(Boolean).join(' ')
}
