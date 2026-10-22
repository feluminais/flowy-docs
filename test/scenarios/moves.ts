import * as ops from '../../src/core/ops.ts'
import { OBJECT_TYPES } from '../../src/core/model.ts'
import type { Model, Step } from '../../src/core/model.ts'
import { STATE_NAMES } from '../../src/core/states.ts'
import { GROUP_KINDS } from '../../src/core/structure.ts'
import { isView, memberIds, placeEnds } from '../../src/core/views.ts'
import { Rng } from './rng.ts'

/**
 * The edits a person (or an AI over MCP) can make, as moves a scenario picks from. Every call into ops.ts is in this file, so when an op changes its
 * arguments this is the one place to follow it. A move is a user who is only partly careful: most arguments are real, some are ids that are not
 * there, were deleted a moment ago, or are names the model reserves ("root", "constructor", "__proto__").
 */
export type Move = {
  /** The op, which names the move in a report. */
  op: string
  /** The call in words, for the trace. */
  label: string
  run: (model: Model) => Model
  /** The MCP tool that makes the same edit, and what an AI sends it. Left out for an edit no tool makes. */
  call?: { tool: string; args: Record<string, unknown> }
  /** What must hold when the op was accepted, as a sentence about what is wrong when it does not. */
  expect?: (before: Model, after: Model) => string | undefined
}
export type Maker = (model: Model, rng: Rng) => Move | undefined

const HOSTILE = ['ghost', 'constructor', '__proto__', 'root', '', 'Bad Id', 'toString']

const objectIds = (m: Model) => Object.keys(m.objects)
const flowIds = (m: Model) => Object.keys(m.flows)
const analysisIds = (m: Model) => Object.keys(m.failures)

/** A shape id: mostly one that is there. */
function shape(m: Model, rng: Rng): string {
  return rng.chance(0.06) || objectIds(m).length === 0 ? rng.pick(HOSTILE) : rng.pick(objectIds(m))
}

function flow(m: Model, rng: Rng): string {
  return rng.chance(0.05) || flowIds(m).length === 0 ? rng.pick(HOSTILE) : rng.pick(flowIds(m))
}

function analysis(m: Model, rng: Rng): string {
  return rng.chance(0.05) || analysisIds(m).length === 0 ? rng.pick(HOSTILE) : rng.pick(analysisIds(m))
}

// The hostile ids include names every object has ('constructor'), so a lookup by id has to ask for its own keys.
const stepsOf = (m: Model, id: string) => (Object.hasOwn(m.flows, id) ? m.flows[id].steps : [])
const groupsOf = (m: Model, id: string) => (Object.hasOwn(m.flows, id) ? Object.keys(m.flows[id].groups ?? {}) : [])
const modesOf = (m: Model, id: string) => (Object.hasOwn(m.failures, id) ? Object.keys(m.failures[id].modes) : [])

/** One of `items`, now and then `bad` (a name that is not there). */
const among = (rng: Rng, items: readonly string[], bad: string) => (items.length === 0 || rng.chance(0.08) ? bad : rng.pick(items))

const fresh = (rng: Rng, prefix: string) => `${prefix}-${rng.int(40)}`

/** A position in a list: mostly inside it, now and then just outside. */
const indexIn = (rng: Rng, length: number) => (rng.chance(0.1) ? rng.pick([-1, length, length + 5]) : rng.int(Math.max(length, 1)))

function line(m: Model, rng: Rng): { from: string; to: string; label?: string } {
  if (m.connections.length === 0 || rng.chance(0.15)) return { from: shape(m, rng), to: shape(m, rng) }
  const { from, to, label } = rng.pick(m.connections)
  return { from, to, ...(label === undefined ? {} : { label }) }
}

function step(m: Model, rng: Rng, n: number): Step {
  const text = `step ${n}`
  if (rng.chance(0.2)) return { from: shape(m, rng), text }
  const { from, to } = line(m, rng)
  return { from, to, text }
}

/** Steps that a view can show, as a flow that plays there needs. Now and then a step that it can't. */
function steps(m: Model, rng: Rng, view: string): Step[] {
  const shown = m.connections.filter(c => placeEnds(m, view, c.from, c.to) !== null)
  const members = memberIds(m, view)
  return Array.from({ length: 1 + rng.int(5) }, (_, i) => {
    const text = `step ${i + 1}`
    if (rng.chance(0.06) || (shown.length === 0 && members.length === 0)) return step(m, rng, i + 1)
    if (shown.length === 0 || rng.chance(0.15)) return { from: rng.pick(members), text }
    const { from, to } = rng.pick(shown)
    return { from, to, text }
  })
}

