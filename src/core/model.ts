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
    this.name = 'ParseError'
    this.file = file
    this.line = line
  }
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** For sections (objects, connections, steps, layout views): an empty value, `~` or `null` means empty. */
const orEmpty = (v: unknown, empty: unknown): unknown =>
  v === undefined || v === null || (typeof v === 'string' && /^(|~|null|Null|NULL)$/.test(v)) ? empty : v

/**
 * Parse with YAML's failsafe schema: every value stays the text that was typed, so an id like
 * `007` or a version like `3.10` survives a save instead of turning into a number.
 */
function readYaml(file: string, text: string): unknown {
  const conflict = /^(?:(?:<{7}|>{7})(?: |\r?$)|={7}\r?$)/m.exec(text)
  if (conflict) throw new ParseError(file, 'unresolved merge conflict', text.slice(0, conflict.index).split('\n').length)
  try {
    return parse(text, { schema: 'failsafe' })
  } catch (e) {
    // Any failure (bad syntax, duplicate keys, alias bombs) means the file can't be trusted.
    const line = e instanceof YAMLParseError ? e.linePos?.[0].line : undefined
    const message = (e instanceof Error ? e.message : String(e)).split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')
    throw new ParseError(file, message, line)
  }
}

/** Checks the file's shape only. Field values are checked by check() in check.ts. */
export function parseModelFile(text: string): Pick<Model, 'objects' | 'connections' | 'meta'> {
  const file = 'model.yaml'
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "objects" and "connections"')
  const { objects: rawObjects, connections: rawConnections, ...meta } = doc
  const objects = orEmpty(rawObjects, {})
  const connections = orEmpty(rawConnections, [])
  if (!isMap(objects)) throw new ParseError(file, '"objects" must map ids to mappings')
  const badObject = Object.entries(objects).find(([, o]) => !isMap(o))
  if (badObject) throw new ParseError(file, `object "${badObject[0]}" must be a mapping`)
  if (!Array.isArray(connections)) throw new ParseError(file, '"connections" must be a list')
  const badConnection = connections.findIndex(c => !isMap(c))
  if (badConnection >= 0) throw new ParseError(file, `connection ${badConnection + 1} must be a mapping`)
  return { objects: objects as Model['objects'], connections: connections as Connection[], meta }
}

/** Checks the file's shape only. An empty file gives `{ steps: [] }`; check() reports what's missing. */
export function parseFlowFile(id: string, text: string): Flow {
  const file = `flows/${id}.yaml`
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "name", "view" and "steps"')
  const steps = orEmpty(doc.steps, [])
  if (!Array.isArray(steps)) throw new ParseError(file, '"steps" must be a list')
  const badStep = steps.findIndex(s => !isMap(s))
  if (badStep >= 0) throw new ParseError(file, `step ${badStep + 1} must be a mapping`)
  return { ...doc, steps } as Flow
}

function toPoint(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined
  const [x, y] = v.map(n => (typeof n === 'string' && n.trim() !== '' ? Number(n) : NaN))
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined
}

export function parseLayoutFile(text: string): Layout {
  const file = 'layout.yaml'
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected view → object → [x, y]')
  return Object.fromEntries(Object.entries(doc).map(([view, rawBoxes]) => {
    const boxes = orEmpty(rawBoxes, {})
    if (!isMap(boxes)) throw new ParseError(file, `view "${view}" must map object ids to [x, y]`)
    return [view, Object.fromEntries(Object.entries(boxes).map(([id, p]) => {
      const point = toPoint(p)
      if (!point) throw new ParseError(file, `${view} → ${id} must be [x, y]`)
      return [id, point]
    }))]
  }))
}

// Written with the failsafe schema too, so a save gives back hand-written values exactly as typed
// (`legacy: true` stays unquoted). Model and flow values are always strings: they come from parsed
// text or from string-only MCP fields; a stray number throws instead of being silently retyped.
// Without aliasDuplicateObjects: false, an object used twice would be written as a YAML &anchor/*alias.
const dump = (value: unknown) => stringify(value, { schema: 'failsafe', lineWidth: 0, aliasDuplicateObjects: false })

export const serializeModelFile = (m: Model) => dump({ ...m.meta, objects: m.objects, connections: m.connections })
export const serializeFlow = (flow: Flow) => dump(flow)

export function serializeLayout(layout: Layout): string {
  const doc = new Document(layout, { aliasDuplicateObjects: false })
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
