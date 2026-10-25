import { isMap, own } from './text.ts'

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
  /** How the object is drawn (see look.ts). All four are read as text, like every value. */
  shape?: string
  color?: string
  /** Percent, 0 to 100: how much of `color` the fill holds. */
  opacity?: string
  /** A built-in icon name, or one defined under `icons:` in model.yaml. */
  icon?: string
  tech?: string
  description?: string
  [extra: string]: unknown
}
export type Connection = { from: string; to: string; label?: string; [extra: string]: unknown }
/** One step of a flow. Without `to`, the `from` box does something on its own. `description` is the longer detail a reader can open. */
export type Step = {
  from: string
  to?: string
  text: string
  description?: string
  /** How the step plays: a kind, or a mapping with a kind (see animation.ts). Read it with animationOf; check() reports a wrong one. */
  animation?: unknown
  /** The group this step belongs to (a key of the flow's `groups`), the lane it starts, and the flow its story continues in (see structure.ts). */
  group?: string
  lane?: string
  flow?: string
  /** The shapes this step changes, shape id to state word (see states.ts). Read it with readStates; check() reports a wrong one. */
  states?: unknown
  [extra: string]: unknown
}
/** A stretch of neighbouring steps that repeat, branch or run in parallel (see structure.ts). Every known option is text when present; check() reports what is wrong. */
export type Group = { kind?: string; text?: string; times?: string; until?: string; [extra: string]: unknown }
/** `states` is where shapes stand before step 1, shape id to state word (see states.ts); left out, every shape is Running. Read it with readStates. */
export type Flow = { name: string; view: string; steps: Step[]; groups?: Record<string, Group>; states?: unknown; tags?: unknown; [extra: string]: unknown }
export type Layout = Record<string, Record<string, [number, number]>>

/** The three ratings of a failure mode, as the text of a whole number from 1 to 10 (every file value is text). failures.ts reads them as numbers. */
export type Ratings = { severity?: string; occurrence?: string; detection?: string; [extra: string]: unknown }
/**
 * One way a part can fail, in a failure analysis. `on` names a shape, or `from` and `to` a line. `after` holds the ratings once the
 * next action is done; `affects` lists the shapes the failure hurts. Every known text field is text when present; check() reports what is wrong.
 */
export type Mode = Ratings & {
  mode?: string; on?: string; from?: string; to?: string; effect?: string; cause?: string
  controls?: string; action?: string; owner?: string; status?: string
  flow?: string; step?: string; run?: string; description?: string
  after?: Ratings; affects?: string[]
}
/** A failure analysis: `failures/<id>.yaml`. `scope` is "root" or a shape with children; `scale` says what the ends of each rating mean. */
export type Analysis = {
  name: string
  about?: string
  scope?: string
  scale?: Record<string, { low?: string; high?: string }>
  modes: Record<string, Mode>
  [extra: string]: unknown
}

export type Model = {
  objects: Record<string, FlowyObject>
  connections: Connection[]
  flows: Record<string, Flow>
  /**
   * The folder each flow's file sits in under flows/, as a path of names ("payments/refunds"), by flow id. A flow at the top of flows/ has no entry, and the
   * map is left out when no flow is in a folder. It is where the file is, not something the file says, so it is never written into a flow.
   */
  folders?: Record<string, string>
  failures: Record<string, Analysis>
  layout: Layout
  /** Other top-level keys of model.yaml, kept so saving never drops them. */
  meta: Record<string, unknown>
}

export const emptyModel = (): Model => ({ objects: {}, connections: [], flows: {}, failures: {}, layout: {}, meta: {} })

/** The project's line style. Anything unknown draws straight; check() reports it. */
export const lineStyle = (model: Model): LineStyle => LINE_STYLES.find(s => s === model.meta.lines) ?? 'straight'

/** The project's name: the top-level `name:` in model.yaml. Empty when there is none (check() reports a value that isn't text). */
export const projectName = (model: Pick<Model, 'meta'>): string => (typeof model.meta.name === 'string' ? model.meta.name.trim() : '')

/** What the project is, in Markdown: the top-level `about:` in model.yaml. Empty when there is none. */
export const projectAbout = (model: Pick<Model, 'meta'>): string => (typeof model.meta.about === 'string' ? model.meta.about.trim() : '')

/** Whether an object is an outside service: `external: true`, read back as the text "true". */
export const isExternal = (o: FlowyObject): boolean => o.external === 'true'

/** One entry of an object's `links`: a web address or a path in the repo, and the text a reader sees for it. Extra keys are kept. */
export type Link = { url: string; title?: string; [extra: string]: unknown }

