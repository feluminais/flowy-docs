import { check, newProblems } from './check.ts'
import { tidyData } from './data.ts'
import type { DataInput } from './data.ts'
import { dependents, describeDependent, lineIndices, needsDecision } from './dependents.ts'
import type { Action, Dependent, Target } from './dependents.ts'
import { analysesText } from './failures.ts'
import { iconProblem } from './look.ts'
import { checkRun } from './perf/check.ts'
import type { Run } from './perf/types.ts'
import type { Shape } from './look.ts'
import { getObject, ID_RULE, isValidId, ROOT } from './model.ts'
import type { Analysis, Connection, Flow, FlowyObject, Group, Layout, LineStyle, Link, Mode, Model, ObjectType, Step } from './model.ts'
import { tidySnippets } from './snippets.ts'
import type { SnippetInput } from './snippets.ts'
import { changeKind, dropGroup, groupRange, joinGroup, leaveGroup, newGroup, stepGroupId, withGroups } from './groups.ts'
import { stateProblems } from './states.ts'
import { GROUP_KINDS, isGroupKind, TIMES_MAX, TIMES_MIN, timesOk } from './structure.ts'
import { hasText, isMap, own } from './text.ts'
import { chain, isView, parentOf } from './views.ts'

/** A refused edit. The message is written for whoever asked for the edit. */
export class OpError extends Error {
  name = 'OpError'
  /** When the edit was refused because other parts depend on what it deletes: the rows that need a decision (see dependents), so a caller can show or settle them. */
  dependents?: Dependent[]
  constructor(message: string, dependents?: Dependent[]) {
    super(message)
    if (dependents !== undefined) this.dependents = dependents
  }
}

export type ObjectInput = {
  id: string; type?: ObjectType; name?: string; in?: string; external?: boolean
  /** How it is drawn: "" removes the shape, colour or icon, and an opacity of "" removes that. */
  shape?: Shape | ''; color?: string; opacity?: number | ''; icon?: string
  tech?: string; description?: string; code?: string[]; links?: Link[]
  /** A few lines of code, each with a title and a language if you like (see snippets.ts). Replaces the whole list; [] removes it. */
  snippets?: SnippetInput[]
  /** What a store holds (see data.ts). Replaces the whole list; [] removes it. */
  data?: DataInput[]
}
export type ConnectionInput = { from: string; to: string; label?: string }
/** A group as put_flow gives it: `times` may be a number, which is written as text. */
export type GroupInput = { kind?: string; text?: string; times?: string | number; until?: string; [extra: string]: unknown }
/** `states` is where shapes stand before step 1 (shape id to state word); a step's `states` are the shapes it changes. Left out or empty writes no `states:`. */
export type FlowInput = { id: string; name: string; view: string; steps: Step[]; groups?: Record<string, GroupInput>; states?: Record<string, string> }
/** A failure mode as put_failure gives it: ratings and `step` are numbers, which are written as text. */
export type ModeInput = {
  mode: string; on?: string; from?: string; to?: string; effect?: string; cause?: string
  severity?: number; occurrence?: number; detection?: number
  controls?: string; action?: string; owner?: string; status?: string
  after?: { severity?: number; occurrence?: number; detection?: number }
  affects?: string[]; flow?: string; step?: number; run?: string; description?: string
}
export type AnalysisInput = { id: string; name: string; about?: string; scope?: string; scale?: Analysis['scale']; modes: Record<string, ModeInput> }

const FIELDS = ['type', 'name', 'in', 'external', 'shape', 'color', 'opacity', 'icon', 'tech', 'description', 'code', 'links', 'snippets', 'data'] as const
const CLEARABLE = ['in', 'shape', 'color', 'opacity', 'icon', 'tech', 'description'] as const
const LISTS = ['code', 'links', 'snippets', 'data'] as const

/**
 * Create or update an object. Omitted fields stay as they are; "" removes in, shape, color, opacity, icon, tech or
 * description, [] removes code, links, snippets or data, and external: false removes external.
 * Only the known fields are copied from the input, so a new object's keys always come out
 * in the order type, name, in, external, shape, color, opacity, icon, tech, description, code, links, snippets, data, and stray input keys never land in the model.
 * A link keeps its extra keys, comes out with its title before its url, and loses a blank title. `snippets` and `data` replace the whole list
 * (see tidySnippets and tidyData).
 */
export function putObject(model: Model, { id, ...fields }: ObjectInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid id: ${ID_RULE}`)
  const prev = getObject(model, id)
  if (!prev && (!fields.type || !fields.name)) throw new OpError(`"${id}" doesn't exist yet, so type and name are required`)
  const next: Record<string, unknown> = { ...prev }
  for (const k of FIELDS) if (fields[k] !== undefined) next[k] = fields[k]
  // On disk an opacity is text, like every value: `opacity: 40` reads back as "40".
  if (typeof next.opacity === 'number') next.opacity = String(next.opacity)
  for (const k of CLEARABLE) if (next[k] === '') delete next[k]
  if (fields.links !== undefined) next.links = fields.links.map(({ title, ...rest }) => (title?.trim() ? { title, ...rest } : rest))
  if (fields.snippets !== undefined) next.snippets = tidySnippets(fields.snippets)
  if (fields.data !== undefined) next.data = tidyData(fields.data)
  // A list with nothing in it is no list.
  for (const k of LISTS) if (Array.isArray(next[k]) && next[k].length === 0) delete next[k]
  // On disk it's `external: true`, which the failsafe schema reads back as the text "true".
  if (next.external === true) next.external = 'true'
  else if (next.external === false) delete next.external
  return { ...model, objects: { ...model.objects, [id]: next as FlowyObject } }
}

