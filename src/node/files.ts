import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { check } from '../core/check.ts'
import type { Problem } from '../core/problem.ts'
import { runLinkProblems } from '../core/failures.ts'
import { FILE_KINDS, isAllowedPath, kindOfPath } from '../core/filekinds.ts'
import type { FolderKind } from '../core/filekinds.ts'
import { emptyModel, ID_RULE, isValidId, linksOf, ParseError } from '../core/model.ts'
import { parseAnalysisFile, parseFlowFile, parseLayoutFile, parseModelFile } from '../core/modelfiles.ts'
import type { Model } from '../core/model.ts'
import { isRepoPath } from '../core/paths.ts'
import { checkRun, checkRuns } from '../core/perf/check.ts'
import { dialsOf } from '../core/perf/dials.ts'
import { parseRun } from '../core/perf/parse.ts'
import type { Run } from '../core/perf/types.ts'
import type { State } from '../core/state.ts'
import { own } from '../core/text.ts'
import { codeBase } from './git.ts'

/**
 * The model plus a content hash per file (null = file missing), used to detect outside edits.
 * `ignored` lists flow files Flowy skips because they end in .yml, not .yaml. `failureProblems` is what is wrong with the files in
 * failures/ that were skipped: one that can't be read, a .yml file, a name that isn't an id. A skipped file is no part of the model.
 */
export type Loaded = { model: Model; versions: Record<string, string | null>; ignored: string[]; failureProblems: Problem[] }

/** The file changed since the caller read it. */
export class VersionConflict extends Error {
  name = 'VersionConflict'
  /** The file's version now (null = missing). */
  version: string | null
  constructor(rel: string, version: string | null) {
    super(`${rel} changed since it was read`)
    this.version = version
  }
}

export { isAllowedPath, WRITTEN_FOLDERS } from '../core/filekinds.ts'

export const hashText = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** The same version as hashText, from a file's bytes: for valid UTF-8 the two agree, and it works on bytes that are not text. */
export const hashBytes = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex').slice(0, 16)

// fatal: a file that isn't UTF-8 must fail to load, not get rewritten with replacement characters.
// ignoreBOM: keep a BOM in the text, so the hash matches the file as it is.
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

