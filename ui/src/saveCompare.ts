import type { CompareTag } from '../../src/core/compare.ts'
import { setCompare } from '../../src/core/ops.ts'
import { CHANGED_OUTSIDE, errorOf, failed, fetchModel, ok, saveEdit, transportOf } from './save.ts'
import type { Via } from './save.ts'

/**
 * Writes the `compare` tag of a flow or a run (see core/compare.ts): the older one it names, and maybe a note; `undefined` takes the tag out. `id` is the newer one, which
 * holds the tag. A flow is an edit like any other (saveEdit: refused for an unknown flow or one that compares with itself, named in the history as "Linked ... with ...",
 * "Unlinked ..." or "Noted ..."). A run is a file the page never rewrites, so only its tag goes in, in place, with the version just read; the history does not keep it.
 * Resolves to what to tell the user, or undefined once it is saved.
 */
export async function saveCompare(kind: 'flow' | 'run', id: string, tag: CompareTag | undefined, via: Via = ''): Promise<string | undefined> {
  if (kind === 'flow') return saveEdit(model => setCompare(model, id, tag), via)
  try {
    const transport = transportOf(via)
    const { runs, versions } = await fetchModel(transport)
    const file = `perf/${id}.yaml`
    // The same refusals as a flow's, in the same words.
    if (!Object.hasOwn(runs, id)) return `unknown run "${id}"`
    if (tag !== undefined && tag.with === id) return `run "${id}" cannot compare with itself`
    if (tag !== undefined && !Object.hasOwn(runs, tag.with)) return `unknown run "${tag.with}"`
    const reply = await transport.write('PUT', file, { version: versions[file] ?? null, data: { compare: tag === undefined ? null : tag.note === undefined ? tag.with : { with: tag.with, note: tag.note } } })
    if (!ok(reply)) return reply.status === 409 && errorOf(reply) === undefined ? CHANGED_OUTSIDE : failed('save', file, reply)
    // No step for it: the history keeps only the files Flowy writes whole (restoring a step puts those back and removes the rest), and a run is not one. A label asked for here would
    // find the files unchanged and go on the newest step, which is about something else.
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}
