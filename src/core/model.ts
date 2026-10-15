import { Document, parse, stringify, visit, YAMLParseError } from 'yaml'

export const ROOT = 'root'
export const OBJECT_TYPES = ['actor', 'system', 'app', 'store', 'component'] as const
export type ObjectType = (typeof OBJECT_TYPES)[number]

export type FlowyObject = {
  type: ObjectType
  name: string
  in?: string
  tech?: string
  description?: string
  [extra: string]: unknown
}
export type Connection = { from: string; to: string; label?: string; [extra: string]: unknown }
export type Step = { from: string; to: string; text: string; [extra: string]: unknown }
export type Flow = { name: string; view: string; steps: Step[]; [extra: string]: unknown }
export type Layout = Record<string, Record<string, [number, number]>>

export type Model = {
  objects: Record<string, FlowyObject>
  connections: Connection[]
  flows: Record<string, Flow>
  layout: Layout
  /** Other top-level keys of model.yaml, kept so saving never drops them. */
  meta: Record<string, unknown>
}

export const emptyModel = (): Model => ({ objects: {}, connections: [], flows: {}, layout: {}, meta: {} })

export const isValidId = (id: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(id) && id !== ROOT

/** Own-property lookup, so ids like "constructor" never reach Object.prototype. */
export function getObject(model: Model, id: unknown): FlowyObject | undefined {
  return typeof id === 'string' && id !== ROOT && Object.hasOwn(model.objects, id) ? model.objects[id] : undefined
}

/** A file that can't be read as a Flowy file. Nothing may be written over it. */
export class ParseError extends Error {
  file: string
  line: number | undefined
  constructor(file: string, message: string, line?: number) {
    super(`${file}${line === undefined ? '' : `:${line}`}: ${message}`)
    this.file = file
    this.line = line
  }
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isPoint = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === 'number' && Number.isFinite(n))

function readYaml(file: string, text: string): unknown {
  try {
    return parse(text)
  } catch (e) {
    if (e instanceof YAMLParseError) throw new ParseError(file, e.message.split('\n')[0].replace(/:$/, ''), e.linePos?.[0].line)
    throw e
  }
}

export function parseModelFile(text: string): Pick<Model, 'objects' | 'connections' | 'meta'> {
  const file = 'model.yaml'
  const doc = readYaml(file, text) ?? {}
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "objects" and "connections"')
  const { objects: rawObjects, connections: rawConnections, ...meta } = doc
  const objects = rawObjects ?? {}
  const connections = rawConnections ?? []
  if (!isMap(objects) || !Object.values(objects).every(isMap)) throw new ParseError(file, '"objects" must map ids to mappings')
  if (!Array.isArray(connections) || !connections.every(isMap)) throw new ParseError(file, '"connections" must be a list of mappings')
  return { objects: objects as Model['objects'], connections: connections as Connection[], meta }
}

export function parseFlowFile(id: string, text: string): Flow {
  const file = `flows/${id}.yaml`
  const doc = readYaml(file, text)
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "name", "view" and "steps"')
  const steps = doc.steps ?? []
  if (!Array.isArray(steps) || !steps.every(isMap)) throw new ParseError(file, '"steps" must be a list of mappings')
  return { ...doc, steps } as Flow
}

export function parseLayoutFile(text: string): Layout {
  const doc = readYaml('layout.yaml', text) ?? {}
  if (!isMap(doc) || !Object.values(doc).every(v => isMap(v) && Object.values(v).every(isPoint)))
    throw new ParseError('layout.yaml', 'expected view → object → [x, y]')
  return doc as Layout
}

const dump = (value: unknown) => stringify(value, { lineWidth: 0 })

export const serializeModelFile = (m: Model) => dump({ objects: m.objects, connections: m.connections, ...m.meta })
export const serializeFlow = (flow: Flow) => dump(flow)

export function serializeLayout(layout: Layout): string {
  const doc = new Document(layout)
  visit(doc, { Seq: (_, node) => { node.flow = true } })
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/** Every file MCP may write, as path → text. layout.yaml belongs to the canvas. */
export function modelFiles(m: Model): Record<string, string> {
  const files: Record<string, string> = { 'model.yaml': serializeModelFile(m) }
  for (const [id, flow] of Object.entries(m.flows)) files[`flows/${id}.yaml`] = serializeFlow(flow)
  return files
}

/** Files whose content differs between two models. A null text means delete the file. */
export function changedFiles(before: Model, after: Model): [string, string | null][] {
  const a = modelFiles(before)
  const b = modelFiles(after)
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(path => a[path] !== b[path])
    .map((path): [string, string | null] => [path, b[path] ?? null])
}