async function readText(dir: string, rel: string): Promise<string | null> {
  let bytes: Uint8Array
  try {
    bytes = await readFile(join(dir, rel))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
  try {
    return utf8.decode(bytes)
  } catch {
    throw new ParseError(rel, 'is not UTF-8 text. Save it as UTF-8 and try again.')
  }
}

/** Read the whole flowy/ folder. A missing folder or file counts as empty. Throws ParseError. */
export async function loadDir(dir: string): Promise<Loaded> {
  const versions: Record<string, string | null> = {}
  const read = async (rel: string) => {
    const text = await readText(dir, rel)
    versions[rel] = text === null ? null : hashText(text)
    return text
  }
  const modelText = await read('model.yaml')
  const layoutText = await read('layout.yaml')
  const model: Model = {
    ...emptyModel(),
    ...(modelText === null ? {} : parseModelFile(modelText)),
    layout: layoutText === null ? {} : parseLayoutFile(layoutText),
  }
  const flows = await loadFolder(dir, FILE_KINDS.flow, read, (id, text) => ({ item: parseFlowFile(id, text) }))
  model.flows = flows.items
  const failures = await loadFolder(dir, FILE_KINDS.failure, read, (id, text) => ({ item: parseAnalysisFile(id, text) }))
  model.failures = failures.items
  return { model, versions, ignored: flows.problems.map(p => p.file), failureProblems: failures.problems }
}

/** What goes wrong with one file, worded for the problems list: "line 3: ..." for a syntax error, else the reason. */
const problemOf = (file: string, e: unknown): Problem => ({
  file,
  message: e instanceof ParseError ? (e.line === undefined ? e.reason : `line ${e.line}: ${e.reason}`) : `can't be read: ${e instanceof Error ? e.message : String(e)}`,
})

/**
 * What a file Flowy skips for ending in .yml, not .yaml, says. `file` is its path. The message names the new file as the file's own name,
 * except for a flow, whose message has always named the whole path.
 */
const ignoredYml = (kind: FolderKind, file: string): Problem => ({
  file,
  message: `Flowy reads ${kind.noun} files that end in .yaml, so this one is ignored. Rename it to ${(kind.tolerant ? file.slice(kind.folder.length + 1) : file).replace(/\.yml$/, '.yaml')}.`,
})

/**
 * Reads every `<id>.yaml` of a folder kind. `read` gets a path and returns its text (null when the file is gone); `parse` turns one file's
 * text into an item, and may give a `check` that lists more problems with it once it is kept. The items are by id.
 *
 * A tolerant kind (see FolderKind) never stops the load: a file that can't be read or whose name isn't an id is skipped and becomes
 * a problem, and so does a folder that can't be listed. A strict kind lets an error in a file through and keeps any id.
 * Either way a .yml file is ignored with a problem, and a missing folder is empty.
 */
export async function loadFolder<T>(
  dir: string,
  kind: FolderKind,
  read: (rel: string) => Promise<string | null>,
  parse: (id: string, text: string) => { item: T; check?: () => Problem[] },
): Promise<{ items: Record<string, T>; problems: Problem[] }> {
  const items: Record<string, T> = {}
  const problems: Problem[] = []
  const entries = await readdir(join(dir, kind.folder), { withFileTypes: true }).catch((e: NodeJS.ErrnoException): Dirent[] => {
    if (e.code === 'ENOENT') return []
    if (!kind.tolerant) throw e
    if (e.code !== 'ENOTDIR') problems.push({ file: kind.folder, message: `can't be read: ${e.message}` })
    return []
  })
  for (const name of entries.filter(e => e.isFile() || e.isSymbolicLink()).map(e => e.name).sort()) {
    const file = `${kind.folder}/${name}`
    if (name.endsWith('.yml')) {
      problems.push(ignoredYml(kind, file))
      continue
    }
    if (!name.endsWith('.yaml')) continue
    const id = name.slice(0, -'.yaml'.length)
    if (kind.tolerant && !isValidId(id)) {
      problems.push({ file, message: `"${id}" is not a valid ${kind.noun} id: the file name must ${ID_RULE}` })
      continue
    }
    try {
      const text = await read(file)
      if (text === null) continue
      const parsed = parse(id, text)
      // Not `items[id] = ...`: a file named __proto__.yaml would replace the prototype and the item would vanish.
      own(items, id, parsed.item)
      if (parsed.check) problems.push(...parsed.check())
    } catch (e) {
      if (!kind.tolerant) throw e
      // Any failure is this file's problem: an unreadable one must not stop the model loading either.
      problems.push(problemOf(file, e))
    }
  }
  return { items, problems }
}

/**
 * The skipped file in failures/ that a write to `rel` would run into, if any: that very file, or one whose name differs only in letter case,
 * which on Windows and macOS is the same file. Nothing may replace or delete such a file: it holds someone's work that Flowy could not read.
 */
export const blockedBy = (loaded: Loaded, rel: string): string | undefined =>
  loaded.failureProblems.map(p => p.file).find(file => kindOfPath(file) === FILE_KINDS.failure && file.toLowerCase() === rel.toLowerCase())

/** The `code` and `links` paths in these models that don't exist. They're relative to the folder that holds `dir`. */
export function missingPaths(dir: string, ...models: Model[]): Set<string> {
  const root = dirname(resolve(dir))
  const paths = models.flatMap(m => Object.values(m.objects).flatMap(o => [...(Array.isArray(o.code) ? o.code : []), ...linksOf(o).map(l => l.url)]))
  return new Set(paths.filter((p): p is string => typeof p === 'string' && isRepoPath(p) && !existsSync(join(root, p))))
}

/**
 * The load-test runs in the folder's perf/, with what is wrong with them. A run that can't be read, or whose name
 * isn't an id, becomes a problem and is skipped: the architecture view is worth more than the numbers, so a file here
 * never stops a model loading. Only loadState reads runs, so a file of numbers can't get in the way of a save.
 */
export async function loadRuns(dir: string, model: Model): Promise<{ runs: Record<string, Run>; problems: Problem[] }> {
  const { items: runs, problems } = await loadFolder(dir, FILE_KINDS.run, rel => readText(dir, rel), (id, text) => {
    const parsed = parseRun(id, text)
    return { item: parsed.run, check: () => [...parsed.problems, ...checkRun(id, parsed.run, model)] }
  })
  // A run that adds others needs the other runs. One with fewer than two it can add can't be played, so it is left out, as a file that can't be read is.
  problems.push(...checkRuns(runs))
  for (const id of Object.keys(runs)) if (runs[id].adds !== undefined && dialsOf(runs, id) === undefined) delete runs[id]
  return { runs, problems }
}

/** The folder as the canvas reads it, or the file that can't be read: what GET /api/state answers and an export carries. */
export async function loadState(dir: string): Promise<State> {
  try {
    const { model, versions, ignored, failureProblems: unread } = await loadDir(dir)
    const { flows, layout, failures, ...rest } = model
    const base = await codeBase(dirname(resolve(dir)))
    // A flow file that isn't read is no part of the model, so it isn't a problem check() can see.
    const skipped = ignored.map(file => ignoredYml(FILE_KINDS.flow, file))
    const { runs, problems: runProblems } = await loadRuns(dir, model)
    // A mode's run link needs the runs, which are not in the model, so it is checked here. The rest of an analysis is checked in check().
    const failureProblems = [...unread, ...Object.entries(model.failures).flatMap(([id, a]) => runLinkProblems(id, a, runs))]
    return {
      model: rest, layout, flows, problems: [...check(model, missingPaths(dir, model)), ...skipped], versions,
      ...(Object.keys(failures).length > 0 ? { failures } : {}),
      ...(base ? { codeBase: base } : {}),
      ...(Object.keys(runs).length > 0 ? { runs } : {}),
      ...(runProblems.length > 0 ? { runProblems } : {}),
      ...(failureProblems.length > 0 ? { failureProblems } : {}),
    }
  } catch (e) {
    if (e instanceof ParseError) return { parseError: { file: e.file, line: e.line, message: e.reason } }
    throw e
  }
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Write one file under dir (null deletes it), but only if it still has the version the caller
 * read; null or undefined means it must not exist yet. Saves to the same file run one at a
 * time, so of two racing callers one wins and the other gets VersionConflict.
 */
export async function saveFile(dir: string, rel: string, text: string | null, expected: string | null | undefined): Promise<string | null> {
  if (!isAllowedPath(rel)) throw new Error(`refusing to write "${rel}"`)
  return queued(dir, rel, () => saveNow(dir, rel, text, expected ?? null))
}

/**
 * Like saveFile, for bytes: the file's version is the hash of its bytes, so a file that is not UTF-8 can be replaced (saveFile would
 * refuse to read it). Used to put a past version of the files back. Same queue, same VersionConflict.
 */
export async function saveRaw(dir: string, rel: string, bytes: Uint8Array | null, expected: string | null): Promise<string | null> {
  if (!isAllowedPath(rel)) throw new Error(`refusing to write "${rel}"`)
  return queued(dir, rel, () => saveRawNow(dir, rel, bytes, expected))
}

/** Runs one save of a file after the saves already waiting on it. */
async function queued(dir: string, rel: string, work: () => Promise<string | null>): Promise<string | null> {
  const key = resolve(dir, rel)
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work)
  queues.set(key, run)
  try {
    return await run
  } finally {
    if (queues.get(key) === run) queues.delete(key)
  }
}

async function saveNow(dir: string, rel: string, text: string | null, expected: string | null): Promise<string | null> {
  const path = join(dir, rel)
  const current = await readText(dir, rel)
  // Known limit: saves are serialized per file inside this process only. Another process or an
  // editor saving between this check and the rename can still be overwritten; add a lock file
  // if that ever bites. No fsync either: a power cut mid-save can leave an empty file (git has it).
  const version = current === null ? null : hashText(current)
  if (version !== expected) throw new VersionConflict(rel, version)
  if (text === null) {
    await rm(path, { force: true, maxRetries: 4, retryDelay: 50 })
    return null
  }
  await replaceFile(path, text)
  return hashText(text)
}

async function saveRawNow(dir: string, rel: string, bytes: Uint8Array | null, expected: string | null): Promise<string | null> {
  const path = join(dir, rel)
  let current: Uint8Array | null = null
  try {
    current = await readFile(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }
  const version = current === null ? null : hashBytes(current)
  if (version !== expected) throw new VersionConflict(rel, version)
  if (bytes === null) {
    await rm(path, { force: true, maxRetries: 4, retryDelay: 50 })
    return null
  }
  await replaceFile(path, bytes)
  return hashBytes(bytes)
}

/** Writes to a temporary file beside the target and moves it over, so a crash leaves the old file or the new one, never half of one. */
async function replaceFile(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, data)
    await renameWithRetry(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined) // keep the real error, not a cleanup one
    throw e
  }
}

/** Windows briefly locks files that editors, watchers or antivirus have open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt === 5 || (code !== 'EPERM' && code !== 'EBUSY')) throw e
      await new Promise(done => setTimeout(done, 50 * attempt))
    }
  }
}