/** Define a custom icon: `icons: { name: <SVG path data> }` in model.yaml. An existing name is replaced in place. */
export function putIcon(model: Model, name: string, path: string): Model {
  const why = iconProblem(name, path)
  if (why) throw new OpError(`icon ${name} ${why}`)
  const icons = isMap(model.meta.icons) ? model.meta.icons : {}
  return { ...model, meta: { ...model.meta, icons: { ...icons, [name]: path.trim() } } }
}

/** Remove a custom icon. Refused while an object uses it. */
export function deleteIcon(model: Model, name: string): Model {
  const { icons } = model.meta
  if (!isMap(icons) || !Object.hasOwn(icons, name)) throw new OpError(`unknown icon "${name}"`)
  const users = Object.entries(model.objects).filter(([, o]) => o.icon === name).map(([id]) => id)
  if (users.length) throw new OpError(`icon "${name}" is used by ${users.join(', ')}. Change those first.`)
  const { [name]: _, ...rest } = icons as Record<string, unknown>
  const { icons: __, ...meta } = model.meta
  return { ...model, meta: Object.keys(rest).length ? { ...model.meta, icons: rest } : meta }
}

/**
 * Delete a shape and what only exists because of it: its lines, and any state entry or `affects` entry that names it. Refused while anything
 * that needs a decision depends on it (shapes inside it, flow steps and views, failure modes), in the words of whatever is in the way; deleteWith
 * is how those are settled.
 */
export function deleteObject(model: Model, id: string): Model {
  if (id === ROOT && Object.hasOwn(model.objects, ROOT))
    throw new OpError('"root" is reserved, so this object can\'t be changed here. Rename or delete it in model.yaml by hand.')
  if (!getObject(model, id)) throw new OpError(`unknown object "${id}"`)
  const rows = dependents(model, [{ object: id }]).filter(needsDecision)
  const children = rows.filter(r => r.kind === 'child').map(r => r.child)
  if (children.length) throw new OpError(`"${id}" still contains ${children.join(', ')}. Delete or move those first.`, rows)
  const flows = [...new Set(rows.filter(r => r.flow !== undefined).map(r => r.flow))]
  if (flows.length)
    throw new OpError(`"${id}" is used by flow${flows.length > 1 ? 's' : ''} ${flows.join(', ')}. Change or delete those first.`, rows)
  const analyses = [...new Set(rows.map(r => r.analysis).filter(a => a !== undefined))]
  if (analyses.length) throw new OpError(`"${id}" is used by ${analysesText(analyses)}. Change or delete those first.`, rows)
  return deleteWith(model, [{ object: id }], [])
}

/**
 * Delete several objects as one edit. A box and something inside it can go together (the inner one first); any refusal from
 * deleteObject stops the lot, so nothing is half deleted.
 */
export function deleteObjects(model: Model, ids: string[]): Model {
  const deepestFirst = [...new Set(ids)].sort((a, b) => chain(model, b).length - chain(model, a).length)
  return deepestFirst.reduce(deleteObject, model)
}

/** Whether a shape exists to point at: a target of a reroute, a repoint, a new view or a new home. */
const exists = (model: Model, id: unknown): id is string => hasText(id) && getObject(model, id) !== undefined

/** How one row of dependents() is settled: its key, what to do, and where to when the action points somewhere (reroute, repoint, changeView, changeScope, moveOut). */
export type Resolution = { key: string; action: Action; to?: string }

/** The model with the entries of `states` that name a shape in `gone` taken out, and a `states` left empty taken out too. */
function withoutStates(model: Model, gone: ReadonlySet<string>): Model {
  const strip = <T extends { states?: unknown }>(holder: T): T => {
    if (!isMap(holder.states) || !Object.keys(holder.states).some(id => gone.has(id))) return holder
    const { states: _, ...rest } = holder
    const kept = Object.fromEntries(Object.entries(holder.states).filter(([id]) => !gone.has(id)))
    return Object.keys(kept).length === 0 ? (rest as T) : { ...holder, states: kept }
  }
  const flows: Record<string, Flow> = {}
  for (const [fid, flow] of Object.entries(model.flows)) own(flows, fid, { ...strip(flow), steps: flow.steps.map(strip) })
  return { ...model, flows }
}

/**
 * Delete shapes and lines as one edit, settling what depends on them the way `resolutions` say (see dependents). A row that goes with the shape
 * needs no resolution. Refused, nothing changed, when a row that needs one has none, when a resolution does not fit its row or points at
 * something that is going too, or when removing steps would leave a flow with none.
 * Deleting a flow also takes the flow and step off the failure modes that named it, and removing a step moves the modes on later steps up.
 */
