import { parseFile } from '../core/modelfiles.ts'
import { blockedBy } from './files.ts'
import type { Loaded } from './files.ts'

/**
 * The two rules every write to a folder keeps, whoever carries it: MCP writes (mcp.ts) and a request to the local server or the
 * VS Code panel (writes.ts) both ask here first. How each reports a refusal differs (a tool error, an HTTP status), so these only
 * say what is wrong.
 *
 * What is not here on purpose: refusing an edit that adds problems needs the model before and after, so the callers that edit
 * a model (MCP, and the canvas in ui/src/save.ts) do it themselves with refuseNewProblems. A request that writes one file stays free
 * of it.
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