const rating = (rng: Rng) => (rng.chance(0.03) ? rng.pick([0, 11, 4.5]) : 1 + rng.int(10))

function modeInput(m: Model, rng: Rng): ops.ModeInput {
  const input: ops.ModeInput = { mode: `Something fails ${rng.int(100)}`, severity: rating(rng), occurrence: rating(rng), detection: rating(rng) }
  if (rng.chance(0.6)) input.on = shape(m, rng)
  else {
    const { from, to } = line(m, rng)
    Object.assign(input, { from, to })
  }
  if (rng.chance(0.3)) input.affects = rng.some(objectIds(m), 2)
  if (rng.chance(0.2) && flowIds(m).length) Object.assign(input, { flow: rng.pick(flowIds(m)), step: 1 + rng.int(3) })
  return input
}

const gone = (before: Model, after: Model, ids: string[]) => {
  const left = ids.filter(id => Object.hasOwn(before.objects, id) && Object.hasOwn(after.objects, id))
  if (left.length) return `${left.join(', ')} is still there`
  const lines = after.connections.filter(c => ids.includes(c.from) || ids.includes(c.to))
  if (lines.length) return `${lines.length} line(s) still join a shape that is gone`
  return undefined
}

export const MAKERS: Record<string, Maker> = {
  addObject: (m, rng) => {
    const id = fresh(rng, 'n')
    const input: ops.ObjectInput = { id, type: rng.pick(OBJECT_TYPES), name: `Shape ${id}`, ...(rng.chance(0.7) ? { in: shape(m, rng) } : {}) }
    return {
      op: 'putObject', label: `putObject ${id} (${input.type}${input.in === undefined ? '' : ` in ${input.in || '""'}`})`,
      call: { tool: 'put_object', args: input }, run: model => ops.putObject(model, input),
      expect: (_, after) => (Object.hasOwn(after.objects, id) ? undefined : `${id} was not added`),
    }
  },
  editObject: (m, rng) => {
    const id = shape(m, rng)
    const input: ops.ObjectInput = rng.pick<ops.ObjectInput>([
      { id, tech: 'Rust' }, { id, description: 'Changed.' }, { id, in: shape(m, rng) }, { id, in: '' }, { id, color: 'blue' }, { id, shape: '' },
      { id, name: `Renamed ${rng.int(9)}` }, { id, type: rng.pick(OBJECT_TYPES) }, { id, external: true }, { id, code: ['src/x.ts'] },
    ])
    return { op: 'putObject', label: `putObject ${JSON.stringify(input)}`, call: { tool: 'put_object', args: input }, run: model => ops.putObject(model, input) }
  },
  deleteObject: (m, rng) => {
    const id = shape(m, rng)
    return {
      op: 'deleteObject', label: `deleteObject ${id}`, call: { tool: 'delete_object', args: { id } }, run: model => ops.deleteObject(model, id),
      expect: (before, after) => gone(before, after, [id]),
    }
  },
  deleteObjects: (m, rng) => {
    const ids = Array.from({ length: 1 + rng.int(3) }, () => shape(m, rng))
    return {
      op: 'deleteObjects', label: `deleteObjects ${ids.join(', ')}`, run: model => ops.deleteObjects(model, ids),
      expect: (before, after) => gone(before, after, ids),
    }
  },
  connect: (m, rng) => {
    const { from, to } = line(m, rng)
    const label = rng.chance(0.6) ? `calls ${rng.int(5)}` : undefined
    return {
      op: 'connect', label: `connect ${from} → ${to}${label ? ` "${label}"` : ''}`, call: { tool: 'connect', args: { from, to, label } }, run: model => ops.connect(model, { from, to, label }),
      expect: (_, after) => (after.connections.some(c => c.from === from && c.to === to) ? undefined : 'the line is not there'),
    }
  },
  disconnect: (m, rng) => {
    const l = line(m, rng)
    return { op: 'disconnect', label: `disconnect ${l.from} → ${l.to}`, call: { tool: 'disconnect', args: l }, run: model => ops.disconnect(model, l) }
  },
  removeConnection: (m, rng) => {
    const l = line(m, rng)
    return { op: 'removeConnection', label: `removeConnection ${l.from} → ${l.to} "${l.label ?? ''}"`, run: model => ops.removeConnection(model, l) }
  },
  relabel: (m, rng) => {
    const l = line(m, rng)
    const label = rng.chance(0.2) ? '' : `new ${rng.int(5)}`
    return { op: 'relabel', label: `relabel ${l.from} → ${l.to} to "${label}"`, run: model => ops.relabel(model, l, label) }
  },
  putFlow: (m, rng) => {
    const id = rng.chance(0.4) && flowIds(m).length ? rng.pick(flowIds(m)) : fresh(rng, 'f')
    const view = rng.chance(0.05) ? shape(m, rng) : rng.pick(['root', ...objectIds(m)].filter(v => isView(m, v)))
    const input: ops.FlowInput = { id, name: `Flow ${id}`, view, steps: steps(m, rng, view) }
    return {
      op: 'putFlow', label: `putFlow ${id} in ${input.view || '""'} (${input.steps.length} steps)`, call: { tool: 'put_flow', args: input }, run: model => ops.putFlow(model, input),
      expect: (_, after) => (Object.hasOwn(after.flows, id) ? undefined : `${id} was not saved`),
    }
  },
  updateFlow: (m, rng) => {
    const id = flow(m, rng)
    const old = stepsOf(m, id)
    const next = rng.pick([old.slice(1), [...old].reverse(), [...old, step(m, rng, old.length + 1)], []])
    return { op: 'updateFlow', label: `updateFlow ${id} to ${next.length} steps`, run: model => ops.updateFlow(model, id, { steps: next }) }
  },
  deleteFlow: (m, rng) => {
    const id = flow(m, rng)
    return { op: 'deleteFlow', label: `deleteFlow ${id}`, call: { tool: 'delete_flow', args: { id } }, run: model => ops.deleteFlow(model, id) }
  },
  removeStep: (m, rng) => {
    const id = flow(m, rng)
    const i = indexIn(rng, stepsOf(m, id).length)
    return { op: 'removeStep', label: `removeStep ${id} #${i}`, run: model => ops.removeStep(model, id, i) }
  },
  setStepStates: (m, rng) => {
    const id = flow(m, rng)
    const i = indexIn(rng, stepsOf(m, id).length)
    const states = Object.fromEntries(rng.some(objectIds(m), 2).map(o => [o, rng.chance(0.1) ? 'sleeping' : rng.pick(STATE_NAMES)]))
    return { op: 'setStepStates', label: `setStepStates ${id} #${i} ${JSON.stringify(states)}`, run: model => ops.setStepStates(model, id, i, states) }
  },
  setStepAnimation: (m, rng) => {
    const id = flow(m, rng)
    const i = indexIn(rng, stepsOf(m, id).length)
    const animation = rng.pick<string | undefined>(['send', 'call', 'callback', 'event', undefined, 'teleport'])
    return { op: 'setStepAnimation', label: `setStepAnimation ${id} #${i} ${animation}`, run: model => ops.setStepAnimation(model, id, i, animation) }
  },
  groupSteps: (m, rng) => {
    const id = flow(m, rng)
    const n = stepsOf(m, id).length
    const group = fresh(rng, 'g')
    const kind = rng.pick(GROUP_KINDS)
    const a = indexIn(rng, n)
    const b = rng.chance(0.1) ? indexIn(rng, n) : a + rng.int(3)
    return { op: 'groupSteps', label: `groupSteps ${id} ${group} ${kind} ${a}..${b}`, run: model => ops.groupSteps(model, id, group, kind, a, b) }
  },
  setStepGroup: (m, rng) => {
    const id = flow(m, rng)
    const i = indexIn(rng, stepsOf(m, id).length)
    const group = rng.chance(0.3) ? '' : among(rng, groupsOf(m, id), 'nope')
    return { op: 'setStepGroup', label: `setStepGroup ${id} #${i} → "${group}"`, run: model => ops.setStepGroup(model, id, i, group) }
  },
  setGroupKind: (m, rng) => {
    const id = flow(m, rng)
    const group = among(rng, groupsOf(m, id), 'nope')
    const kind = rng.chance(0.05) ? 'loop' : rng.pick(GROUP_KINDS)
    return { op: 'setGroupKind', label: `setGroupKind ${id} ${group} ${kind}`, run: model => ops.setGroupKind(model, id, group, kind) }
  },
  putGroup: (m, rng) => {
    const id = flow(m, rng)
    const group = among(rng, groupsOf(m, id), fresh(rng, 'g'))
    const input = rng.pick<ops.GroupInput>([{ kind: 'repeat', times: 3 }, { kind: 'branch', text: 'Either' }, { kind: 'parallel' }, { kind: 'repeat', times: 500 }])
    return { op: 'putGroup', label: `putGroup ${id} ${group} ${JSON.stringify(input)}`, run: model => ops.putGroup(model, id, group, input) }
  },
  removeGroup: (m, rng) => {
    const id = flow(m, rng)
    const group = among(rng, groupsOf(m, id), 'nope')
    return { op: 'removeGroup', label: `removeGroup ${id} ${group}`, run: model => ops.removeGroup(model, id, group) }
  },
  putAnalysis: (m, rng) => {
    const id = rng.chance(0.4) && analysisIds(m).length ? rng.pick(analysisIds(m)) : fresh(rng, 'a')
    const views = ['root', ...objectIds(m).filter(v => isView(m, v))]
    const input: ops.AnalysisInput = {
      id, name: `Analysis ${id}`, scope: rng.chance(0.7) ? (rng.chance(0.05) ? shape(m, rng) : rng.pick(views)) : undefined,
      modes: Object.fromEntries(Array.from({ length: 1 + rng.int(3) }, (_, i) => [`m${i}`, modeInput(m, rng)])),
    }
    return { op: 'putAnalysis', label: `putAnalysis ${id} scope ${input.scope ?? '-'}`, call: { tool: 'put_failures', args: input }, run: model => ops.putAnalysis(model, input) }
  },
  updateAnalysis: (m, rng) => {
    const id = analysis(m, rng)
    const changes = rng.pick<{ name?: string; about?: string; scope?: string }>([{ name: 'Renamed' }, { about: 'About.' }, { scope: shape(m, rng) }, { scope: '' }, { name: '' }])
    return { op: 'updateAnalysis', label: `updateAnalysis ${id} ${JSON.stringify(changes)}`, run: model => ops.updateAnalysis(model, id, changes) }
  },
  deleteAnalysis: (m, rng) => {
    const id = analysis(m, rng)
    return { op: 'deleteAnalysis', label: `deleteAnalysis ${id}`, call: { tool: 'delete_failures', args: { id } }, run: model => ops.deleteAnalysis(model, id) }
  },
  putMode: (m, rng) => {
    const aid = analysis(m, rng)
    const mid = rng.chance(0.4) ? among(rng, modesOf(m, aid), 'x') : fresh(rng, 'm')
    const input = modeInput(m, rng)
    return { op: 'putMode', label: `putMode ${aid}/${mid} ${JSON.stringify({ on: input.on, from: input.from, to: input.to })}`, call: { tool: 'put_failure', args: { analysis: aid, id: mid, ...input } }, run: model => ops.putMode(model, aid, mid, input) }
  },
  updateMode: (m, rng) => {
    const aid = analysis(m, rng)
    const mid = among(rng, modesOf(m, aid), 'x')
    const changes = rng.pick<ops.ModeChanges>([{ on: shape(m, rng) }, { severity: String(rating(rng)) }, { status: 'done' }, { flow: flow(m, rng), step: '2' }, { from: shape(m, rng), to: shape(m, rng) }, { on: '' }])
    return { op: 'updateMode', label: `updateMode ${aid}/${mid} ${JSON.stringify(changes)}`, run: model => ops.updateMode(model, aid, mid, changes) }
  },
  deleteMode: (m, rng) => {
    const aid = analysis(m, rng)
    const mid = among(rng, modesOf(m, aid), 'x')
    return { op: 'deleteMode', label: `deleteMode ${aid}/${mid}`, call: { tool: 'delete_failure', args: { analysis: aid, id: mid } }, run: model => ops.deleteMode(model, aid, mid) }
  },
  placeBoxes: (m, rng) => {
    const view = rng.pick(['root', ...objectIds(m)])
    const boxes = Object.fromEntries(rng.some(objectIds(m), 3).map(id => [id, [rng.int(900), rng.int(600)] as [number, number]]))
    return { op: 'placeBoxes', label: `placeBoxes ${view} ${Object.keys(boxes).join(',')}`, run: model => ops.placeBoxes(model, view, boxes) }
  },
  forgetLayout: (m, rng) => {
    const view = rng.pick(['root', ...Object.keys(m.layout), 'ghost'])
    return { op: 'forgetLayout', label: `forgetLayout ${view}`, run: model => ops.forgetLayout(model, view) }
  },
  setLines: (_, rng) => {
    const style = rng.pick<'straight' | 'curved' | 'angled' | undefined>(['straight', 'curved', 'angled', undefined])
    return { op: 'setLines', label: `setLines ${style}`, run: model => ops.setLines(model, style) }
  },
  putIcon: (_, rng) => {
    const name = fresh(rng, 'icon')
    return { op: 'putIcon', label: `putIcon ${name}`, call: { tool: 'put_icon', args: { name, path: 'M0 0h10v10z' } }, run: model => ops.putIcon(model, name, 'M0 0h10v10z') }
  },
  deleteIcon: (m, rng) => {
    const names = Object.keys((m.meta.icons as Record<string, unknown> | undefined) ?? {})
    const name = among(rng, names, 'nope')
    return { op: 'deleteIcon', label: `deleteIcon ${name}`, call: { tool: 'delete_icon', args: { name } }, run: model => ops.deleteIcon(model, name) }
  },
}
