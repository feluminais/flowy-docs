import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { emptyModel, ParseError, parseFlowFile, parseLayoutFile, parseModelFile } from '../core/model.ts'
import type { Model } from '../core/model.ts'

/** The model plus a content hash per file (null = file missing), used to detect outside edits. */
export type Loaded = { model: Model; versions: Record<string, string | null> }

/** The file changed since the caller read it. */
export class VersionConflict extends Error {
  name = 'VersionConflict'
}

const ALLOWED = /^(model\.yaml|layout\.yaml|flows\/(?!root\.yaml$)[a-z0-9][a-z0-9-]*\.yaml)$/
export const isAllowedPath = (rel: unknown): rel is string => typeof rel === 'string' && ALLOWED.test(rel)

export const hashText = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

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
  const entries = await readdir(join(dir, 'flows'), { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return []
    throw e
  })
  const names = entries.filter(e => (e.isFile() || e.isSymbolicLink()) && e.name.endsWith('.yaml')).map(e => e.name).sort()
  for (const name of names) {
    const text = await read(`flows/${name}`)
    const id = name.slice(0, -'.yaml'.length)
    if (text !== null) model.flows[id] = parseFlowFile(id, text)
  }
  return { model, versions }
}

const queues = new Map<string, Promise<unknown>>()

/**
 * Write one file under dir (null deletes it), but only if it still has the version the caller
 * read; null or undefined means it must not exist yet. Saves to the same file run one at a
 * time, so of two racing callers one wins and the other gets VersionConflict.
 */
export async function saveFile(dir: string, rel: string, text: string | null, expected: string | null | undefined): Promise<string | null> {
  if (!isAllowedPath(rel)) throw new Error(`refusing to write "${rel}"`)
  const key = resolve(dir, rel)
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(() => saveNow(dir, rel, text, expected ?? null))
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
  // ponytail: saves are serialized per file inside this process only. Another process or an
  // editor saving between this check and the rename can still be overwritten; add a lock file
  // if that ever bites. No fsync either: a power cut mid-save can leave an empty file (git has it).
  if ((current === null ? null : hashText(current)) !== expected) throw new VersionConflict(`${rel} changed since it was read`)
  if (text === null) {
    await rm(path, { force: true, maxRetries: 4, retryDelay: 50 })
    return null
  }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, text)
    await renameWithRetry(tmp, path)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined) // keep the real error, not a cleanup one
    throw e
  }
  return hashText(text)
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
