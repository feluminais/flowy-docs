import { REDO_STALE, restoreIsStale, restoreVersion, UNDO_STALE, undoEdit } from './save.ts'
import type { RestoreDone, Undo, Via } from './save.ts'

/**
 * One thing to take back or put back: a saved edit, or a restore. A restore is put back by restoring the step that holds what it replaced,
 * and only where the files are still as it left them (`seen`), the way an edit goes back only where nothing changed since. Both carry the
 * label they are named by in the history.
 */
export type Entry = { kind: 'edit'; undo: Undo; label: string } | { kind: 'restore'; to: string; label: string; seen: Record<string, string | null> }

/**
 * The entry for a restore that was just done, or none when there is nothing to take back: it failed, it had no step before it to go back to,
 * or it changed no file. `seen` is what the files were when it was asked for.
 */
export function entryAfterRestore(done: RestoreDone, seen: Record<string, string | null>, label: string): Entry | undefined {
  if (done.message !== undefined || done.before === undefined || done.versions === undefined) return undefined
  const changed = Object.entries(done.versions).some(([file, version]) => (seen[file] ?? null) !== version)
  return changed ? { kind: 'restore', to: done.before, label, seen: done.versions } : undefined
}

/**
 * Takes one entry back (`word` 'undo') or puts it back ('redo'). Answers what to tell the user, the entry that reverses this move, and
 * whether the entry can never be replayed as it stands (the files moved on, or its step is gone), so that older entries, which would go
 * back past that, are dropped with it. A failure that may pass leaves the entry where it was.
 */
export async function replay(entry: Entry, word: 'undo' | 'redo', via: Via): Promise<{ message?: string; reverse?: Entry; stale: boolean }> {
  const stale = word === 'undo' ? UNDO_STALE : REDO_STALE
  if (entry.kind === 'edit') {
    let reverse: Entry | undefined
    const message = await undoEdit(entry.undo, via, back => { reverse = { kind: 'edit', undo: back, label: entry.label } }, word, entry.label)
    return { ...(message === undefined ? {} : { message }), ...(reverse ? { reverse } : {}), stale: message === stale }
  }
  const done = await restoreVersion(entry.to, `${word === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}`, via, entry.seen)
  if (done.message !== undefined) return restoreIsStale(done.status) ? { message: stale, stale: true } : { message: done.message, stale: false }
  const reverse = done.before !== undefined && done.versions !== undefined ? { kind: 'restore' as const, to: done.before, label: entry.label, seen: done.versions } : undefined
  return { ...(reverse ? { reverse } : {}), stale: false }
}