export function deleteWith(model: Model, targets: Target[], resolutions: Resolution[]): Model {
  for (const t of targets) {
    if ('object' in t) {
      if (t.object === ROOT && Object.hasOwn(model.objects, ROOT)) throw new OpError('"root" is reserved, so this object can\'t be changed here. Rename or delete it in model.yaml by hand.')
      if (!getObject(model, t.object)) throw new OpError(`unknown object "${t.object}"`)
    } else if (lineIndices(model, t.line).length === 0) {
      const { from, to, label } = t.line
      throw new OpError(`no connection ${from} → ${to}${label ? ` labelled "${label}"` : ''}`)
    }
  }
  const chosen = new Map<string, Resolution>()
  for (const r of resolutions) {
    if (chosen.has(r.key)) throw new OpError(`"${r.key}" is settled twice`)
    chosen.set(r.key, r)
  }
  // A shape inside a deleted one goes too when it was chosen to, and then what depends on it is a row of its own.
  let all = targets
  let rows = dependents(model, all)
  const known = new Set(rows.map(r => r.key))
  for (;;) {
    const more = rows.filter(r => r.kind === 'child' && chosen.get(r.key)?.action === 'deleteWith').map(r => r.child as string)
    if (more.length === 0) break
    all = [...all, ...more.map(object => ({ object }))]
    rows = dependents(model, all)
    for (const r of rows) known.add(r.key)
  }
  const unknown = resolutions.find(r => !known.has(r.key))
  if (unknown) throw new OpError(`nothing is waiting on "${unknown.key}"`)
  const needless = rows.find(r => !needsDecision(r) && chosen.has(r.key))
  if (needless) throw new OpError(`${describeDependent(needless)} goes along with the shape, so it needs no choice`)

  const gone = new Set(all.flatMap(t => ('object' in t ? [t.object] : [])))
  const doomed = new Set(rows.filter(r => chosen.get(r.key)?.action === 'deleteFlow').map(r => r.flow as string))
  const decided = rows.filter(needsDecision).filter(r => r.flow === undefined || !doomed.has(r.flow)).map((row): [Dependent, Resolution] => {
    const r = chosen.get(row.key)
    if (!r) throw new OpError(`${describeDependent(row)} needs a choice: ${row.actions.join(', ')}`)
    if (!row.actions.includes(r.action)) throw new OpError(`${r.action} is not one of the choices for ${describeDependent(row)}: ${row.actions.join(', ')}`)
    return [row, r]
  })
  const pointed = (row: Dependent, r: Resolution): string => {
    if (!exists(model, r.to) || gone.has(r.to)) throw new OpError(`${r.action} for ${describeDependent(row)} needs "to": a shape that stays`)
    return r.to
  }
  const viewed = (row: Dependent, r: Resolution): string => {
    const to = r.to ?? ROOT
    if (gone.has(to) || !isView(model, to)) throw new OpError(`${r.action} for ${describeDependent(row)} needs "to": "root" or a shape with shapes inside it that stays`)
    return to
  }
  const of = (kind: Dependent['kind'], action?: Action) => decided.filter(([row, r]) => row.kind === kind && (action === undefined || r.action === action))

  let m = model
  for (const fid of doomed) {
    m = deleteFlow(editModes(m, mode => {
      if (mode.flow !== fid) return undefined
      const { flow: _f, step: _s, ...rest } = mode
      return rest
    }), fid)
  }
  for (const [row, r] of of('view', 'changeView')) {
    const flow = m.flows[row.flow as string]
    m = setFlow(m, row.flow as string, { ...flow, view: viewed(row, r) })
  }
  const stepFlows = [...new Set(of('step').map(([row]) => row.flow as string))]
  for (const fid of stepFlows) {
    const mine = of('step').filter(([row]) => row.flow === fid)
    const reroutes = mine.filter(([, r]) => r.action === 'reroute')
    if (reroutes.length) {
      const to = new Map(reroutes.map(([row, r]) => [(row.step as number) - 1, [row.ends as ('from' | 'to')[], pointed(row, r)] as const]))
      m = withFlow(m, fid, flow => ({ ...flow, steps: flow.steps.map((s, i) => (to.has(i) ? { ...s, ...Object.fromEntries(to.get(i)![0].map(end => [end, to.get(i)![1]])) } : s)) }))
    }
    const removals = mine.filter(([, r]) => r.action === 'removeStep').map(([row]) => (row.step as number) - 1).sort((a, b) => b - a)
    if (removals.length && removals.length === m.flows[fid].steps.length)
      throw new OpError(`Removing those steps would leave flow ${fid} with no steps. Delete the flow instead.`)
    for (const index of removals) m = removeStep(m, fid, index)
  }
  m = withoutStates(m, gone)

  const mark = (aid: string, mid: string) => `${aid}\0${mid}`
  const removed = new Set(of('mode', 'removeMode').map(([row]) => mark(row.analysis as string, row.mode as string)))
  const repoints = new Map<string, [string, string][]>()
  for (const [row, r] of of('mode', 'repoint')) {
    const k = mark(row.analysis as string, row.mode as string)
    repoints.set(k, [...(repoints.get(k) ?? []), [row.part as string, pointed(row, r)]])
  }
  m = editModes(m, (mode, aid, mid) => {
    const k = mark(aid, mid)
    if (removed.has(k)) return null
    let next: Mode = mode
    for (const [part, to] of repoints.get(k) ?? []) next = { ...next, [part]: to }
    if (Array.isArray(next.affects) && next.affects.some(id => gone.has(id))) {
      const kept = next.affects.filter(id => !gone.has(id))
      const { affects: _, ...rest } = next
      next = kept.length === 0 ? rest : { ...next, affects: kept }
    }
    return next === mode ? undefined : next
  })
  for (const [row, r] of of('scope', 'changeScope')) {
    const a = m.failures[row.analysis as string]
    const to = viewed(row, r)
    const { scope: _, ...rest } = a
    m = setAnalysis(m, row.analysis as string, to === ROOT ? (rest as Analysis) : { ...a, scope: to })
  }

  const objects = { ...m.objects }
  for (const [row, r] of of('child', 'moveOut')) {
    const child = row.child as string
    let home = r.to ?? parentOf(model, row.of)
    if (r.to === undefined) while (gone.has(home)) home = parentOf(model, home)
    if (home !== ROOT && (!exists(model, home) || gone.has(home))) throw new OpError(`moveOut for ${describeDependent(row)} needs "to": "root" or a shape that stays`)
    const { in: _, ...rest } = objects[child]
    objects[child] = (home === ROOT ? rest : { ...objects[child], in: home }) as FlowyObject
  }
  for (const id of gone) delete objects[id]
  const cut = new Set(targets.flatMap(t => ('line' in t ? lineIndices(model, t.line) : [])))
  const connections = m.connections.filter((c, i) => !cut.has(i) && !gone.has(c.from) && !gone.has(c.to))
  return { ...m, objects, connections }
}

