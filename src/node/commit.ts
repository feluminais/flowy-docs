import type { Model } from '../core/model.ts'
import { changedFiles, changedLayout, parseFile } from '../core/modelfiles.ts'
import { OpError, refuseNewProblems } from '../core/ops.ts'
import { blockedBy, loadDir, loadRuns, missingPaths, saveFiles, VersionConflict } from './files.ts'
import type { Loaded } from './files.ts'
import type { History } from './history.ts'

/**
 * The two rules every write to a folder keeps, whoever carries it: MCP and `flowy tidy` (commitEdit below) and a request to the local
 * server or the VS Code panel (writes.ts) all ask here. How each reports a refusal differs (a tool error, an HTTP status, a line on
 * stderr), so these only say what is wrong.
 *
 * Refusing an edit that adds problems needs the model before and after, so it is in commitEdit and in the canvas's own save
 * (ui/src/save.ts), both through refuseNewProblems. A request that writes one file stays free of it.
 */

/** Why a write to `rel` is refused when `blocking`, a skipped analysis file, is in its way. */
export const blockedMessage = (blocking: string, rel: string): string =>
  blocking === rel
    ? `${rel} can't be read, so it isn't replaced. Fix or delete it by hand.`
    : `${blocking} is in the way (the same file name in other letters), so ${rel} isn't written. Rename or delete it by hand.`

/** The first of `rels` that a skipped analysis file keeps from being replaced or deleted, with the file in the way. */
export function firstBlocked(loaded: Loaded, rels: readonly string[]): { rel: string; blocking: string } | undefined {
  for (const rel of rels) {
    const blocking = blockedBy(loaded, rel)
    if (blocking !== undefined) return { rel, blocking }
  }
  return undefined
}

/** The first of `changes` that would not read back as the file it is (a null text deletes and is never checked), with what went wrong. */
export function firstUnreadable(changes: readonly (readonly [rel: string, text: string | null])[]): { rel: string; error: unknown } | undefined {
  for (const [rel, text] of changes) {
    if (text === null) continue
    try {
      parseFile(rel, text)
    } catch (error) {
      return { rel, error }
    }
  }
  return undefined
}

/**
 * One edit to the folder `dir`, the way every Node writer that edits a model does it, so the rules have one home: load fresh, apply `op`,
 * refuse new problems (missing code paths and failure modes naming a run that isn't there included), refuse to touch a skipped analysis
 * file or to write what can't be read back, make the files as they were a history step, write the changed files all or none, and record
 * `label` as the AI's step. Tries once more when a file changed underneath. `withLayout` writes layout.yaml too.
 * Resolves to the model as it was before the edit. A refusal is thrown: an OpError, or an Error that says what to tell the caller.
 */
export async function commitEdit(dir: string, op: (model: Model) => Model, { label, withLayout = false, history }: { label?: string; withLayout?: boolean; history?: History } = {}): Promise<Model> {
  for (let attempt = 1; ; attempt++) {
    try {
      const loaded = await loadDir(dir)
      const { model, versions } = loaded
      const next = op(model)
      // A run is a file in perf/, which the model doesn't hold: it can name a shape or a line the edit takes away, or be named by a failure mode.
      const { runs } = await loadRuns(dir, model)
      refuseNewProblems(model, next, missingPaths(dir, model, next), runs) // the canvas and the desktop refuse the same edits, except missing code paths, which only Node can see
      const changes = [...changedFiles(model, next), ...(withLayout ? changedLayout(model, next) : [])]
      // An analysis file that was skipped because it can't be read holds someone's work: it is never replaced or deleted.
      const blocked = firstBlocked(loaded, changes.map(([rel]) => rel))
      if (blocked) throw new OpError(`Refused, nothing saved. ${blockedMessage(blocked.blocking, blocked.rel)}`)
      // Never write what can't be read back: if saving and loading ever disagree, refuse instead of breaking the folder.
      const unreadable = firstUnreadable(changes)
      if (unreadable) throw new OpError(`Refused, nothing saved. The result couldn't be read back: ${unreadable.error instanceof Error ? unreadable.error.message : String(unreadable.error)}`)
      await history?.ensureCurrent('write')
      await saveFiles(dir, changes.map(([rel, text]) => ({ rel, text, expected: versions[rel] ?? null }))) // all or none
      await history?.record(label, 'ai')
      return model
    } catch (e) {
      if (!(e instanceof VersionConflict)) throw e
      if (attempt === 2) throw new Error(`Nothing saved: ${e.message}, twice in a row. Try again.`)
    }
  }
}
