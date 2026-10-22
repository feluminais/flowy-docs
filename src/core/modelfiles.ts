import { Document, isMap as isYamlMap, visit } from 'yaml'
import { compactEntries } from './data.ts'
import { FILE_KINDS, FOLDER_KINDS, idUnder, kindOfPath, pathOf } from './filekinds.ts'
import type { WrittenKind } from './filekinds.ts'
import { ParseError, orEmpty } from './model.ts'
import type { Analysis, Connection, Flow, Layout, Mode, Model } from './model.ts'
import { isMap, own, plainNumber } from './text.ts'
import { dump, quoteBlankFirstLines, readYaml } from './yamltext.ts'

const TEXT_FIELDS = {
  object: ['type', 'name', 'in', 'external', 'shape', 'color', 'opacity', 'icon', 'tech', 'description'],
  connection: ['from', 'to', 'label'],
  flow: ['name', 'view'],
  step: ['from', 'to', 'text', 'description', 'group', 'lane', 'flow'],
  group: ['kind', 'text', 'times', 'until'],
  analysis: ['name', 'about', 'scope'],
  mode: ['mode', 'on', 'from', 'to', 'effect', 'cause', 'severity', 'occurrence', 'detection', 'controls', 'action', 'owner', 'status', 'flow', 'step', 'run', 'description'],
  ratings: ['severity', 'occurrence', 'detection'],
  scale: ['low', 'high'],
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
  const file = FILE_KINDS.model.file
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
  const file = pathOf(FILE_KINDS.flow, id)
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "name", "view" and "steps"')
  checkEntry(file, 'flow', doc, TEXT_FIELDS.flow)
  const steps = orEmpty(doc.steps, [])
  if (!Array.isArray(steps)) throw new ParseError(file, '"steps" must be a list')
  steps.forEach((s, i) => checkEntry(file, `step ${i + 1}`, s, TEXT_FIELDS.step))
  const groups = orEmpty(doc.groups, undefined)
  if (groups !== undefined) {
    if (!isMap(groups)) throw new ParseError(file, '"groups" must map ids to mappings')
    for (const [id, g] of Object.entries(groups)) checkEntry(file, `group "${id}"`, g, TEXT_FIELDS.group)
  }
  const flow = { ...doc, steps } as Flow
  if (groups === undefined) delete flow.groups // a blank section is no section
  return flow
}

/**
 * Checks the file's shape only: the right kinds of value in the right places. Whether a part exists, a rating is in range or a status is
 * known is for check(). A blank `after` or `affects` is no section. A missing name reads as "" and a missing `modes` as none.
 */
export function parseAnalysisFile(id: string, text: string): Analysis {
  const file = pathOf(FILE_KINDS.failure, id)
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected a mapping with "name" and "modes"')
  checkEntry(file, 'analysis', doc, TEXT_FIELDS.analysis)
  const rawModes = orEmpty(doc.modes, {})
  if (!isMap(rawModes)) throw new ParseError(file, '"modes" must map ids to mappings')
  const modes: Record<string, Mode> = {}
  for (const [mid, raw] of Object.entries(rawModes)) {
    const at = `mode "${mid}"`
    checkEntry(file, at, raw, TEXT_FIELDS.mode)
    const mode = { ...(raw as Mode) }
    const after = orEmpty(mode.after, undefined)
    if (after === undefined) delete mode.after
    else if (!isMap(after)) throw new ParseError(file, `${at}: "after" must be a mapping of ratings`)
    else checkEntry(file, `${at} after`, after, TEXT_FIELDS.ratings)
    const affects = orEmpty(mode.affects, undefined)
    if (affects === undefined) delete mode.affects
    else if (!Array.isArray(affects) || affects.some(a => typeof a !== 'string')) throw new ParseError(file, `${at}: "affects" must be a list of ids`)
    // Not `modes[mid] = ...`: a mode named __proto__ would replace the prototype and vanish.
    own(modes, mid, mode)
  }
  const scale = orEmpty(doc.scale, undefined)
  if (scale !== undefined) {
    if (!isMap(scale)) throw new ParseError(file, '"scale" must map ratings to a low and a high')
    for (const [rating, ends] of Object.entries(scale)) checkEntry(file, `scale "${rating}"`, ends, TEXT_FIELDS.scale)
  }
  const analysis = { ...doc, name: typeof doc.name === 'string' ? doc.name : '', modes } as Analysis
  if (scale === undefined) delete analysis.scale
  return analysis
}

/** The furthest a layout position may be from zero: past it the line paths overflow and cannot be drawn. The desktop app has the same bound. */
const MAX_COORDINATE = 1_000_000

function toPoint(v: unknown): [number, number] | undefined {
  if (!Array.isArray(v) || v.length !== 2) return undefined
  const [x, y] = v.map(plainNumber)
  return x !== undefined && y !== undefined && Math.abs(x) <= MAX_COORDINATE && Math.abs(y) <= MAX_COORDINATE ? [x, y] : undefined
}