/** Add a connection. An empty label means no label. */
export function connect(model: Model, { from, to, label }: ConnectionInput): Model {
  for (const end of [from, to]) if (!getObject(model, end)) throw new OpError(`unknown object "${end}"`)
  const c: Connection = label ? { from, to, label } : { from, to }
  return { ...model, connections: [...model.connections, c] }
}

/** Remove from → to connections. With a label, only the ones carrying it; "" means the unlabelled ones. */
export function disconnect(model: Model, { from, to, label }: ConnectionInput): Model {
  const sameEnds = (c: Connection) => c.from === from && c.to === to
  const matches = (c: Connection) => sameEnds(c) && (label === undefined || (c.label ?? '') === label)
  if (!model.connections.some(matches)) {
    const existing = model.connections.filter(sameEnds).map(c => (c.label ? `"${c.label}"` : 'one without a label'))
    throw new OpError(`no connection ${from} → ${to}${label === undefined ? '' : ` labelled "${label}"`}`
      + (existing.length ? ` (there is ${existing.join(', ')})` : ''))
  }
  const connections = model.connections.filter(c => !matches(c))
  refuseLineUsers(model, { from, to, ...(label === undefined ? {} : { label }), all: true })
  return { ...model, connections }
}

/** Refuses a change that would leave a line mode with no connection from → to, as a flow's shapes can't be deleted from under it. The refusal carries the rows. */
function refuseLineUsers(model: Model, line: { from: string; to: string; label?: string; all?: boolean }) {
  const rows = dependents(model, [{ line }]).filter(needsDecision)
  const analyses = [...new Set(rows.map(r => r.analysis).filter(a => a !== undefined))]
  if (analyses.length) throw new OpError(`connection ${line.from} → ${line.to} is used by ${analysesText(analyses)}. Change or delete those first.`, rows)
}

/** Where the first from → to connection labelled `label` ("" or none: unlabelled) is. */
function findConnection(model: Model, { from, to, label = '' }: ConnectionInput): number {
  const i = model.connections.findIndex(c => c.from === from && c.to === to && (c.label ?? '') === label)
  if (i === -1) throw new OpError(`no connection ${from} → ${to} ${label ? `labelled "${label}"` : 'without a label'}`)
  return i
}

/** Remove one connection: the first that matches. Unlike disconnect, exact duplicates go one at a time. */
export function removeConnection(model: Model, which: ConnectionInput): Model {
  const connections = model.connections.toSpliced(findConnection(model, which), 1)
  refuseLineUsers(model, { from: which.from, to: which.to, label: which.label ?? '' })
  return { ...model, connections }
}

/** Give one connection (the first that matches) a new label, in place. "" removes the label. */
export function relabel(model: Model, which: ConnectionInput, label: string): Model {
  const i = findConnection(model, which)
  const { label: _, ...rest } = model.connections[i]
  return { ...model, connections: model.connections.with(i, label ? { ...model.connections[i], label } : rest) }
}

/** The model with this flow (new, or replacing the one of that id). */
const setFlow = (model: Model, id: string, flow: Flow): Model => ({ ...model, flows: { ...model.flows, [id]: flow } })

/** The model with an existing flow changed: `change` gets the flow and returns what replaces it. An unknown flow, or one with an invalid file name, is refused first. */
const withFlow = (model: Model, id: string, change: (flow: Flow) => Flow): Model => setFlow(model, id, change(existingFlow(model, id)))

/** The model with this analysis (new, or replacing the one of that id). */
const setAnalysis = (model: Model, id: string, analysis: Analysis): Model => ({ ...model, failures: { ...model.failures, [id]: analysis } })

/** The model with an existing analysis changed, as withFlow does for a flow. */
const withAnalysis = (model: Model, id: string, change: (analysis: Analysis) => Analysis): Model => setAnalysis(model, id, change(existingAnalysis(model, id)))

