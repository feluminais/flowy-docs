import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { emptyModel, parseFlowFile, parseLayoutFile, parseModelFile } from '../core/model.ts'
import type { Model } from '../core/model.ts'

/** The model plus a content hash per file (null = file missing), used to detect outside edits. */
export type Loaded = { model: Model; versions: Record<string, string | null> }

/** The file changed since the caller read it. */
export class VersionConflict extends Error {}

const ALLOWED = /^(model\.yaml|layout\.yaml|flows\/[a-z0-9][a-z0-9-]*\.yaml)$/
export const isAllowedPath = (rel: string) => ALLOWED.test(rel)

export const hashText = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

/** Read the whole flowy/ folder. A missing folder or file counts as empty. Throws ParseError. */
export async function loadDir(dir: string): Promise<Loaded> {
  const versions: Record<string, string | null> = {}
  const read = async (rel: string) => {
    const text = await readText(join(dir, rel))
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
  const names = await readdir(join(dir, 'flows')).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return [] as string[]
    throw e
  })
  for (const name of names.filter(n => n.endsWith('.yaml')).sort()) {
    const text = await read(`flows/${name}`)
    const id = name.slice(0, -'.yaml'.length)
    if (text !== null) model.flows[id] = parseFlowFile(id, text)
  }
  return { model, versions }
}

/**
 * Write one file under dir (null deletes it), but only if it still has the version the
 * caller read. The text goes to a temp file first and is renamed into place.
 */
export async function saveFile(dir: string, rel: string, text: string | null, expected: string | null): Promise<string | null> {
  if (!isAllowedPath(rel)) throw new Error(`refusing to write "${rel}"`)
  const path = join(dir, rel)
  const current = await readText(path)
  // ponytail: check-then-write leaves a few-ms window; add a lock file if two writers ever race in practice
  if ((current === null ? null : hashText(current)) !== expected) throw new VersionConflict(`${rel} changed since it was read`)
  if (text === null) {
    await rm(path, { force: true })
    return null
  }
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}-${Date.now()}.tmp`
  await writeFile(tmp, text)
  await renameWithRetry(tmp, path)
  return hashText(text)
}

/** Windows briefly locks files that editors, watchers or antivirus have open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt === 5 || (code !== 'EPERM' && code !== 'EBUSY')) {
        await rm(from, { force: true })
        throw e
      }
      await new Promise(resolve => setTimeout(resolve, 50 * attempt))
    }
  }
}
