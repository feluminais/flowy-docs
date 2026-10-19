import { check, newProblems } from './check.ts'
import { iconProblem } from './look.ts'
import type { Shape } from './look.ts'
import { getObject, ID_RULE, isValidId, ROOT } from './model.ts'
import type { Connection, Flow, FlowyObject, Group, Layout, LineStyle, Link, Model, ObjectType, Step } from './model.ts'
import { GROUP_KINDS, isGroupKind, TIMES_MAX, TIMES_MIN, timesOk } from './structure.ts'
import { memberIds } from './views.ts'

/** A refused edit. The message is written for whoever asked for the edit. */
export class OpError extends Error {
  name = 'OpError'
}

export type ObjectInput = {
  id: string; type?: ObjectType; name?: string; in?: string; external?: boolean
  /** How it is drawn: "" removes the shape, colour or icon, and an opacity of "" removes that. */
  shape?: Shape | ''; color?: string; opacity?: number | ''; icon?: string
  tech?: string; description?: string; code?: string[]; links?: Link[]
}
export type ConnectionInput = { from: string; to: string; label?: string }
/** A group as put_flow gives it: `times` may be a number, which is written as text. */
export type GroupInput = { kind?: string; text?: string; times?: string | number; until?: string; [extra: string]: unknown }
export type FlowInput = { id: string; name: string; view: string; steps: Step[]; groups?: Record<string, GroupInput> }

const FIELDS = ['type', 'name', 'in', 'external', 'shape', 'color', 'opacity', 'icon', 'tech', 'description', 'code', 'links'] as const
const CLEARABLE = ['in', 'shape', 'color', 'opacity', 'icon', 'tech', 'description'] as const

/**
 * Create or update an object. Omitted fields stay as they are; "" removes in, shape, color, opacity, icon, tech or
 * description, [] removes code or links, and external: false removes external.
 * Only the known fields are copied from the input, so a new object's keys always come out
 * in the order type, name, in, external, shape, color, opacity, icon, tech, description, code, links, and stray input keys never land in the model.
 * A link keeps its extra keys, comes out with its title before its url, and loses a blank title.
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
  if (Array.isArray(next.code) && next.code.length === 0) delete next.code
  if (fields.links !== undefined) next.links = fields.links.map(({ title, ...rest }) => (title?.trim() ? { title, ...rest } : rest))
  if (Array.isArray(next.links) && next.links.length === 0) delete next.links
  // On disk it's `external: true`, which the failsafe schema reads back as the text "true".
  if (next.external === true) next.external = 'true'
  else if (next.external === false) delete next.external
  return { ...model, objects: { ...model.objects, [id]: next as FlowyObject } }
}

/** Define a custom icon: `icons: { name: <SVG path data> }` in model.yaml. An existing name is replaced in place. */
export function putIcon(model: Model, name: string, path: string): Model {
  const why = iconProblem(name, path)
  if (why) throw new OpError(`icon ${name} ${why}`)
  const icons = typeof model.meta.icons === 'object' && model.meta.icons !== null && !Array.isArray(model.meta.icons) ? model.meta.icons : {}
  return { ...model, meta: { ...model.meta, icons: { ...icons, [name]: path.trim() } } }
}

/** Remove a custom icon. Refused while an object uses it. */
export function deleteIcon(model: Model, name: string): Model {
  const { icons } = model.meta
  if (typeof icons !== 'object' || icons === null || Array.isArray(icons) || !Object.hasOwn(icons, name)) throw new OpError(`unknown icon "${name}"`)
  const users = Object.entries(model.objects).filter(([, o]) => o.icon === name).map(([id]) => id)
  if (users.length) throw new OpError(`icon "${name}" is used by ${users.join(', ')}. Change those first.`)
  const { [name]: _, ...rest } = icons as Record<string, unknown>
  const { icons: __, ...meta } = model.meta
  return { ...model, meta: Object.keys(rest).length ? { ...model.meta, icons: rest } : meta }
}