/** The well-formed entries of an object's `links` (a mapping with a text `url`). check() reports anything else. */
export function linksOf(o: FlowyObject): Link[] {
  return Array.isArray(o.links)
    ? o.links.filter((l): l is Link => isMap(l) && typeof l.url === 'string' && (l.title === undefined || typeof l.title === 'string'))
    : []
}

/** What an id (an object's, or a flow's file name) may be, worded to follow "ids". isValidId is the test. */
export const ID_RULE = 'use lowercase letters, digits and dashes, not starting with a dash ("root" and Windows device names such as "con" are reserved)'
// An id is also a file name (flows/<id>.yaml), and Windows 10 can't hold a file named aux.yaml.
export const isValidId = (id: string): boolean => /^[a-z0-9][a-z0-9-]*$/.test(id) && id !== ROOT && !RESERVED_NAMES.test(id)

/** What a folder of flows may be called: each name between the slashes of its path. isValidFolder is the test. */
export const FOLDER_RULE = 'use names with no \\ / : * ? " < > | # % and no control characters, not starting with a dot or a space, not ending in a dot or a space, 64 characters at most, and nest no deeper than 6 folders'
const MAX_FOLDER_DEPTH = 6
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const isValidFolderName = (name: string): boolean =>
  name.length <= 64 && /^[^\s.\\/:*?"<>|#%\u0000-\u001f][^\\/:*?"<>|#%\u0000-\u001f]*$/.test(name) && !/[. ]$/.test(name) && !RESERVED_NAMES.test(name)

/** Whether `folder` is a path Flowy writes flows into: "" (the top of flows/), or names joined by "/". */
export const isValidFolder = (folder: string): boolean => folder === '' || (folder.split('/').length <= MAX_FOLDER_DEPTH && folder.split('/').every(isValidFolderName))

/** Every folder that has a flow in it or in a folder inside it, as paths, in path order. A folder with nothing in it is not here: it is no part of the model. */
export function folderPaths(model: Pick<Model, 'folders'>): string[] {
  const paths = new Set<string>()
  for (const folder of Object.values(model.folders ?? {})) {
    const names = folder.split('/')
    for (let i = 1; i <= names.length; i++) paths.add(names.slice(0, i).join('/'))
  }
  return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

/** The folder a flow's file is in ("" at the top of flows/). */
export const folderOf = (model: Pick<Model, 'folders'>, id: string): string => (model.folders !== undefined && Object.hasOwn(model.folders, id) ? model.folders[id] : '')

/** What a tag on a flow may be: a short piece of text (see tagsOf). check() reports one that is not. */
export const MAX_TAG_LENGTH = 32
export const isValidTag = (tag: unknown): tag is string => typeof tag === 'string' && tag === tag.trim() && tag.length > 0 && tag.length <= MAX_TAG_LENGTH && !/[\u0000-\u001f]/.test(tag)

/** The tags a flow's form offers before any flow has them, in this order: what kind of walkthrough it is. Any other word is a tag too. */
export const SUGGESTED_TAGS = ['happy path', 'error path', 'edge case', 'recovery', 'background'] as const

/** A tag as the filter compares it: whatever the case. */
export const tagKey = (tag: string): string => tag.toLowerCase()

/** The tags of a flow (`tags:`, a list of words): the ones that are well formed, each once whatever its case, in the order written. check() reports the rest. */
export function tagsOf(flow: Pick<Flow, 'tags'>): string[] {
  if (!Array.isArray(flow.tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of flow.tags) {
    if (!isValidTag(tag) || seen.has(tagKey(tag))) continue
    seen.add(tagKey(tag))
    out.push(tag)
  }
  return out
}

/** Own-property lookup, so ids like "constructor" never reach Object.prototype. */
export function getObject(model: Model, id: unknown): FlowyObject | undefined {
  return typeof id === 'string' && id !== ROOT && Object.hasOwn(model.objects, id) ? model.objects[id] : undefined
}

/** A file that can't be read as a Flowy file. Nothing may be written over it. */
/**
 * The most a file of the model may hold. Reading one takes about a hundred times its size in memory, so a much bigger file would stall the
 * reader or take it down; the biggest real model file so far is under 40 KB. desktop/Flowy.Core/FileText.cs has the same limit and words.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Why a file of `bytes` is not read, worded to follow its path. The size is rounded up, so it never reads as the limit itself. */
export const tooBig = (bytes: number): string =>
  `is ${(Math.ceil((bytes * 10) / 1024 / 1024) / 10).toFixed(1)} MB, more than the ${MAX_FILE_BYTES / 1024 / 1024} MB Flowy reads`

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

/** For sections (objects, connections, steps, layout views): an empty value, `~` or `null` means empty. */
export const orEmpty = (v: unknown, empty: unknown): unknown =>
  v === undefined || v === null || (typeof v === 'string' && /^(|~|null|Null|NULL)$/.test(v)) ? empty : v
