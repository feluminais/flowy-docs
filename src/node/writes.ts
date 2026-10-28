import { compareOf } from '../core/compare.ts'
import { FILE_KINDS, idOfPath, isRunPath } from '../core/filekinds.ts'
import { draftModelId, isDraftId, newDraft } from '../core/drafts.ts'
import { emptyModel, ParseError } from '../core/model.ts'
import { isRemovableFile, serializeFile } from '../core/modelfiles.ts'
import { blockedMessage, firstBlocked, firstUnreadable } from './commit.ts'
import { hasDraft, modelOfDraft } from './drafts.ts'
import { createDraft } from './draftwrites.ts'
import { isAllowedPath, loadDir, loadRuns, OutsideFolder, saveFile, saveRunCompare, VersionConflict } from './files.ts'

/** What to answer a write with: an HTTP status and the JSON that goes with it. */
export type Answer = { status: number; body: unknown }

/**
 * `PUT /api/file/perf/<id>.yaml { version, data: { compare } }`: the one write a run takes. `compare` is an id, `{ with, note? }`, or null to take the
 * tag out; the rest of the run file stays as it is. Answers like any write.
 */
async function applyRunCompare(dir: string, rel: string, body: unknown, beforeWrite?: () => Promise<void>): Promise<Answer> {
  const { version, data } = (typeof body === 'object' && body !== null ? body : {}) as { version?: unknown; data?: unknown }
  if (typeof version !== 'string' && version !== null)
    return { status: 400, body: { error: 'the body needs "version": the file\'s version from /api/state' } }
  const keys = typeof data === 'object' && data !== null && !Array.isArray(data) ? Object.keys(data) : []
  if (keys.length !== 1 || keys[0] !== 'compare')
    return { status: 400, body: { error: 'a run takes one write: "data": { "compare": an id, { "with", "note" } or null }' } }
  const value = (data as { compare: unknown }).compare
  const tag = value === null ? undefined : compareOf(value)
  if (value !== null && tag === undefined) return { status: 400, body: { error: 'compare must be a run id, { "with", "note" } with text, or null' } }
  try {
    // Nothing is written while a model or flow file fails to parse, as for any other write.
    const loaded = await loadDir(dir)
    const blocked = firstBlocked(loaded, [rel])
    if (blocked) return { status: 409, body: { error: blockedMessage(blocked.blocking, rel) } }
    // A tag to a run that is not there is not written, here as in set_compare and the page's own check.
    if (tag !== undefined) {
      const id = idOfPath(FILE_KINDS.run, rel)
      if (tag.with === id) return { status: 400, body: { error: `run "${id}" cannot compare with itself` } }
      if (!Object.hasOwn((await loadRuns(dir, loaded.model)).runs, tag.with)) return { status: 400, body: { error: `unknown run "${tag.with}"` } }
    }
  } catch (e) {
    if (e instanceof ParseError) return { status: 409, body: { error: e.message } }
    throw e
  }
  try {
    return { status: 200, body: { version: await saveRunCompare(dir, rel, tag, version, beforeWrite) } }
  } catch (e) {
    if (e instanceof VersionConflict) return { status: 409, body: { version: e.version } }
    if (e instanceof ParseError) return { status: 400, body: { error: `not a valid ${rel}: ${e.reason}` } }
    throw e
  }
}

/**
 * `PUT /api/file/<rel> { version, data }` writes a file; `DELETE /api/file/flows/<id>.yaml { version }` removes a flow, and failures/ likewise an analysis.
 * This is what both do, for whoever carries the request: the local server over HTTP, the VS Code extension over its
 * webview. `body` is the request's JSON (undefined when it had none), `version` the file's version from the state
 * (null for a file that isn't there yet). `beforeWrite` runs once the write is certain to be tried, before it, so the
 * step history can keep the files as they are. Throws only for what goes wrong on the disk.
 */
export async function applyWrite(dir: string, method: string, rel: string, body: unknown, beforeWrite?: () => Promise<void>): Promise<Answer> {
  if (method === 'PUT' && isRunPath(rel)) return applyRunCompare(dir, rel, body, beforeWrite)
  if (!isAllowedPath(rel) || (method === 'DELETE' && !isRemovableFile(rel)))
    return { status: 400, body: { error: `can't write "${rel}"` } }
  const { version, data } = (typeof body === 'object' && body !== null ? body : {}) as { version?: unknown; data?: unknown }
  if (typeof version !== 'string' && version !== null)
    return { status: 400, body: { error: 'the body needs "version": the file\'s version from /api/state, or null for a new file' } }
  if (method === 'PUT' && data === undefined) return { status: 400, body: { error: 'the body needs "data"' } }
  try {
    // Nothing is written while a model or flow file fails to parse, and an analysis file that was skipped is never replaced or deleted.
    const loaded = await loadDir(dir)
    const blocked = firstBlocked(loaded, [rel])
    if (blocked) return { status: 409, body: { error: blockedMessage(blocked.blocking, rel) } }
  } catch (e) {
    if (e instanceof ParseError) return { status: 409, body: { error: e.message } }
    throw e
  }
  let text: string | null = null
  if (method === 'PUT') {
    try {
      text = serializeFile(rel, data)
    } catch (e) {
      return { status: 400, body: { error: `not a valid ${rel}: ${e instanceof ParseError ? e.reason : String(e)}` } }
    }
    const unreadable = firstUnreadable([[rel, text]]) // never write what can't be read back
    if (unreadable) return { status: 400, body: { error: `not a valid ${rel}: ${unreadable.error instanceof ParseError ? unreadable.error.reason : String(unreadable.error)}` } }
  }
  try {
    await beforeWrite?.() // the files as they are now become a step before this edit changes them
    return { status: 200, body: { version: await saveFile(dir, rel, text, version) } }
  } catch (e) {
    if (e instanceof VersionConflict) return { status: 409, body: { version: e.version } }
    if (e instanceof OutsideFolder) return { status: 400, body: { error: e.message } }
    throw e
  }
}

/**
 * `POST /api/drafts { id, name }` makes an empty draft of the model folder `dir` and answers with its served id, `model` being the folder's own
 * (see draftModelId). A draft holds no drafts, so a draft folder refuses it.
 */
export async function applyNewDraft(dir: string, model: string, body: unknown): Promise<Answer> {
  const { id, name } = (typeof body === 'object' && body !== null ? body : {}) as { id?: unknown; name?: unknown }
  if (typeof name !== 'string' || name.trim() === '') return { status: 400, body: { error: 'the body needs "name": what the draft is called' } }
  if (!isDraftId(id)) return { status: 400, body: { error: 'the body needs "id": lowercase letters, digits and dashes, not starting with a dash' } }
  if (modelOfDraft(dir) !== undefined) return { status: 400, body: { error: "a draft can't hold drafts" } }
  if (hasDraft(dir, id)) return { status: 409, body: { error: `there is a draft "${id}" already` } }
  await createDraft(dir, id, newDraft(emptyModel(), { name: name.trim() }))
  return { status: 201, body: { id: draftModelId(model, id) } }
}
