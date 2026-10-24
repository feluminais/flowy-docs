import type { Problem } from '../../src/core/problem.ts'
import { describeEdit } from '../../src/core/editlabel.ts'
import { fallbackLabel } from '../../src/core/history.ts'
import { fileData, isRemovableFile } from '../../src/core/modelfiles.ts'
import type { Model } from '../../src/core/model.ts'
import { refuseNewProblems } from '../../src/core/ops.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { modelOf } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { changesBetween } from './edit.ts'
import { httpTransport } from './transport.ts'
import type { Reply, Transport } from './transport.ts'

export const CHANGED_OUTSIDE = 'This file changed outside Flowy. Reloaded.'

const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

type Loaded = { model: Model; versions: Record<string, string | null>; problems: Problem[]; codeBase?: string; runs: Record<string, Run>; runProblems: Problem[]; failureProblems: Problem[] }
const loaded = new WeakMap<State, Loaded>()

/**
 * A State as the canvas's model, its problems, and where code links go. Throws with a message for the user when a file can't be read.
 * The same State gives the same answer, so a page that reads an unchanged folder again keeps the model it has, and everything worked out from it.
 */
export function fromState(state: State): Loaded {
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    throw new Error(`Can't read ${file}${line === undefined ? '' : ` (line ${line})`}: ${message}. Fix the file and this page updates.`)
  }
  let made = loaded.get(state)
  if (!made) loaded.set(state, (made = { model: modelOf(state), versions: state.versions, problems: state.problems, codeBase: state.codeBase, runs: state.runs ?? {}, runProblems: state.runProblems ?? [], failureProblems: state.failureProblems ?? [] }))
  return made
}

/**
 * How the canvas reaches the folder: a Transport, or a string, which is the local server's address (for tests).
 * Left out, it is the page's own server.
 */
export type Via = Transport | string
export const transportOf = (via: Via): Transport => (typeof via === 'string' ? httpTransport(via) : via)

/** The folder's State as a model. Throws with a message for the user when the server or a file can't be read. */
export async function fetchModel(via: Via = ''): Promise<ReturnType<typeof fromState>> {
  let state: State
  try {
    state = await transportOf(via).state()
  } catch (e) {
    throw new Error(`Can't load the model: ${text(e)}`)
  }
  return fromState(state)
}

/** PUT a file's content, or DELETE it when `data` is null, but only if it's still at `version`. */
const write = (transport: Transport, file: string, data: unknown, version: string | null) =>
  data === null ? transport.write('DELETE', file, { version }) : transport.write('PUT', file, { version, data })
export const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300
export const errorOf = (reply: Reply) => (reply.body as { error?: string } | null)?.error
const versionOf = (reply: Reply) => (reply.body as { version: string | null }).version
export const failed = (what: string, file: string, reply: Reply) => `Couldn't ${what} ${file}: ${errorOf(reply) ?? `the server answered ${reply.status}`}`

/**
 * How to take one saved edit back: per file, newest write first, what to put back (`data`), what the
 * file holds now (`now`), and the version it has now. Putting an edit back hands over the reverse,
 * which is how redo works.
 */
export type Undo = { file: string; data: unknown; now: unknown; version: string | null }[]

/** One file of a batch: what to write, the version it must still have, and what to put back if the batch fails. */
type Step = { file: string; data: unknown; version: string | null; revert: unknown }

/** What a batch came to: the files it wrote (each with the version it has now), and why it stopped, if it did. */
type Batch = { written: Undo; failure?: { file: string; reply: Reply }; stuck: Undo }

/**
 * Writes the files of one edit in order, and when one fails puts back the ones already written, newest first, so the edit is never half done.
 * `written` is then empty. A file that can't be put back (it changed since, or the server says no) is `stuck`: it holds the new text, and
 * `written` is just those.
 */
async function writeBatch(transport: Transport, steps: readonly Step[]): Promise<Batch> {
  const written: Undo = []
  for (const { file, data, version, revert } of steps) {
    const reply = await write(transport, file, data, version).catch((e): Reply => ({ status: 0, body: { error: text(e) } })) // a transport that throws is a failed write too
    if (!ok(reply)) return { ...(await putBack(transport, written)), failure: { file, reply } }
    written.unshift({ file, data: revert, now: data, version: versionOf(reply) })
  }
  return { written, stuck: [] }
}

/** Puts back every file of `written` (newest first). The ones that can't be put back are `stuck`, and `written` again. */
async function putBack(transport: Transport, written: Undo): Promise<{ written: Undo; stuck: Undo }> {
  const stuck: Undo = []
  for (const w of written) {
    const reply = await write(transport, w.file, w.data, w.version).catch((): Reply => ({ status: 0, body: {} }))
    if (!ok(reply)) stuck.push(w)
  }
  return { written: stuck, stuck }
}

/** What to add to a failure when some files could not be put back. */
const notPutBack = (why: string, stuck: Undo): string =>
  stuck.length === 0 ? why : `${/[.!?]$/.test(why) ? why : `${why}.`} ${stuck.map(s => s.file).join(', ')} was saved first and could not be put back.`

