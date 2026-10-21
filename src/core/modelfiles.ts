import { Document, isMap as isYamlMap, visit } from 'yaml'
import { compactEntries } from './data.ts'
import { ParseError, orEmpty } from './model.ts'
import type { Analysis, Connection, Flow, Layout, Mode, Model } from './model.ts'
import { isMap, own } from './text.ts'
import { dump, readYaml } from './yamltext.ts'

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
  const file = `failures/${id}.yaml`
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


/**
 * One file's content as plain data, the way serializeFile and PUT /api/file take it. For model.yaml
 * that's the file's own top-level keys, not the { objects, connections, meta } that parseModelFile returns.
 */
export function fileData(m: Model, rel: string): unknown {
  if (rel === 'model.yaml') return { ...m.meta, objects: m.objects, connections: m.connections }
  if (rel === 'layout.yaml') return m.layout
  if (rel.startsWith('failures/')) return m.failures[rel.slice('failures/'.length, -'.yaml'.length)]
  return m.flows[rel.slice('flows/'.length, -'.yaml'.length)]
}

/** Whether a file may be absent and so can be created and deleted: a flow or a failure analysis. model.yaml and layout.yaml stay. */
export const isRemovableFile = (rel: string): boolean => rel.startsWith('flows/') || rel.startsWith('failures/')

function compactData(doc: Document) {
  const objects = doc.get('objects', true)
  if (!isYamlMap(objects)) return
  for (const { value: object } of objects.items) compactEntries(isYamlMap(object) ? object.get('data', true) : undefined)
}

/** model.yaml's text: like the other files, plus the one-line forms a store's data is written in (see compactData). */
function dumpModel(value: unknown): string {
  const doc = new Document(value, { schema: 'failsafe', aliasDuplicateObjects: false })
  compactData(doc)
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

export const serializeModelFile = (m: Model) => dumpModel(fileData(m, 'model.yaml'))
export const serializeFlow = (flow: Flow) => dump(flow)
export const serializeAnalysis = (a: Analysis) => dump(a)

export function serializeLayout(layout: Layout): string {
  const doc = new Document(layout, { aliasDuplicateObjects: false })
  visit(doc, { Seq: (_, node) => { node.flow = true } })
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false })
}

/** Parse one file of the folder, picked by its path (model.yaml, layout.yaml, flows/<id>.yaml or failures/<id>.yaml). Throws ParseError. */
export function parseFile(rel: string, text: string): ReturnType<typeof parseModelFile> | Layout | Flow | Analysis {
  if (rel === 'model.yaml') return parseModelFile(text)
  if (rel === 'layout.yaml') return parseLayoutFile(text)
  if (rel.startsWith('failures/')) return parseAnalysisFile(rel.slice('failures/'.length, -'.yaml'.length), text)
  return parseFlowFile(rel.slice('flows/'.length, -'.yaml'.length), text)
}

/**
 * A file's content as plain JSON, turned into its YAML text. For model.yaml that's the file's own
 * top-level keys ({ objects, connections, ...others }), not parseModelFile's { objects, connections, meta }.
 * Throws on a number, boolean or null in model or flow files, which only hold text.
 * Not a check: parse the result with parseFile before writing it.
 */
export const serializeFile = (rel: string, data: unknown): string =>
  rel === 'layout.yaml' ? serializeLayout(data as Layout) : rel === 'model.yaml' ? dumpModel(data) : dump(data)

/** Every file MCP may write, as path → text. layout.yaml belongs to the canvas. */
export function modelFiles(m: Model): Record<string, string> {
  const files: Record<string, string> = { 'model.yaml': serializeModelFile(m) }
  for (const [id, flow] of Object.entries(m.flows)) files[`flows/${id}.yaml`] = serializeFlow(flow)
  for (const [id, analysis] of Object.entries(m.failures)) files[`failures/${id}.yaml`] = serializeAnalysis(analysis)
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
