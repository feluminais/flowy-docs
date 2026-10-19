import { ParseError, parseFile, serializeFile } from '../core/model.ts'
import { isAllowedPath, loadDir, saveFile, VersionConflict } from './files.ts'

/** What to answer a write with: an HTTP status and the JSON that goes with it. */
export type Answer = { status: number; body: unknown }

/**
 * `PUT /api/file/<rel> { version, data }` writes a file; `DELETE /api/file/flows/<id>.yaml { version }` removes a flow.
 * This is what both do, for whoever carries the request: the local server over HTTP, the VS Code extension over its
 * webview. `body` is the request's JSON (undefined when it had none), `version` the file's version from the state
 * (null for a file that isn't there yet). `beforeWrite` runs once the write is certain to be tried, before it, so the
 * step history can keep the files as they are. Throws only for what goes wrong on the disk.
 */
export async function applyWrite(dir: string, method: string, rel: string, body: unknown, beforeWrite?: () => Promise<void>): Promise<Answer> {
  if (!isAllowedPath(rel) || (method === 'DELETE' && !rel.startsWith('flows/')))
    return { status: 400, body: { error: `can't write "${rel}"` } }
  const { version, data } = (typeof body === 'object' && body !== null ? body : {}) as { version?: unknown; data?: unknown }
  if (typeof version !== 'string' && version !== null)
    return { status: 400, body: { error: 'the body needs "version": the file\'s version from /api/state, or null for a new file' } }
  if (method === 'PUT' && data === undefined) return { status: 400, body: { error: 'the body needs "data"' } }
  try {
    await loadDir(dir) // nothing is written while any file fails to parse
  } catch (e) {
    if (e instanceof ParseError) return { status: 409, body: { error: e.message } }
    throw e
  }
  let text: string | null = null
  if (method === 'PUT') {
    try {
      text = serializeFile(rel, data)
      parseFile(rel, text) // never write what can't be read back
    } catch (e) {
      return { status: 400, body: { error: `not a valid ${rel}: ${e instanceof ParseError ? e.reason : String(e)}` } }
    }
  }
  try {
    await beforeWrite?.() // the files as they are now become a step before this edit changes them
    return { status: 200, body: { version: await saveFile(dir, rel, text, version) } }
  } catch (e) {
    if (e instanceof VersionConflict) return { status: 409, body: { version: e.version } }
    throw e
  }
}