export function deleteObject(model: Model, id: string): Model {
  if (id === ROOT && Object.hasOwn(model.objects, ROOT))
    throw new OpError('"root" is reserved, so this object can\'t be changed here. Rename or delete it in model.yaml by hand.')
  if (!getObject(model, id)) throw new OpError(`unknown object "${id}"`)
  const children = memberIds(model, id)
  if (children.length) throw new OpError(`"${id}" still contains ${children.join(', ')}. Delete or move those first.`)
  const flows = Object.entries(model.flows)
    .filter(([, f]) => f.view === id || f.steps.some(s => s.from === id || s.to === id))
    .map(([fid]) => fid)
  if (flows.length)
    throw new OpError(`"${id}" is used by flow${flows.length > 1 ? 's' : ''} ${flows.join(', ')}. Change or delete those first.`)
  const objects = { ...model.objects }
  delete objects[id]
  return { ...model, objects, connections: model.connections.filter(c => c.from !== id && c.to !== id) }
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
  return { ...model, connections: model.connections.filter(c => !matches(c)) }
}

/** Where the first from → to connection labelled `label` ("" or none: unlabelled) is. */
function findConnection(model: Model, { from, to, label = '' }: ConnectionInput): number {
  const i = model.connections.findIndex(c => c.from === from && c.to === to && (c.label ?? '') === label)
  if (i === -1) throw new OpError(`no connection ${from} → ${to} ${label ? `labelled "${label}"` : 'without a label'}`)
  return i
}

/** Remove one connection: the first that matches. Unlike disconnect, exact duplicates go one at a time. */
export function removeConnection(model: Model, which: ConnectionInput): Model {
  return { ...model, connections: model.connections.toSpliced(findConnection(model, which), 1) }
}

/** Give one connection (the first that matches) a new label, in place. "" removes the label. */
export function relabel(model: Model, which: ConnectionInput, label: string): Model {
  const i = findConnection(model, which)
  const { label: _, ...rest } = model.connections[i]
  return { ...model, connections: model.connections.with(i, label ? { ...model.connections[i], label } : rest) }
}

/** Create or replace a flow. Replacing drops everything the old flow had, hand-written extra keys included. */
export function putFlow(model: Model, { id, name, view, steps, groups }: FlowInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid flow id: ${ID_RULE}`)
  // Flow ids are file names, and Windows and macOS don't tell Visit.yaml from visit.yaml.
  const clash = Object.keys(model.flows).find(other => other !== id && other.toLowerCase() === id.toLowerCase())
  if (clash) throw new OpError(`flows/${clash}.yaml already exists and differs only in case. Rename or delete that file by hand.`)
  // A blank detail is no detail, as on the canvas, so the file stays as short as it can be.
  const copy = (s: Step): Step => {
    const { description, ...rest } = s
    return typeof description === 'string' && !description.trim() ? rest as Step : { ...s }
  }
  // On disk a number is text, like every value: `times: 3` reads back as "3". No groups, or an empty set, writes no `groups:`.
  const text = (g: GroupInput): Group => (typeof g.times === 'number' ? { ...g, times: String(g.times) } : g) as Group
  const written = groups && Object.keys(groups).length > 0 ? { groups: Object.fromEntries(Object.entries(groups).map(([gid, g]) => [gid, text(g)])) } : {}
  return { ...model, flows: { ...model.flows, [id]: { name, view, ...written, steps: steps.map(copy) } } }
}

function existingFlow(model: Model, id: string): Flow {
  if (!Object.hasOwn(model.flows, id)) throw new OpError(`unknown flow "${id}"`)
  if (!isValidId(id)) throw new OpError(`flows/${id}.yaml has an invalid file name, so it can't be changed here. Rename or delete it by hand.`)
  return model.flows[id]
}

/**
 * The flow with these groups: replaced where its `groups:` already is, else put just before the steps, so the file reads name, view, groups,
 * steps. No groups, or none left, takes the section out.
 */
function withGroups(flow: Flow, groups: Record<string, Group> | undefined): Flow {
  const none = groups === undefined || Object.keys(groups).length === 0
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flow)) {
    if (key === 'groups') {
      if (!none) out.groups = groups
      continue
    }
    if (key === 'steps' && !none && !('groups' in flow)) out.groups = groups
    out[key] = value
  }
  return out as Flow
}

/** Change an existing flow's name, steps or groups, keeping everything else it has (and its groups when not given any). */
export function updateFlow(model: Model, id: string, changes: Partial<Pick<Flow, 'name' | 'steps' | 'groups'>>): Model {
  const { groups, ...rest } = changes
  const flow = { ...existingFlow(model, id), ...rest }
  return { ...model, flows: { ...model.flows, [id]: 'groups' in changes ? withGroups(flow, groups) : flow } }
}