/** Flow and analysis ids are file names, and Windows and macOS don't tell Visit.yaml from visit.yaml: refuses an id that differs from another only in case. */
function refuseCaseClash(table: object, id: string, dir: 'flows' | 'failures'): void {
  const clash = Object.keys(table).find(other => other !== id && other.toLowerCase() === id.toLowerCase())
  if (clash) throw new OpError(`${dir}/${clash}.yaml already exists and differs only in case. Rename or delete that file by hand.`)
}

/** The entry of a table of flows or analyses, refused when there is none or when its file name is not a valid id (so it can't be changed here). */
function existingEntry<T>(table: Record<string, T>, id: string, noun: 'flow' | 'analysis', dir: 'flows' | 'failures'): T {
  if (!Object.hasOwn(table, id)) throw new OpError(`unknown ${noun} "${id}"`)
  if (!isValidId(id)) throw new OpError(`${dir}/${id}.yaml has an invalid file name, so it can't be changed here. Rename or delete it by hand.`)
  return table[id]
}

const existingFlow = (model: Model, id: string): Flow => existingEntry(model.flows, id, 'flow', 'flows')
const existingAnalysis = (model: Model, id: string): Analysis => existingEntry(model.failures, id, 'analysis', 'failures')

/** An animation with its numbers (share, at) as text, which is how a file holds them: a number cannot be written. Anything else is left for the checker. */
function animationAsText(animation: unknown): unknown {
  if (!isMap(animation)) return animation
  return Object.fromEntries(Object.entries(animation).map(([key, value]) => [key, (key === 'share' || key === 'at') && typeof value === 'number' ? String(value) : value]))
}

