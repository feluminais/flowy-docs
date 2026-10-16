import type { Problem } from '../../src/core/check.ts'
import { fileData } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { refuseNewProblems } from '../../src/core/ops.ts'
import type { State } from '../../src/core/state.ts'
import { changesBetween } from './edit.ts'

export const CHANGED_OUTSIDE = 'This file changed outside Flowy. Reloaded.'

const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A State as the canvas's model, its problems, and where code links go. Throws with a message for the user when a file can't be read. */
export function fromState(state: State): { model: Model; versions: Record<string, string | null>; problems: Problem[]; codeBase?: string } {
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    throw new Error(`Can't read ${file}${line === undefined ? '' : ` (line ${line})`}: ${message}. Fix the file and this page updates.`)
  }
  return { model: { ...state.model, flows: state.flows, layout: state.layout }, versions: state.versions, problems: state.problems, codeBase: state.codeBase }
}

/** GET /api/state as a model. Throws with a message for the user when the server or a file can't be read. */
export async function fetchModel(base = ''): Promise<ReturnType<typeof fromState>> {
  let state: State
  try {
    const res = await fetch(`${base}/api/state`)
    if (!res.ok) throw new Error(`the server answered ${res.status}`)
    state = (await res.json()) as State
  } catch (e) {
    throw new Error(`Can't load the model: ${text(e)}`)
  }
  return fromState(state)
}

/** PUT a file's content, or DELETE it when `data` is null, but only if it's still at `version`. */
const write = (base: string, file: string, data: unknown, version: string | null) => fetch(`${base}/api/file/${file}`, {
  method: data === null ? 'DELETE' : 'PUT',
  headers: { 'Content-Type': 'application/json', 'X-Flowy': '1' },
  body: JSON.stringify(data === null ? { version } : { version, data }),
})
const failed = async (what: string, file: string, res: Response) =>
  `Couldn't ${what} ${file}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? `the server answered ${res.status}`}`

/** How to take one saved edit back: per file, newest write first, what it held before and the version the save left. */
export type Undo = { file: string; data: unknown; version: string | null }[]

export const UNDO_STALE = "Can't undo: this changed since, outside this page or in another tab. Nothing was undone."

/**
 * One canvas edit, done the way MCP does it: read the files fresh, apply `op`, refuse new problems,
 * then write each changed file with the version just read. Resolves to what to tell the user,
 * or undefined once it's saved, and then hands `onSaved` how to undo it. `base` is the server's address, for tests.
 */
export async function saveEdit(op: (model: Model) => Model, base = '', onSaved?: (undo: Undo) => void): Promise<string | undefined> {
  try {
    const { model, versions } = await fetchModel(base)
    const next = op(model)
    refuseNewProblems(model, next)
    const undo: Undo = []
    for (const { file, data } of changesBetween(model, next)) {
      const res = await write(base, file, data, versions[file] ?? null)
      if (res.status === 409) return CHANGED_OUTSIDE
      if (!res.ok) return await failed('save', file, res)
      // A flow that didn't exist goes away again. model.yaml and layout.yaml can't be deleted, so they go back to empty.
      const before = versions[file] == null && file.startsWith('flows/') ? null : fileData(model, file)
      undo.unshift({ file, data: before, version: ((await res.json()) as { version: string | null }).version })
    }
    if (undo.length) onSaved?.(undo)
  } catch (e) {
    return text(e)
  }
}

/**
 * Put back what one saved edit changed, but only where nothing changed since. It isn't checked for
 * problems: it goes back to what was saved before. Resolves to what to tell the user, or undefined.
 */
export async function undoEdit(undo: Undo, base = ''): Promise<string | undefined> {
  try {
    for (const { file, data, version } of undo) {
      const res = await write(base, file, data, version)
      if (res.status === 409) return UNDO_STALE
      if (!res.ok) return await failed('undo', file, res)
    }
  } catch (e) {
    return text(e)
  }
}