export function parseLayoutFile(text: string): Layout {
  const file = FILE_KINDS.layout.file
  const doc = orEmpty(readYaml(file, text), {})
  if (!isMap(doc)) throw new ParseError(file, 'expected view → object → [x, y]')
  return Object.fromEntries(Object.entries(doc).map(([view, rawBoxes]) => {
    const boxes = orEmpty(rawBoxes, {})
    if (!isMap(boxes)) throw new ParseError(file, `view "${view}" must map object ids to [x, y]`)
    return [view, Object.fromEntries(Object.entries(boxes).map(([id, p]) => {
      const point = toPoint(p)
      if (!point) throw new ParseError(file, `${view} → ${id} must be [x, y], each between -${MAX_COORDINATE} and ${MAX_COORDINATE}`)
      return [id, point]
    }))]
  }))
}


/**
 * What the model does with each file Flowy writes. A kind in filekinds.ts that Flowy writes must have an entry here, or this doesn't compile.
 * `get` is the file's content as plain data, the way serializeFile and PUT /api/file take it. `all` is a folder kind's files by id.
 */
type Ops = {
  parse: (id: string, text: string) => unknown
  serialize: (data: unknown) => string
  get: (m: Model, id: string) => unknown
  all?: (m: Model) => Record<string, unknown>
}

const OPS: Record<WrittenKind, Ops> = {
  // For model.yaml that's the file's own top-level keys, not the { objects, connections, meta } that parseModelFile returns.
  model: { parse: (_, text) => parseModelFile(text), serialize: dumpModel, get: m => ({ ...m.meta, objects: m.objects, connections: m.connections }) },
  layout: { parse: (_, text) => parseLayoutFile(text), serialize: data => serializeLayout(data as Layout), get: m => m.layout },
  flow: { parse: parseFlowFile, serialize: dump, get: (m, id) => m.flows[id], all: m => m.flows },
  failure: { parse: parseAnalysisFile, serialize: dump, get: (m, id) => m.failures[id], all: m => m.failures },
}

/** The ops for a path and the id it names. Anything that is not a file Flowy writes is read as a flow. */
function target(rel: string): { ops: Ops; id: string } {
  const kind = kindOfPath(rel)
  if (kind === undefined || !kind.writable) return { ops: OPS.flow, id: idUnder(FILE_KINDS.flow, rel) }
  return { ops: OPS[kind.kind as WrittenKind], id: kind.folder === undefined ? '' : idUnder(kind, rel) }
}

/**
 * One file's content as plain data, the way serializeFile and PUT /api/file take it. For model.yaml
 * that's the file's own top-level keys, not the { objects, connections, meta } that parseModelFile returns.
 */
export function fileData(m: Model, rel: string): unknown {
  const { ops, id } = target(rel)
  return ops.get(m, id)
}

export { isRemovableFile } from './filekinds.ts'

function compactData(doc: Document) {
  const objects = doc.get('objects', true)
  if (!isYamlMap(objects)) return
  for (const { value: object } of objects.items) compactEntries(isYamlMap(object) ? object.get('data', true) : undefined)
}

/** model.yaml's text: like the other files, plus the one-line forms a store's data is written in (see compactData). */
function dumpModel(value: unknown): string {
  const doc = new Document(value, { schema: 'failsafe', aliasDuplicateObjects: false })
  quoteBlankFirstLines(doc)
  compactData(doc)
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

export const serializeModelFile = (m: Model) => dumpModel(fileData(m, FILE_KINDS.model.file))
export const serializeFlow = (flow: Flow) => dump(flow)
export const serializeAnalysis = (a: Analysis) => dump(a)

export function serializeLayout(layout: Layout): string {
  const doc = new Document(layout, { aliasDuplicateObjects: false })
  visit(doc, { Seq: (_, node) => { node.flow = true } })
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/** Parse one file of the folder, picked by its path (model.yaml, layout.yaml, flows/<id>.yaml or failures/<id>.yaml). Throws ParseError. */
export function parseFile(rel: string, text: string): ReturnType<typeof parseModelFile> | Layout | Flow | Analysis {
  const { ops, id } = target(rel)
  return ops.parse(id, text) as ReturnType<typeof parseModelFile> | Layout | Flow | Analysis
}

/**
 * A file's content as plain JSON, turned into its YAML text. For model.yaml that's the file's own
 * top-level keys ({ objects, connections, ...others }), not parseModelFile's { objects, connections, meta }.
 * Throws on a number, boolean or null in model or flow files, which only hold text.
 * Not a check: parse the result with parseFile before writing it.
 */
export const serializeFile = (rel: string, data: unknown): string => target(rel).ops.serialize(data)

/** Every file MCP may write, as path → text. layout.yaml belongs to the canvas. */
export function modelFiles(m: Model): Record<string, string> {
  const files: Record<string, string> = { [FILE_KINDS.model.file]: serializeModelFile(m) }
  for (const kind of FOLDER_KINDS) {
    const ops = kind.writable ? OPS[kind.kind as WrittenKind] : undefined
    if (ops?.all) for (const [id, data] of Object.entries(ops.all(m))) files[pathOf(kind, id)] = ops.serialize(data)
  }
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