/** Create or replace a flow. Replacing drops everything the old flow had, hand-written extra keys included. */
export function putFlow(model: Model, { id, name, view, steps, groups, states }: FlowInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid flow id: ${ID_RULE}`)
  refuseCaseClash(model.flows, id, 'flows')
  // A blank detail is no detail, as on the canvas, so the file stays as short as it can be. An empty `states` is none, too.
  const copy = (s: Step): Step => {
    const out: Record<string, unknown> = { ...s }
    if (typeof s.description === 'string' && !s.description.trim()) delete out.description
    if (isMap(s.states) && Object.keys(s.states).length === 0) delete out.states
    // A number in an animation (share, at) is written as text, as a file holds it.
    if ('animation' in out) out.animation = animationAsText(out.animation)
    return out as Step
  }
  // On disk a number is text, like every value: `times: 3` reads back as "3". No groups, or an empty set, writes no `groups:`.
  const text = (g: GroupInput): Group => (typeof g.times === 'number' ? { ...g, times: String(g.times) } : g) as Group
  const written = groups && Object.keys(groups).length > 0 ? { groups: Object.fromEntries(Object.entries(groups).map(([gid, g]) => [gid, text(g)])) } : {}
  // Where shapes stand before step 1 goes right after the view, as the guide shows it.
  const start = states && Object.keys(states).length > 0 ? { states } : {}
  return setFlow(model, id, { name, view, ...start, ...written, steps: steps.map(copy) })
}

/** Change an existing flow's name, steps or groups, keeping everything else it has (and its groups when not given any). */
export function updateFlow(model: Model, id: string, changes: Partial<Pick<Flow, 'name' | 'steps' | 'groups'>>): Model {
  const { groups, ...rest } = changes
  return withFlow(model, id, old => {
    const flow = { ...old, ...rest }
    return 'groups' in changes ? withGroups(flow, groups) : flow
  })
}

/** The keys of a step in the order the guide shows them; a key set later goes after the nearest earlier one that is there. */
const STEP_ORDER = ['from', 'to', 'text', 'description', 'animation', 'states', 'group', 'lane', 'flow']

/**
 * Set which shapes step `index` changes, as a whole: `states` replaces what the step had, so pass the entries to keep too, and an empty map takes
 * `states` out. Refused for a shape that does not exist or a word that is not a state, in the checker's words. Every other key of the step is kept.
 */
export function setStepStates(model: Model, flowId: string, index: number, states: Record<string, string>): Model {
  return withFlow(model, flowId, flow => {
    const step = existingStep(flow, flowId, index)
    const [why] = stateProblems({ name: '', view: '', steps: [{ from: '', text: '', states }] }, [], id => getObject(model, id) !== undefined)
    if (why !== undefined) throw new OpError(why.message)
    const next = withChanges(step, { states: Object.keys(states).length === 0 ? undefined : { ...states } }, STEP_ORDER) as Step
    return { ...flow, steps: flow.steps.with(index, next) }
  })
}

function existingStep(flow: Flow, id: string, index: number): Step {
  if (!Number.isInteger(index) || index < 0 || index >= flow.steps.length) throw new OpError(`flow "${id}" has no step ${index + 1}`)
  return flow.steps[index]
}

/**
 * Remove step `index` of a flow without breaking its groups: when it started a lane and the next step of that group has none, that step takes
 * the label, and a group whose last member goes is taken out with it.
 */
export function removeStep(model: Model, id: string, index: number): Model {
  const next = withFlow(model, id, flow => {
    existingStep(flow, id, index)
    const { steps, groups } = leaveGroup(flow, index)
    steps.splice(index, 1)
    return withGroups({ ...flow, steps }, groups)
  })
  return renumberModes(next, id, index + 1)
}

/**
 * The model with every failure mode run through `change`: it returns the mode to put in its place, null to take the mode out, or undefined to
 * leave it. Only the analyses that change are copied, and a mode keeps its place.
 */
function editModes(model: Model, change: (mode: Mode, analysis: string, id: string) => Mode | null | undefined): Model {
  const failures: Record<string, Analysis> = {}
  let any = false
  for (const [aid, a] of Object.entries(model.failures)) {
    const results = Object.entries(a.modes).map(([mid, m]) => [mid, change(m, aid, mid)] as const)
    if (results.every(([, r]) => r === undefined)) {
      own(failures, aid, a)
      continue
    }
    any = true
    const modes: Record<string, Mode> = {}
    for (const [mid, r] of results) if (r !== null) own(modes, mid, r ?? a.modes[mid])
    own(failures, aid, { ...a, modes })
  }
  return any ? { ...model, failures } : model
}

/**
 * Failure modes that name a step of this flow, once step `removed` (counting from 1) is taken out: a mode on a later step moves up one, and a mode
 * on the removed step keeps its flow and loses its step.
 */
function renumberModes(model: Model, flowId: string, removed: number): Model {
  return editModes(model, m => {
    const n = m.flow === flowId && hasText(m.step) && /^[1-9]\d*$/.test(m.step) ? Number(m.step) : 0
    if (n < removed) return undefined
    const { step: _, ...rest } = m
    return n === removed ? rest : { ...m, step: String(n - 1) }
  })
}

/**
 * Set what step `index` of a flow plays: a kind, or a mapping with a kind (`{ kind: call, outcome: rejected, reason: Rate limit }`), as put_flow takes it. A mapping
 * has its numbers written as text, as a file holds them. `undefined` takes the animation away. The step keeps its other keys, and an `animation` it already has
 * keeps its place. Whether the animation is allowed is the checker's to say when the edit is saved, in the words put_flow is refused with.
 */
export function setStepAnimation(model: Model, id: string, index: number, animation: Record<string, unknown> | string | undefined): Model {
  return withFlow(model, id, flow => {
    const step = existingStep(flow, id, index)
    const steps = [...flow.steps]
    if (animation === undefined || animation === '') {
      const { animation: _, ...rest } = step
      steps[index] = rest as Step
    } else steps[index] = { ...step, animation: animationAsText(animation) }
    return { ...flow, steps }
  })
}

/**
 * Put step `index` in the declared group `group` ("" takes it out of its group). It leaves its old group first, as in removeStep. A repeat has
 * no lanes. In a branch or parallel group a step that comes before the others takes over the label of the first lane, which it joins at the
 * front, and in a group with no other step it starts "Lane 1".
 */
export function setStepGroup(model: Model, id: string, index: number, group: string): Model {
  const flow = existingFlow(model, id)
  const step = existingStep(flow, id, index)
  const to = group.trim()
  if (to !== '' && !(flow.groups !== undefined && Object.hasOwn(flow.groups, to))) throw new OpError(`unknown group "${group}"`)
  if (stepGroupId(step) === to) return model
  const left = leaveGroup(flow, index)
  const steps = to === '' ? left.steps : joinGroup(left.steps, index, to, flow.groups![to].kind)
  return setFlow(model, id, withGroups({ ...flow, steps }, left.groups))
}

/**
 * Give an existing group another kind. A repeat keeps its `times` and `until` (and gets `times: "3"` when it has neither), the others drop
 * them; members lose their lanes when it becomes a repeat, and when it becomes a branch or parallel group its first step starts "Lane 1"
 * (and, for parallel, every other step that starts no lane starts one of its own unless two lanes are there already).
 */
export function setGroupKind(model: Model, id: string, group: string, kind: string): Model {
  return withFlow(model, id, flow => {
    if (flow.groups === undefined || !Object.hasOwn(flow.groups, group)) throw new OpError(`unknown group "${group}"`)
    if (!isGroupKind(kind)) throw new OpError(`unknown kind "${kind}" (use ${GROUP_KINDS.join(', ')})`)
    const { steps, declared } = changeKind(flow, group, kind)
    return withGroups({ ...flow, steps }, { ...flow.groups, [group]: declared })
  })
}

/**
 * Declare a group and put the steps `first` to `last` (0-based, both included) in it. A repeat is written with `times: "3"`; in a branch or
 * parallel group every step starts a lane of its own ("Lane 1", "Lane 2"…), which the steps' lane labels then reshape.
 */
export function groupSteps(model: Model, id: string, group: string, kind: string, first: number, last: number): Model {
  return withFlow(model, id, flow => {
    if (!isValidId(group)) throw new OpError(`"${group}" is not a valid group id: ${ID_RULE}`)
    if (flow.groups !== undefined && Object.hasOwn(flow.groups, group)) throw new OpError(`group "${group}" already exists`)
    if (!isGroupKind(kind)) throw new OpError(`unknown kind "${kind}" (use ${GROUP_KINDS.join(', ')})`)
    existingStep(flow, id, first)
    existingStep(flow, id, last)
    if (last < first) throw new OpError(`step ${last + 1} comes before step ${first + 1}`)
    for (let i = first; i <= last; i++) {
      const other = stepGroupId(flow.steps[i])
      if (other !== '') throw new OpError(`step ${i + 1} is already in group "${other}"`)
    }
    return withGroups({ ...flow, steps: groupRange(flow.steps, group, kind, first, last) }, { ...(flow.groups ?? {}), [group]: newGroup(kind) })
  })
}

/** Create or replace a group of a flow. `times` may be a number, which is written as text; a blank `times`, `until` or `text` is left out. */
export function putGroup(model: Model, flowId: string, id: string, group: GroupInput): Model {
  return withFlow(model, flowId, flow => {
    if (!isValidId(id)) throw new OpError(`"${id}" is not a valid group id: ${ID_RULE}`)
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(group)) {
      if (value === undefined) continue
      const text = typeof value === 'number' ? String(value) : value
      if ((key === 'times' || key === 'until' || key === 'text') && (typeof text !== 'string' || text.trim() === '')) continue
      next[key] = text
    }
    // The checks only refuse a problem that is new, so a bad `times` over an old bad `times` would pass them: this says no first.
    if ('times' in next && !timesOk(next.times)) throw new OpError(`group "${id}": times must be a whole number from ${TIMES_MIN} to ${TIMES_MAX}`)
    return withGroups(flow, { ...(flow.groups ?? {}), [id]: next as Group })
  })
}

/** Remove a group's declaration, and the group and lane of every step that named it. */
export function removeGroup(model: Model, flowId: string, id: string): Model {
  return withFlow(model, flowId, flow => {
    if (flow.groups === undefined || !Object.hasOwn(flow.groups, id)) throw new OpError(`unknown group "${id}"`)
    const { [id]: _, ...rest } = flow.groups
    return withGroups({ ...flow, steps: dropGroup(flow.steps, id) }, rest)
  })
}

export function deleteFlow(model: Model, id: string): Model {
  existingFlow(model, id)
  const flows = { ...model.flows }
  delete flows[id]
  return { ...model, flows }
}

/** A mode as it is written to a file: fields in a stable order, numbers as text, a blank string or an empty list left out. */
function modeOf(input: ModeInput): Mode {
  const out: Record<string, unknown> = {}
  const text = (key: keyof ModeInput) => {
    const v = input[key]
    if (typeof v === 'string' && v.trim() !== '') out[key] = v
  }
  const number = (key: keyof ModeInput) => {
    const v = input[key]
    if (typeof v === 'number') out[key] = String(v)
  }
  for (const key of ['mode', 'on', 'from', 'to', 'effect', 'cause'] as const) text(key)
  for (const key of ['severity', 'occurrence', 'detection'] as const) number(key)
  for (const key of ['controls', 'action', 'owner', 'status'] as const) text(key)
  const after = Object.fromEntries((['severity', 'occurrence', 'detection'] as const).flatMap(k => (typeof input.after?.[k] === 'number' ? [[k, String(input.after[k])]] : [])))
  if (Object.keys(after).length > 0) out.after = after
  if (input.affects?.length) out.affects = [...input.affects]
  text('flow')
  number('step')
  text('run')
  text('description')
  return out as Mode
}

/** Create or replace a failure analysis. Replacing drops everything the old one had, hand-written extra keys included. */
export function putAnalysis(model: Model, { id, name, about, scope, scale, modes }: AnalysisInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid analysis id: ${ID_RULE}`)
  refuseCaseClash(model.failures, id, 'failures')
  const written: Record<string, Mode> = {}
  for (const [mid, input] of Object.entries(modes)) own(written, mid, modeOf(input))
  const analysis: Analysis = {
    name,
    ...(hasText(about) ? { about } : {}),
    ...(hasText(scope) ? { scope } : {}),
    ...(scale && Object.keys(scale).length > 0 ? { scale } : {}),
    modes: written,
  }
  return setAnalysis(model, id, analysis)
}

