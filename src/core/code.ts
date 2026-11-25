import type { Model } from './model.ts'
import { isRepoPath } from './paths.ts'
import { isMap } from './text.ts'

/**
 * One entry of a `code` list, read: a file or folder in the repo, relative to the folder that holds flowy/, and for a file the line to open it at.
 * The list is written as text, `path` or `path:line` (`src/api/orders.ts:42`). Shapes, connections, flows, flow steps, failure modes and payloads
 * all take one, and the readers draw each entry as the path with buttons that open it.
 */
export type CodeRef = { path: string; line?: number }

/** The largest line a `code` entry may name: seven digits, more than any file a person would link to. */
export const MAX_CODE_LINE = 9_999_999

/** An entry of a `code` list read as a path and a line, or undefined when it is neither a path in the repo nor one with `:line` after a file. */
export function readCodeRef(entry: string): CodeRef | undefined {
  const cut = /^(.+):([1-9][0-9]{0,6})$/.exec(entry)
  if (cut && isRepoPath(cut[1]) && !cut[1].endsWith('/')) return { path: cut[1], line: Number(cut[2]) }
  return isRepoPath(entry) ? { path: entry } : undefined
}

/** An entry as a `code` list writes it. */
export const codeText = (ref: CodeRef): string => (ref.line === undefined ? ref.path : `${ref.path}:${ref.line}`)

/** The entries of a `code` list that read as paths, in the order written. Anything else in it is left to check(). */
export function codeRefsOf(code: unknown): CodeRef[] {
  if (!Array.isArray(code)) return []
  return code.flatMap(entry => {
    const ref = typeof entry === 'string' ? readCodeRef(entry) : undefined
    return ref ? [ref] : []
  })
}

/** What is wrong with a `code` list, one message each, without the name of what holds it. `absent` holds the paths that don't exist (only Node and the desktop can tell). */
export function codeProblems(code: unknown, absent: ReadonlySet<string>): string[] {
  if (code === undefined) return []
  if (!Array.isArray(code) || code.some(c => typeof c !== 'string')) return ['code must be a list of paths']
  return (code as string[]).flatMap(entry => {
    const ref = readCodeRef(entry)
    if (!ref) {
      const cut = /^(.+):[0-9]+$/.exec(entry)
      if (cut && isRepoPath(cut[1]))
        return [cut[1].endsWith('/') ? `code path "${entry}" is a folder, which has no lines` : `code path "${entry}": the line must be a whole number from 1 to ${MAX_CODE_LINE}`]
      return [`code path "${entry}" must be relative, with / between folders and no "." or ".." parts`]
    }
    return absent.has(ref.path) ? [`code path "${entry}" doesn't exist`] : []
  })
}

/** A payload written in place on a line or a step: a mapping (an id names one under `payloads:`, which is listed once there). */
const inPlace = (ref: unknown): unknown[] => (isMap(ref) ? [ref.code] : [])

/**
 * Every `code` list in the model, as the files hold them: each shape's, each connection's and the payloads written on it, each flow's and each of its
 * steps' (with the payload and reply written on it), each failure mode's, and each payload's under `payloads:` in model.yaml. A list may be anything a
 * file holds; check() reports one that is not a list of paths.
 */
export function codeLists(model: Model): unknown[] {
  const named = isMap(model.meta.payloads) ? Object.values(model.meta.payloads).flatMap(inPlace) : []
  return [
    ...Object.values(model.objects).map(o => o.code),
    ...model.connections.flatMap(c => [c.code, ...(Array.isArray(c.payloads) ? c.payloads.flatMap(inPlace) : [])]),
    ...Object.values(model.flows).flatMap(f => [f.code, ...f.steps.flatMap(s => [s.code, ...inPlace(s.payload), ...inPlace(s.reply)])]),
    ...Object.values(model.failures).flatMap(a => Object.values(a.modes).map(m => m.code)),
    ...named,
  ].filter(list => list !== undefined)
}

/** The paths every `code` list in the model names (lines left off), each once, for the file system to say which are missing. */
export function codePaths(model: Model): string[] {
  return [...new Set(codeLists(model).flatMap(list => codeRefsOf(list).map(r => r.path)))]
}
