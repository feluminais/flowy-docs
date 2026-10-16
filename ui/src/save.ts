import type { Model } from '../../src/core/model.ts'
import { refuseNewProblems } from '../../src/core/ops.ts'
import type { State } from '../../src/core/state.ts'
import { changesBetween } from './edit.ts'

export const CHANGED_OUTSIDE = 'This file changed outside Flowy. Reloaded.'

const text = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A State as the canvas's model. Throws with a message for the user when a file can't be read. */
export function fromState(state: State): { model: Model; versions: Record<string, string | null> } {
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    throw new Error(`Can't read ${file}${line === undefined ? '' : ` (line ${line})`}: ${message}. Fix the file and this page updates.`)
  }
  return { model: { ...state.model, flows: state.flows, layout: state.layout }, versions: state.versions }
}

/** GET /api/state as a model. Throws with a message for the user when the server or a file can't be read. */
export async function fetchModel(base = ''): Promise<{ model: Model; versions: Record<string, string | null> }> {
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

/**
 * One canvas edit, done the way MCP does it: read the files fresh, apply `op`, refuse new problems,
 * then write each changed file with the version just read. Resolves to what to tell the user,
 * or undefined once it's saved. `base` is the server's address, for tests.
 */
export async function saveEdit(op: (model: Model) => Model, base = ''): Promise<string | undefined> {
  try {
    const { model, versions } = await fetchModel(base)
    const next = op(model)
    refuseNewProblems(model, next)
    for (const { file, data } of changesBetween(model, next)) {
      const res = await fetch(`${base}/api/file/${file}`, {
        method: data === null ? 'DELETE' : 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Flowy': '1' },
        body: JSON.stringify(data === null ? { version: versions[file] ?? null } : { version: versions[file] ?? null, data }),
      })
      if (res.status === 409) return CHANGED_OUTSIDE
      if (!res.ok) return `Couldn't save ${file}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? `the server answered ${res.status}`}`
    }
  } catch (e) {
    return text(e)
  }
}