export function deleteAnalysis(model: Model, id: string): Model {
  existingAnalysis(model, id)
  const failures = { ...model.failures }
  delete failures[id]
  return { ...model, failures }
}

/** Create or replace one mode of an analysis, keeping its place. Replacing drops everything the old mode had. */
export function putMode(model: Model, analysisId: string, id: string, input: ModeInput): Model {
  return withAnalysis(model, analysisId, analysis => {
    const modes = { ...analysis.modes }
    own(modes, id, modeOf(input))
    return { ...analysis, modes }
  })
}

export function deleteMode(model: Model, analysisId: string, id: string): Model {
  return withAnalysis(model, analysisId, analysis => {
    if (!Object.hasOwn(analysis.modes, id)) throw new OpError(`unknown failure mode "${id}" in "${analysisId}"`)
    const modes = { ...analysis.modes }
    delete modes[id]
    return { ...analysis, modes }
  })
}

const MODE_ORDER = ['mode', 'on', 'from', 'to', 'effect', 'cause', 'severity', 'occurrence', 'detection', 'controls', 'action', 'owner', 'status', 'after', 'affects', 'flow', 'step', 'run', 'description']
const ANALYSIS_ORDER = ['name', 'about', 'scope', 'scale', 'modes']
const RATING_ORDER = ['severity', 'occurrence', 'detection']

/**
 * `fields` with `changes` applied; an `undefined` in `changes` removes the key. A key that is already there keeps its place, a new one goes
 * just after the nearest earlier key of `order` that is present (at the front when none is), and a key `order` does not know stays where it was.
 */
