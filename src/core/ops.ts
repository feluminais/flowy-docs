import { check, newProblems } from './check.ts'
import { getObject, isValidId, ROOT } from './model.ts'
import type { Connection, Flow, FlowyObject, Layout, Model, ObjectType, Step } from './model.ts'
import { memberIds } from './views.ts'

/** A refused edit. The message is written for whoever asked for the edit. */
export class OpError extends Error {
  name = 'OpError'
}

export type ObjectInput = { id: string; type?: ObjectType; name?: string; in?: string; tech?: string; description?: string; code?: string[] }
export type ConnectionInput = { from: string; to: string; label?: string }
export type FlowInput = { id: string; name: string; view: string; steps: Step[] }

const FIELDS = ['type', 'name', 'in', 'tech', 'description', 'code'] as const
const CLEARABLE = ['in', 'tech', 'description'] as const
const ID_RULE = 'use lowercase letters, digits and dashes, not starting with a dash ("root" is reserved)'

/**
 * Create or update an object. Omitted fields stay as they are; "" removes in, tech or description, and [] removes code.
 * Only the known fields are copied from the input, so a new object's keys always come out
 * in the order type, name, in, tech, description, code, and stray input keys never land in the model.
 */
export function putObject(model: Model, { id, ...fields }: ObjectInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid id: ${ID_RULE}`)
  const prev = getObject(model, id)
  if (!prev && (!fields.type || !fields.name)) throw new OpError(`"${id}" doesn't exist yet, so type and name are required`)
  const next: Record<string, unknown> = { ...prev }
  for (const k of FIELDS) if (fields[k] !== undefined) next[k] = fields[k]
  for (const k of CLEARABLE) if (next[k] === '') delete next[k]
  if (Array.isArray(next.code) && next.code.length === 0) delete next.code
  return { ...model, objects: { ...model.objects, [id]: next as FlowyObject } }
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
export function putFlow(model: Model, { id, name, view, steps }: FlowInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid flow id: ${ID_RULE}`)
  // Flow ids are file names, and Windows and macOS don't tell Visit.yaml from visit.yaml.
  const clash = Object.keys(model.flows).find(other => other !== id && other.toLowerCase() === id.toLowerCase())
  if (clash) throw new OpError(`flows/${clash}.yaml already exists and differs only in case. Rename or delete that file by hand.`)
  return { ...model, flows: { ...model.flows, [id]: { name, view, steps: steps.map(s => ({ ...s })) } } }
}

function existingFlow(model: Model, id: string): Flow {
  if (!Object.hasOwn(model.flows, id)) throw new OpError(`unknown flow "${id}"`)
  if (!isValidId(id)) throw new OpError(`flows/${id}.yaml has an invalid file name, so it can't be changed here. Rename or delete it by hand.`)
  return model.flows[id]
}

/** Change an existing flow's name or steps, keeping everything else it has. */
export function updateFlow(model: Model, id: string, changes: Partial<Pick<Flow, 'name' | 'steps'>>): Model {
  return { ...model, flows: { ...model.flows, [id]: { ...existingFlow(model, id), ...changes } } }
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
 * Refuse an edit that adds problems, naming them. Problems that were already there never block it.
 * `missing` holds the code paths that don't exist, in either model (see check).
 */
export function refuseNewProblems(before: Model, after: Model, missing: ReadonlySet<string> = new Set()): void {
  const added = newProblems(check(before, missing), check(after, missing))
  if (added.length) throw new OpError(`Refused, nothing saved. This would add:\n${added.map(p => `- ${p.file}: ${p.message}`).join('\n')}`)
}
