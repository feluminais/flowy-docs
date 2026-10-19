import type { Problem } from '../../src/core/check.ts'
import { fileData } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { refuseNewProblems } from '../../src/core/ops.ts'
import type { Run } from '../../src/core/perf.ts'
import type { State } from '../../src/core/state.ts'
import { changesBetween } from './edit.ts'
import { httpTransport } from './transport.ts'
import type { Reply, Transport } from './transport.ts'

export const CHANGED_OUTSIDE = 'This file changed outside Flowy. Reloaded.'

const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A State as the canvas's model, its problems, and where code links go. Throws with a message for the user when a file can't be read. */
export function fromState(state: State): { model: Model; versions: Record<string, string | null>; problems: Problem[]; codeBase?: string; runs: Record<string, Run>; runProblems: Problem[] } {
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    throw new Error(`Can't read ${file}${line === undefined ? '' : ` (line ${line})`}: ${message}. Fix the file and this page updates.`)
  }
  return { model: { ...state.model, flows: state.flows, layout: state.layout }, versions: state.versions, problems: state.problems, codeBase: state.codeBase, runs: state.runs ?? {}, runProblems: state.runProblems ?? [] }
}

/**
 * How the canvas reaches the folder: a Transport, or a string, which is the local server's address (for tests).
 * Left out, it is the page's own server.
 */
export type Via = Transport | string
const transportOf = (via: Via): Transport => (typeof via === 'string' ? httpTransport(via) : via)

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
const ok = (reply: Reply) => reply.status >= 200 && reply.status < 300
const errorOf = (reply: Reply) => (reply.body as { error?: string } | null)?.error
const versionOf = (reply: Reply) => (reply.body as { version: string | null }).version
const failed = (what: string, file: string, reply: Reply) => `Couldn't ${what} ${file}: ${errorOf(reply) ?? `the server answered ${reply.status}`}`

/**
 * How to take one saved edit back: per file, newest write first, what to put back (`data`), what the
 * file holds now (`now`), and the version it has now. Putting an edit back hands over the reverse,
 * which is how redo works.
 */
export type Undo = { file: string; data: unknown; now: unknown; version: string | null }[]

const stale = (word: 'undo' | 'redo') =>
  `Can't ${word}: this changed since, outside this page or in another tab. Nothing was ${word === 'undo' ? 'undone' : 'redone'}.`
export const UNDO_STALE = stale('undo')
export const REDO_STALE = stale('redo')

/**
 * One canvas edit, done the way MCP does it: read the files fresh, apply `op`, refuse new problems,
 * then write each changed file with the version just read. Resolves to what to tell the user,
 * or undefined once it's saved, and then hands `onSaved` how to undo it.
 */
export async function saveEdit(op: (model: Model) => Model, via: Via = '', onSaved?: (undo: Undo) => void): Promise<string | undefined> {
  try {
    const transport = transportOf(via)
    const { model, versions } = await fetchModel(transport)
    const next = op(model)
    refuseNewProblems(model, next)
    const undo: Undo = []
    for (const { file, data } of changesBetween(model, next)) {
      const reply = await write(transport, file, data, versions[file] ?? null)
      if (reply.status === 409) return CHANGED_OUTSIDE
      if (!ok(reply)) return failed('save', file, reply)
      // A flow that didn't exist goes away again. model.yaml and layout.yaml can't be deleted, so they go back to empty.
      const before = versions[file] == null && file.startsWith('flows/') ? null : fileData(model, file)
      undo.unshift({ file, data: before, now: data, version: versionOf(reply) })
    }
    if (undo.length) onSaved?.(undo)
  } catch (e) {
    return text(e)
  }
}

/**
 * Put back what one saved edit changed, but only where nothing changed since. It isn't checked for
 * problems: it goes back to what was saved before. Resolves to what to tell the user, or undefined
 * once it's done, and then hands `onDone` how to take this back in turn (a redo, or an undo of a redo).
 * `word` names it in messages.
 */
export async function undoEdit(undo: Undo, via: Via = '', onDone?: (back: Undo) => void, word: 'undo' | 'redo' = 'undo'): Promise<string | undefined> {
  try {
    const transport = transportOf(via)
    const back: Undo = []
    for (const { file, data, now, version } of undo) {
      const reply = await write(transport, file, data, version)
      // The server answers 409 both for a file that moved on and, with an error, while any file can't be read.
      if (reply.status === 409) {
        const error = errorOf(reply)
        return error === undefined ? stale(word) : `Can't ${word} while a file can't be read: ${error}`
      }
      if (!ok(reply)) return failed(word, file, reply)
      back.unshift({ file, data: now, now: data, version: versionOf(reply) })
    }
    onDone?.(back)
  } catch (e) {
    return text(e)
  }
}
