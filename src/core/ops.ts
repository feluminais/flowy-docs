import { getObject, isValidId } from './model.ts'
import type { Connection, FlowyObject, Model, ObjectType, Step } from './model.ts'
import { memberIds } from './views.ts'

/** A refused edit. The message is written for whoever asked for the edit. */
export class OpError extends Error {}

export type ObjectInput = { id: string; type?: ObjectType; name?: string; in?: string; tech?: string; description?: string }
export type ConnectionInput = { from: string; to: string; label?: string }
export type FlowInput = { id: string; name: string; view: string; steps: Step[] }

const CLEARABLE = ['in', 'tech', 'description'] as const

/** Create or update an object. Omitted fields stay as they are; "" removes in, tech or description. */
export function putObject(model: Model, { id, ...fields }: ObjectInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid id: use lowercase letters, digits and dashes`)
  const prev = getObject(model, id)
  if (!prev && (!fields.type || !fields.name)) throw new OpError(`"${id}" doesn't exist yet, so type and name are required`)
  const next: FlowyObject = { ...(prev ?? { type: fields.type as ObjectType, name: fields.name as string }) }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) next[k] = v
  for (const k of CLEARABLE) if (next[k] === '') delete next[k]
  return { ...model, objects: { ...model.objects, [id]: next } }
}

export function deleteObject(model: Model, id: string): Model {
  if (!getObject(model, id)) throw new OpError(`unknown object "${id}"`)
  const children = memberIds(model, id)
  if (children.length) throw new OpError(`"${id}" still contains ${children.join(', ')}. Delete or move those first.`)
  const flows = Object.entries(model.flows)
    .filter(([, f]) => f.view === id || f.steps.some(s => s.from === id || s.to === id))
    .map(([fid]) => fid)
  if (flows.length) throw new OpError(`"${id}" is used by flow ${flows.join(', ')}. Change or delete those first.`)
  const objects = { ...model.objects }
  delete objects[id]
  return { ...model, objects, connections: model.connections.filter(c => c.from !== id && c.to !== id) }
}

export function connect(model: Model, { from, to, label }: ConnectionInput): Model {
  for (const end of [from, to]) if (!getObject(model, end)) throw new OpError(`unknown object "${end}"`)
  const c: Connection = label ? { from, to, label } : { from, to }
  return { ...model, connections: [...model.connections, c] }
}

/** Remove from → to connections. With a label, only the ones carrying it. */
export function disconnect(model: Model, { from, to, label }: ConnectionInput): Model {
  const matches = (c: Connection) => c.from === from && c.to === to && (label === undefined || c.label === label)
  if (!model.connections.some(matches))
    throw new OpError(`no connection ${from} → ${to}${label === undefined ? '' : ` labelled "${label}"`}`)
  return { ...model, connections: model.connections.filter(c => !matches(c)) }
}

/** Create or replace a flow. */
export function putFlow(model: Model, { id, ...flow }: FlowInput): Model {
  if (!isValidId(id)) throw new OpError(`"${id}" is not a valid flow id: use lowercase letters, digits and dashes`)
  return { ...model, flows: { ...model.flows, [id]: flow } }
}

export function deleteFlow(model: Model, id: string): Model {
  if (!Object.hasOwn(model.flows, id)) throw new OpError(`unknown flow "${id}"`)
  const flows = { ...model.flows }
  delete flows[id]
  return { ...model, flows }
}
