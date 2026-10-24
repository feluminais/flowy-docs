import { isValidFolder, isValidId } from './model.ts'

/**
 * The kinds of file in a project folder, and how a path names one. Every place that needs to know that `flows/<id>.yaml`
 * is a flow, which files may be written, or which may be deleted asks here, so a new kind is one entry below (plus its
 * parser and writer in modelfiles.ts, which is checked by the compiler).
 *
 * A kind is either one file (`file`) or a folder of `<id>.yaml` files (`folder`).
 */
export type SingleFile = {
  readonly kind: string
  readonly file: string
  readonly folder?: never
  /** Whether Flowy may write it. */
  readonly writable: boolean
  /** Whether it may be absent, so it can be created and deleted. */
  readonly removable: false
}

export type FolderKind = {
  readonly kind: string
  readonly folder: string
  readonly file?: never
  /** What one file is called in messages: "flow" in "a valid flow id". */
  readonly noun: string
  /** Whether the files may sit in folders under `folder`: the id is then the file's name alone, wherever the file is. */
  readonly nested: boolean
  readonly writable: boolean
  readonly removable: boolean
  /**
   * What a file that can't be used does to the load. Tolerant: the file is skipped and becomes a problem, because the
   * model is worth more than these files. Strict: the file is part of the model, so an error in it stops the load and
   * check() judges its id.
   */
  readonly tolerant: boolean
}

export type KindInfo = SingleFile | FolderKind

export const FILE_KINDS = {
  model: { kind: 'model', file: 'model.yaml', writable: true, removable: false },
  layout: { kind: 'layout', file: 'layout.yaml', writable: true, removable: false },
  flow: { kind: 'flow', folder: 'flows', noun: 'flow', nested: true, writable: true, removable: true, tolerant: false },
  failure: { kind: 'failure', folder: 'failures', noun: 'analysis', nested: false, writable: true, removable: true, tolerant: true },
  /** Load-test runs: read only. */
  run: { kind: 'run', folder: 'perf', noun: 'run', nested: false, writable: false, removable: false, tolerant: true },
} as const satisfies Record<string, KindInfo>

export type FileKind = keyof typeof FILE_KINDS
/** The kinds Flowy writes: what a parser and a writer must exist for. */
export type WrittenKind = { [K in FileKind]: (typeof FILE_KINDS)[K]['writable'] extends true ? K : never }[FileKind]

export const KINDS: readonly KindInfo[] = Object.values(FILE_KINDS)
export const FOLDER_KINDS: readonly FolderKind[] = KINDS.filter((k): k is FolderKind => k.folder !== undefined)

/** The folders that hold one `<id>.yaml` file per thing and that Flowy writes. */
export const WRITTEN_FOLDERS: readonly string[] = FOLDER_KINDS.filter(k => k.writable).map(k => k.folder)

const EXTENSION = '.yaml'

/** The path of file `id` of a folder kind. A kind whose files nest takes the folder the file is in, a path under the kind's folder ("" for the top). */
export const pathOf = (kind: FolderKind, id: string, sub = ''): string => `${kind.folder}/${sub === '' ? '' : `${sub}/`}${id}${EXTENSION}`

/** The kind a path belongs to: that single file, or anything under a kind's folder. */
export const kindOfPath = (rel: string): KindInfo | undefined =>
  KINDS.find(k => (k.file !== undefined ? k.file === rel : rel.startsWith(`${k.folder}/`)))

/** The id a path names in this kind's folder (not checked to be a valid id), or undefined when it is not `<folder>/<id>.yaml`. In a folder that nests, the id is the file's name, whatever folder it is in. */
export function idOfPath(kind: FolderKind, rel: string): string | undefined {
  if (!rel.startsWith(`${kind.folder}/`) || !rel.endsWith(EXTENSION)) return undefined
  const id = idUnder(kind, rel)
  return id === '' ? undefined : id
}

/** The id of a path taken as a file of this folder kind, whatever follows the folder: what parseFile and fileData are given. */
export function idUnder(kind: FolderKind, rel: string): string {
  const inside = rel.slice(kind.folder.length + 1, -EXTENSION.length)
  return kind.nested ? inside.slice(inside.lastIndexOf('/') + 1) : inside
}

/** The folder a path is in under the kind's folder: "" at the top, and always for a kind whose files do not nest. */
export function folderUnder(kind: FolderKind, rel: string): string {
  if (!kind.nested) return ''
  const inside = rel.slice(kind.folder.length + 1)
  return inside.includes('/') ? inside.slice(0, inside.lastIndexOf('/')) : ''
}

/** Whether Flowy may write this path: model.yaml, layout.yaml, or `<id>.yaml` with a valid id (in a valid folder, where the kind nests) in a written folder. */
export function isAllowedPath(rel: unknown): rel is string {
  if (typeof rel !== 'string') return false
  const kind = kindOfPath(rel)
  if (!kind?.writable) return false
  if (kind.file !== undefined) return true
  const id = idOfPath(kind, rel)
  return id !== undefined && isValidId(id) && isValidFolder(folderUnder(kind, rel))
}

/** Whether this path is a run file, `perf/<id>.yaml` with a valid id. Runs are read only except for their `compare` tag, so isAllowedPath refuses them. */
export function isRunPath(rel: unknown): rel is string {
  if (typeof rel !== 'string') return false
  const id = idOfPath(FILE_KINDS.run, rel)
  return id !== undefined && isValidId(id)
}

/** Whether a path may be absent and so can be created and deleted: a flow or a failure analysis. model.yaml and layout.yaml stay. */
export const isRemovableFile = (rel: string): boolean => kindOfPath(rel)?.removable === true