function withChanges(fields: object, changes: Record<string, unknown>, order: readonly string[]): Record<string, unknown> {
  const entries = Object.entries(fields)
  for (const [key, value] of Object.entries(changes)) {
    const at = entries.findIndex(([k]) => k === key)
    if (value === undefined) {
      if (at !== -1) entries.splice(at, 1)
    } else if (at !== -1) {
      entries[at] = [key, value]
    } else {
      let after = -1
      let nearest = -1
      entries.forEach(([k], i) => {
        const rank = order.indexOf(k)
        if (rank !== -1 && rank < order.indexOf(key) && rank > nearest) [nearest, after] = [rank, i]
      })
      entries.splice(after + 1, 0, [key, value])
    }
  }
  return Object.fromEntries(entries)
}

/** What the edit forms change on a mode: a text field set to the text (blank removes it), `after` per rating, `affects` as a list (empty removes it). */
export type ModeChanges = Partial<Record<'mode' | 'on' | 'from' | 'to' | 'effect' | 'cause' | 'severity' | 'occurrence' | 'detection' | 'controls' | 'action' | 'owner' | 'status' | 'flow' | 'step' | 'run' | 'description', string>>
  & { after?: Partial<Record<'severity' | 'occurrence' | 'detection', string>>; affects?: string[] }

/** Whitespace-only text. Unlike text.ts's blank, it takes text only, so a value that is not text throws. */
const emptied = (v: string) => v.trim() === ''

/** Change some fields of one mode and nothing else: unlike putMode, what a hand wrote there is kept, and a field stays where it is in the file. */
export function updateMode(model: Model, analysisId: string, id: string, changes: ModeChanges): Model {
  return withAnalysis(model, analysisId, analysis => {
    if (!Object.hasOwn(analysis.modes, id)) throw new OpError(`unknown failure mode "${id}" in "${analysisId}"`)
    const old = analysis.modes[id]
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'after') {
        const ratings = withChanges(old.after ?? {}, Object.fromEntries(Object.entries(value as object).map(([k, v]) => [k, emptied(v as string) ? undefined : v])), RATING_ORDER)
        next.after = Object.keys(ratings).length > 0 ? ratings : undefined
      } else if (key === 'affects') next.affects = (value as string[]).length > 0 ? [...(value as string[])] : undefined
      else next[key] = typeof value === 'string' && emptied(value) ? undefined : value
    }
    const modes = { ...analysis.modes }
    own(modes, id, withChanges(old, next, MODE_ORDER) as Mode)
    return { ...analysis, modes }
  })
}

/** Rename an analysis, or set its about and scope (blank removes those two). A blank name is kept, so the checker can refuse it. */
export function updateAnalysis(model: Model, id: string, changes: { name?: string; about?: string; scope?: string }): Model {
  return withAnalysis(model, id, analysis => {
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changes)) next[key] = key !== 'name' && emptied(value) ? undefined : value
    return withChanges(analysis, next, ANALYSIS_ORDER) as Analysis
  })
}

/** Save where boxes sit in one view (layout.yaml). Positions of objects and views that no longer exist are dropped. */
export function placeBoxes(model: Model, view: string, boxes: Record<string, [number, number]>): Model {
  const merged = { ...model.layout, [view]: { ...(Object.hasOwn(model.layout, view) ? model.layout[view] : {}), ...boxes } }
  const layout: Layout = Object.fromEntries(Object.entries(merged).flatMap(([v, saved]) => {
    const kept = Object.entries(saved).filter(([id]) => getObject(model, id))
    return (v === ROOT || getObject(model, v)) && kept.length ? [[v, Object.fromEntries(kept)]] : []
  }))
  return { ...model, layout }
}

/**
 * Set the project's line style: the top-level `lines:` in model.yaml. Straight is the default, so
 * straight or undefined removes the key. A new key goes first; one that's there keeps its place.
 */
export function setLines(model: Model, style: LineStyle | undefined): Model {
  const { lines: _, ...rest } = model.meta
  if (style === undefined || style === 'straight') return { ...model, meta: rest }
  return { ...model, meta: Object.hasOwn(model.meta, 'lines') ? { ...model.meta, lines: style } : { lines: style, ...rest } }
}

/** Forget where boxes were dragged in one view (its part of layout.yaml), so the computed layout shows again. */
export function forgetLayout(model: Model, view: string): Model {
  if (!Object.hasOwn(model.layout, view)) throw new OpError('Nothing to tidy: no shape here was moved by hand.')
  const layout = { ...model.layout }
  delete layout[view]
  return { ...model, layout }
}

/**
 * Refuse an edit that adds problems, naming them. Problems that were already there never block it.
 * `missing` holds the code paths that don't exist, in either model (see check). `runs` are the load-test runs of the folder: a run is a file the edit
 * can't change, so an edit that leaves one naming a shape or a line that is gone is refused, as one that a flow or a failure analysis uses is.
 */
export function refuseNewProblems(before: Model, after: Model, missing: ReadonlySet<string> = new Set(), runs: Record<string, Run> = {}): void {
  const found = (m: Model) => [...check(m, missing), ...Object.entries(runs).flatMap(([id, run]) => checkRun(id, run, m))]
  const added = newProblems(found(before), found(after))
  if (added.length === 0) return
  const byRun = added.some(p => p.file.startsWith('perf/'))
  throw new OpError(`Refused, nothing saved. This would add:\n${added.map(p => `- ${p.file}: ${p.message}`).join('\n')}${byRun ? '\nChange or delete those runs first.' : ''}`)
}