const groupOf = (s: Step | undefined): string => (s !== undefined && typeof s.group === 'string' ? s.group.trim() : '')
const laneOf = (s: Step | undefined): string => (s !== undefined && typeof s.lane === 'string' ? s.lane.trim() : '')
const blankText = (v: unknown): boolean => typeof v !== 'string' || v.trim() === ''

function existingStep(flow: Flow, id: string, index: number): Step {
  if (!Number.isInteger(index) || index < 0 || index >= flow.steps.length) throw new OpError(`flow "${id}" has no step ${index + 1}`)
  return flow.steps[index]
}

/**
 * The steps of a flow with step `index` taken out of its group (it stays in the list, without `group` and `lane`), and the groups without
 * any that this left empty. When it started a lane and the next step of the group has none, that step takes the label.
 */
function leaveGroup(flow: Flow, index: number): { steps: Step[]; groups: Record<string, Group> | undefined } {
  const steps = [...flow.steps]
  const g = groupOf(steps[index])
  if (g === '') return { steps, groups: flow.groups }
  const lane = laneOf(steps[index]) !== '' ? steps[index].lane : undefined
  const next = steps[index + 1]
  if (lane !== undefined && groupOf(next) === g && laneOf(next) === '') steps[index + 1] = { ...next, lane }
  const { group: _g, lane: _l, ...kept } = steps[index]
  steps[index] = kept as Step
  let groups = flow.groups
  if (groups !== undefined && !steps.some(s => groupOf(s) === g)) {
    const { [g]: _, ...rest } = groups
    groups = rest
  }
  return { steps, groups }
}

/**
 * Remove step `index` of a flow without breaking its groups: when it started a lane and the next step of that group has none, that step takes
 * the label, and a group whose last member goes is taken out with it.
 */
export function removeStep(model: Model, id: string, index: number): Model {
  const flow = existingFlow(model, id)
  existingStep(flow, id, index)
  const { steps, groups } = leaveGroup(flow, index)
  steps.splice(index, 1)
  return { ...model, flows: { ...model.flows, [id]: withGroups({ ...flow, steps }, groups) } }
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
  if (groupOf(step) === to) return model
  const left = leaveGroup(flow, index)
  const steps = left.steps
  if (to !== '') {
    const { lane: _l, ...joined } = { ...steps[index], group: to }
    steps[index] = joined as Step
    const kind = flow.groups![to].kind
    if (kind === 'branch' || kind === 'parallel') {
      const first = steps.findIndex((s, i) => i !== index && groupOf(s) === to)
      if (first === -1) steps[index] = { ...steps[index], lane: 'Lane 1' }
      else if (first > index) {
        const has = laneOf(steps[first]) !== ''
        steps[index] = { ...steps[index], lane: has ? steps[first].lane : 'Lane 1' }
        if (has) {
          const { lane: _o, ...rest } = steps[first]
          steps[first] = rest as Step
        }
      }
    }
  }
  return { ...model, flows: { ...model.flows, [id]: withGroups({ ...flow, steps }, left.groups) } }
}

/**
 * Give an existing group another kind. A repeat keeps its `times` and `until` (and gets `times: "3"` when it has neither), the others drop
 * them; members lose their lanes when it becomes a repeat, and when it becomes a branch or parallel group its first step starts "Lane 1"
 * (and, for parallel, every other step that starts no lane starts one of its own unless two lanes are there already).
 */
