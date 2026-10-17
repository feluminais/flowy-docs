import { Document, parse, stringify, visit, YAMLParseError } from 'yaml'

export const ROOT = 'root'
export const OBJECT_TYPES = ['actor', 'system', 'app', 'store', 'component'] as const
export type ObjectType = (typeof OBJECT_TYPES)[number]
/** How the canvas draws lines. A project picks one with a top-level `lines:` in model.yaml; without it, straight. */
export const LINE_STYLES = ['straight', 'curved', 'angled'] as const
export type LineStyle = (typeof LINE_STYLES)[number]

export type FlowyObject = {
  type: ObjectType
  name: string
  in?: string
  /** "true" for an outside service or system you don't own. Read as text, like every value. */
  external?: string
  tech?: string
  description?: string
  [extra: string]: unknown
}
export type Connection = { from: string; to: string; label?: string; [extra: string]: unknown }
/** One step of a flow. Without `to`, the `from` box does something on its own. `description` is the longer detail a reader can open. */
export type Step = { from: string; to?: string; text: string; description?: string; [extra: string]: unknown }
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

/** The project's line style. Anything unknown draws straight; check() reports it. */
export const lineStyle = (model: Model): LineStyle => LINE_STYLES.find(s => s === model.meta.lines) ?? 'straight'

/** Whether an object is an outside service: `external: true`, read back as the text "true". */
export const isExternal = (o: FlowyObject): boolean => o.external === 'true'

export const isValidId = (id: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(id) && id !== ROOT

/** Own-property lookup, so ids like "constructor" never reach Object.prototype. */
export function getObject(model: Model, id: unknown): FlowyObject | undefined {
  return typeof id === 'string' && id !== ROOT && Object.hasOwn(model.objects, id) ? model.objects[id] : undefined
}

/** A file that can't be read as a Flowy file. Nothing may be written over it. */
export class ParseError extends Error {
  file: string
  line: number | undefined
  /** What's wrong, without the `file:line:` prefix that `message` starts with. */
  reason: string
  constructor(file: string, reason: string, line?: number) {
    super(`${file}${line === undefined ? '' : `:${line}`}: ${reason}`)
    this.name = 'ParseError'
    this.file = file
    this.line = line
    this.reason = reason
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
  // Line starts are found by \n only: JS's ^ and $ with the m flag also break at U+2028/U+2029,
  // which YAML keeps inside plain values, so a saved value could look like a conflict marker.
  const conflict = /(?<![^\n])(?:(?:<{7}|>{7})(?= |\r?\n|\r?$)|={7}(?=\r?\n|\r?$))/.exec(text)
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

const TEXT_FIELDS = {
  object: ['type', 'name', 'in', 'external', 'tech', 'description'],
  connection: ['from', 'to', 'label'],
  flow: ['name', 'view'],
  step: ['from', 'to', 'text', 'description'],
} as const

/**
 * An entry must be a mapping, and its known fields must be text: a list or mapping there would
 * break the checker and make the types lie. Extra fields may hold anything.
 */
function checkEntry(file: string, what: string, entry: unknown, fields: readonly string[]) {
  if (!isMap(entry)) throw new ParseError(file, `${what} must be a mapping`)
  const bad = fields.find(f => entry[f] !== undefined && typeof entry[f] !== 'string')
  if (bad) throw new ParseError(file, `${what}: "${bad}" must be plain text, not a list or a mapping`)
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
  for (const [id, o] of Object.entries(objects)) checkEntry(file, `object "${id}"`, o, TEXT_FIELDS.object)
  if (!Array.isArray(connections)) throw new ParseError(file, '"connections" must be a list')
  connections.forEach((c, i) => checkEntry(file, `connection ${i + 1}`, c, TEXT_FIELDS.connection))
  return { objects: objects as Model['objects'], connections: connections as Connection[], meta }
}

/** Checks the file's shape only. An empty file gives `{ steps: [] }`; check() reports what's missing. */
export function parseFlowFile(id: string, text: string): Flow {
  const file = `flows/${id}.yaml`
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "name", "view" and "steps"')
  checkEntry(file, 'flow', doc, TEXT_FIELDS.flow)
  const steps = orEmpty(doc.steps, [])
  if (!Array.isArray(steps)) throw new ParseError(file, '"steps" must be a list')
  steps.forEach((s, i) => checkEntry(file, `step ${i + 1}`, s, TEXT_FIELDS.step))
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

/**
 * One file's content as plain data, the way serializeFile and PUT /api/file take it. For model.yaml
 * that's the file's own top-level keys, not the { objects, connections, meta } that parseModelFile returns.
 */
export function fileData(m: Model, rel: string): unknown {
  if (rel === 'model.yaml') return { ...m.meta, objects: m.objects, connections: m.connections }
  if (rel === 'layout.yaml') return m.layout
  return m.flows[rel.slice('flows/'.length, -'.yaml'.length)]
}

export const serializeModelFile = (m: Model) => dump(fileData(m, 'model.yaml'))
export const serializeFlow = (flow: Flow) => dump(flow)

export function serializeLayout(layout: Layout): string {
  const doc = new Document(layout, { aliasDuplicateObjects: false })
  visit(doc, { Seq: (_, node) => { node.flow = true } })
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/** Parse one file of the folder, picked by its path (model.yaml, layout.yaml or flows/<id>.yaml). Throws ParseError. */
export function parseFile(rel: string, text: string): ReturnType<typeof parseModelFile> | Layout | Flow {
  if (rel === 'model.yaml') return parseModelFile(text)
  if (rel === 'layout.yaml') return parseLayoutFile(text)
  return parseFlowFile(rel.slice('flows/'.length, -'.yaml'.length), text)
}

/**
 * A file's content as plain JSON, turned into its YAML text. For model.yaml that's the file's own
 * top-level keys ({ objects, connections, ...others }), not parseModelFile's { objects, connections, meta }.
 * Throws on a number, boolean or null in model or flow files, which only hold text.
 * Not a check: parse the result with parseFile before writing it.
 */
export const serializeFile = (rel: string, data: unknown): string =>
  rel === 'layout.yaml' ? serializeLayout(data as Layout) : dump(data)

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
