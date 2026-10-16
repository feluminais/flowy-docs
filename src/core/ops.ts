import { getObject, isValidId, ROOT } from './model.ts'
import type { Connection, FlowyObject, Model, ObjectType, Step } from './model.ts'
import { memberIds } from './views.ts'

/** A refused edit. The message is written for whoever asked for the edit. */
export class OpError extends Error {
  name = 'OpError'
}

export type ObjectInput = { id: string; type?: ObjectType; name?: string; in?: string; tech?: string; description?: string }
export type ConnectionInput = { from: string; to: string; label?: string }
export type FlowInput = { id: string; name: string; view: string; steps: Step[] }

const FIELDS = ['type', 'name', 'in', 'tech', 'description'] as const
const CLEARABLE = ['in', 'tech', 'description'] as const
const ID_RULE = 'use lowercase letters, digits and dashes, not starting with a dash ("root" is reserved)'

/**
 * Create or update an object. Omitted fields stay as they are; "" removes in, tech or description.
 * Only the five known fields are copied from the input, so a new object's keys always come out
 * in the order type, name, in, tech, description, and stray input keys never land in the model.
 */
export function putObject(model: Model, { id, ...fields }: ObjectInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid id: ${ID_RULE}`)
  const prev = getObject(model, id)
  if (!prev && (!fields.type || !fields.name)) throw new OpError(`"${id}" doesn't exist yet, so type and name are required`)
  const next: Record<string, unknown> = { ...prev }
  for (const k of FIELDS) if (fields[k] !== undefined) next[k] = fields[k]
  for (const k of CLEARABLE) if (next[k] === '') delete next[k]
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

/** Create or replace a flow. Replacing drops everything the old flow had, hand-written extra keys included. */
export function putFlow(model: Model, { id, name, view, steps }: FlowInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid flow id: ${ID_RULE}`)
  // Flow ids are file names, and Windows and macOS don't tell Visit.yaml from visit.yaml.
  const clash = Object.keys(model.flows).find(other => other !== id && other.toLowerCase() === id.toLowerCase())
  if (clash) throw new OpError(`flows/${clash}.yaml already exists and differs only in case. Use "${clash}" or rename that file by hand.`)
  return { ...model, flows: { ...model.flows, [id]: { name, view, steps: steps.map(s => ({ ...s })) } } }
}

export function deleteFlow(model: Model, id: string): Model {
  if (!Object.hasOwn(model.flows, id)) throw new OpError(`unknown flow "${id}"`)
  if (!isValidId(id)) throw new OpError(`flows/${id}.yaml has an invalid file name, so it can't be changed here. Rename or delete it by hand.`)
  const flows = { ...model.flows }
  delete flows[id]
  return { ...model, flows }
}