export function setGroupKind(model: Model, id: string, group: string, kind: string): Model {
  const flow = existingFlow(model, id)
  if (flow.groups === undefined || !Object.hasOwn(flow.groups, group)) throw new OpError(`unknown group "${group}"`)
  if (!isGroupKind(kind)) throw new OpError(`unknown kind "${kind}" (use ${GROUP_KINDS.join(', ')})`)
  const { times, until, ...others } = flow.groups[group]
  const next: Group = { ...others, kind }
  if (kind === 'repeat') {
    if (times !== undefined) next.times = times
    if (until !== undefined) next.until = until
    if (blankText(times) && blankText(until)) next.times = '3'
  }
  const steps = [...flow.steps]
  const members = steps.flatMap((s, i) => (groupOf(s) === group ? [i] : []))
  if (kind === 'repeat') {
    for (const i of members) {
      if (steps[i].lane === undefined) continue
      const { lane: _l, ...kept } = steps[i]
      steps[i] = kept as Step
    }
  } else if (members.length > 0) {
    if (laneOf(steps[members[0]]) === '') steps[members[0]] = { ...steps[members[0]], lane: 'Lane 1' }
    // Parallel lanes are at least two: every step that starts no lane starts one of its own, as groupSteps does.
    if (kind === 'parallel' && members.filter(i => laneOf(steps[i]) !== '').length < 2) {
      for (const i of members) {
        if (laneOf(steps[i]) !== '') continue
        const used = new Set(members.map(j => laneOf(steps[j])))
        let n = 1
        while (used.has(`Lane ${n}`)) n++
        steps[i] = { ...steps[i], lane: `Lane ${n}` }
      }
    }
  }
  return { ...model, flows: { ...model.flows, [id]: withGroups({ ...flow, steps }, { ...flow.groups, [group]: next }) } }
}

/**
 * Declare a group and put the steps `first` to `last` (0-based, both included) in it. A repeat is written with `times: "3"`; in a branch or
 * parallel group every step starts a lane of its own ("Lane 1", "Lane 2"…), which the steps' lane labels then reshape.
 */
export function groupSteps(model: Model, id: string, group: string, kind: string, first: number, last: number): Model {
  const flow = existingFlow(model, id)
  if (!isValidId(group)) throw new OpError(`"${group}" is not a valid group id: ${ID_RULE}`)
  if (flow.groups !== undefined && Object.hasOwn(flow.groups, group)) throw new OpError(`group "${group}" already exists`)
  if (!isGroupKind(kind)) throw new OpError(`unknown kind "${kind}" (use ${GROUP_KINDS.join(', ')})`)
  existingStep(flow, id, first)
  existingStep(flow, id, last)
  if (last < first) throw new OpError(`step ${last + 1} comes before step ${first + 1}`)
  const steps = [...flow.steps]
  for (let i = first; i <= last; i++) {
    const other = groupOf(steps[i])
    if (other !== '') throw new OpError(`step ${i + 1} is already in group "${other}"`)
    const { lane: _l, ...kept } = steps[i]
    steps[i] = kind === 'repeat' ? { ...kept, group } as Step : { ...kept, group, lane: `Lane ${i - first + 1}` } as Step
  }
  const declared: Group = kind === 'repeat' ? { kind, times: '3' } : { kind }
  return { ...model, flows: { ...model.flows, [id]: withGroups({ ...flow, steps }, { ...(flow.groups ?? {}), [group]: declared }) } }
}

/** Create or replace a group of a flow. `times` may be a number, which is written as text; a blank `times`, `until` or `text` is left out. */
export function putGroup(model: Model, flowId: string, id: string, group: GroupInput): Model {
  const flow = existingFlow(model, flowId)
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
  return { ...model, flows: { ...model.flows, [flowId]: withGroups(flow, { ...(flow.groups ?? {}), [id]: next as Group }) } }
}

/** Remove a group's declaration, and the group and lane of every step that named it. */
export function removeGroup(model: Model, flowId: string, id: string): Model {
  const flow = existingFlow(model, flowId)
  if (flow.groups === undefined || !Object.hasOwn(flow.groups, id)) throw new OpError(`unknown group "${id}"`)
  const { [id]: _, ...rest } = flow.groups
  const steps = flow.steps.map(s => {
    if (typeof s.group !== 'string' || s.group.trim() !== id) return s
    const { group: _g, lane: _l, ...kept } = s
    return kept as Step
  })
  return { ...model, flows: { ...model.flows, [flowId]: withGroups({ ...flow, steps }, rest) } }
}

export function deleteFlow(model: Model, id: string): Model {
  existingFlow(model, id)
  const flows = { ...model.flows }
  delete flows[id]
  return { ...model, flows }
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
 * `missing` holds the code paths that don't exist, in either model (see check).
 */
export function refuseNewProblems(before: Model, after: Model, missing: ReadonlySet<string> = new Set()): void {
  const added = newProblems(check(before, missing), check(after, missing))
  if (added.length) throw new OpError(`Refused, nothing saved. This would add:\n${added.map(p => `- ${p.file}: ${p.message}`).join('\n')}`)
}