const stale = (word: 'undo' | 'redo') =>
  `Can't ${word}: this changed since, outside this page or in another tab. Nothing was ${word === 'undo' ? 'undone' : 'redone'}.`
export const UNDO_STALE = stale('undo')
export const REDO_STALE = stale('redo')

/** Tells the history what a saved edit did and hands `onSaved` how to undo it, with the label. */
async function record(transport: Transport, model: Model, next: Model, changes: { file: string }[], undo: Undo, onSaved?: (undo: Undo, label: string) => void): Promise<void> {
  const label = describeEdit(model, next) ?? fallbackLabel(changes.map(c => c.file))
  await transport.history?.record(label)
  onSaved?.(undo, label)
}

/**
 * One canvas edit, done the way MCP does it: read the files fresh, apply `op`, refuse new problems,
 * then write each changed file with the version just read. Resolves to what to tell the user,
 * or undefined once it's saved, and then tells the history what the edit did (see describeEdit) and
 * hands `onSaved` how to undo it, with that label.
 */
export async function saveEdit(op: (model: Model) => Model, via: Via = '', onSaved?: (undo: Undo, label: string) => void): Promise<string | undefined> {
  try {
    const transport = transportOf(via)
    const { model, versions, runs } = await fetchModel(transport)
    const next = op(model)
    refuseNewProblems(model, next, undefined, runs)
    const changes = changesBetween(model, next)
    // A flow or analysis that didn't exist goes away again. model.yaml and layout.yaml can't be deleted, so they go back to empty.
    const steps = changes.map(({ file, data }): Step => ({ file, data, version: versions[file] ?? null, revert: versions[file] == null && isRemovableFile(file) ? null : fileData(model, file) }))
    const batch = await writeBatch(transport, steps)
    const undo = batch.written
    if (batch.failure) {
      const { file, reply } = batch.failure
      // A 409 with nothing said is a file that moved on since it was read. One that says why (a file that can't be read, an analysis in the way) is told as it is.
      const why = reply.status === 409 && errorOf(reply) === undefined ? CHANGED_OUTSIDE : failed('save', file, reply)
      if (undo.length) await record(transport, model, next, changes, undo, onSaved)
      return notPutBack(why, batch.stuck)
    }
    if (undo.length) await record(transport, model, next, changes, undo, onSaved)
    return undefined
  } catch (e) {
    return text(e)
  }
}

/**
 * Put back what one saved edit changed, but only where nothing changed since. It isn't checked for
 * problems: it goes back to what was saved before. Resolves to what to tell the user, or undefined
 * once it's done, and then hands `onDone` how to take this back in turn (a redo, or an undo of a redo).
 * `word` names it in messages. With the `label` of the edit, the history gets a step: "Undid: <label>" or "Redid: <label>".
 */
export async function undoEdit(undo: Undo, via: Via = '', onDone?: (back: Undo) => void, word: 'undo' | 'redo' = 'undo', label?: string): Promise<string | undefined> {
  try {
    const transport = transportOf(via)
    const batch = await writeBatch(transport, undo.map(({ file, data, now, version }): Step => ({ file, data, version, revert: now })))
    if (batch.failure) {
      const { file, reply } = batch.failure
      // The server answers 409 both for a file that moved on and, with an error, while any file can't be read.
      let why: string
      if (reply.status === 409) {
        const error = errorOf(reply)
        why = error === undefined ? stale(word) : `Can't ${word} while a file can't be read: ${error}`
      } else why = failed(word, file, reply)
      // Files that could not be put back stay as the failed attempt left them; the entry is no longer a clean undo, so it hands over no redo.
      return notPutBack(why, batch.stuck)
    }
    const back = batch.written
    if (label !== undefined) await transport.history?.record(`${word === 'undo' ? 'Undid' : 'Redid'}: ${label}`.slice(0, MAX_STEP_LABEL))
    onDone?.(back)
    return undefined
  } catch (e) {
    return text(e)
  }
}

/** The longest label a step of the history takes, as src/node/history-api.ts checks it. */
const MAX_STEP_LABEL = 200

/**
 * What a restore came to: the step that holds what the files were just before and the version each file has now (null: gone), or what to tell
 * the user and the HTTP status that refused it (404: the step is gone, 409: a file changed since it was read).
 */
export type RestoreDone = { message?: string; status?: number; before?: string; versions?: Record<string, string | null> }

/** Whether a refused restore will never succeed as it stands: its step is gone, or the files moved on. Anything else may pass on a second try. */
export const restoreIsStale = (status: number | undefined): boolean => status === 404 || status === 409

/**
 * Puts an earlier version of the folder's files back (see the YAML tab), as one step of the history. `seen` is the version of each file the
 * caller last read; left out, the files are read now. Putting back `before` undoes the restore.
 */
export async function restoreVersion(id: string, label: string, via: Via = '', seen?: Record<string, string | null>): Promise<RestoreDone> {
  try {
    const history = transportOf(via).history
    if (!history) return { message: "History isn't available here." }
    const answer = await history.restore(id, seen ?? (await history.yaml()).versions, label)
    return answer.ok ? { versions: answer.versions, ...(answer.before ? { before: answer.before } : {}) } : { message: answer.message, status: answer.status }
  } catch (e) {
    return { message: text(e) }
  }
}
