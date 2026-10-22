import type { StepFile, StepInfo, StepSource } from '../../src/core/history.ts'
import { diffLines } from '../../src/core/linediff.ts'

/** One line of the text the YAML tab shows. A `note` stands in for text that cannot be shown. */
export type Row = { kind: 'same' | 'add' | 'remove' | 'note'; text: string; line?: number }

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** The files in the order the tab lists them: the model, then the flows by name, then the layout. */
export function fileOrder(paths: string[]): string[] {
  const rank = (path: string) => (path === 'model.yaml' ? 0 : path === 'layout.yaml' ? 2 : 1)
  return [...paths].sort((a, b) => rank(a) - rank(b) || byCodeUnit(a, b))
}

/** The file to show first: the open flow's, else the model, else the first there is. */
export function defaultFile(paths: string[], context: { flow?: string }): string {
  const flow = context.flow === undefined ? undefined : `flows/${context.flow}.yaml`
  if (flow !== undefined && paths.includes(flow)) return flow
  if (paths.includes('model.yaml')) return 'model.yaml'
  return fileOrder(paths)[0] ?? 'model.yaml'
}

/** The lines of a text; a final newline adds no empty line. */
function linesOf(text: string): string[] {
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * The rows of one file of the version being shown, marked against `base`: added lines are in the shown version and not in the base, removed
 * ones are in the base and not in the shown version. Without a base nothing is marked. A removed line has no number; the others have the
 * shown version's own.
 */
export function rowsFor(file: string, shown: Record<string, StepFile>, base: Record<string, StepFile> | undefined): Row[] {
  const now = shown[file]
  const was = base?.[file]
  if (now && 'notText' in now) return [{ kind: 'note', text: 'Not UTF-8 text' }]
  if (!now) {
    if (!was) return []
    return 'notText' in was
      ? [{ kind: 'note', text: 'Not in this version' }]
      : [{ kind: 'note', text: 'Not in this version' }, ...linesOf(was.text).map((text): Row => ({ kind: 'remove', text }))]
  }
  if (base === undefined || (was && 'notText' in was)) return linesOf(now.text).map((text, i): Row => ({ kind: 'same', text, line: i + 1 }))
  if (!was) return linesOf(now.text).map((text, i): Row => ({ kind: 'add', text, line: i + 1 }))
  return diffLines(was.text, now.text)
}

/** The index of the first line added or removed, to bring into view. */
export function firstMark(rows: Row[]): number | undefined {
  const index = rows.findIndex(row => row.kind === 'add' || row.kind === 'remove')
  return index < 0 ? undefined : index
}

/**
 * The row to bring into view. After a new version, file or comparison: the first mark, else the shape's block, else the top. After a new
 * selection only the shape's block, and where it has none, nothing: the scroll stays where the reader left it.
 */
export function scrollTarget(rows: Row[], block: { start: number; end: number } | undefined, why: 'version' | 'selection'): number | undefined {
  const mark = why === 'version' ? firstMark(rows) : undefined
  if (mark !== undefined) return mark
  const at = block ? rows.findIndex(r => r.line === block.start) : -1
  if (at >= 0) return at
  return why === 'version' ? 0 : undefined
}

const isBlankOrComment =(line: string) => line.trim() === '' || line.trim().startsWith('#')
const indentOf = (line: string) => line.length - line.trimStart().length

/** The key a mapping line starts with: plain, or in single or double quotes. */
function keyOf(line: string): string | undefined {
  const found = /^(?:"([^"]*)"|'([^']*)'|([^:#\s][^:]*?))\s*:(?:\s|$)/.exec(line.trim())
  return found ? (found[1] ?? found[2] ?? found[3]) : undefined
}

/**
 * Where a shape sits in a model.yaml text: the 1-based, inclusive lines from its key to the last line indented under it. Found from the
 * indentation of the first entry under `objects:`, so it holds for block style, for an entry on one line, and for quoted ids.
 */
export function blockOf(text: string, id: string): { start: number; end: number } | undefined {
  const lines = text.split(/\r?\n/)
  const root = lines.findIndex(line => /^objects:\s*(#.*)?$/.test(line))
  if (root < 0) return undefined
  let entryIndent = -1
  let found = -1
  for (let i = root + 1; i < lines.length && found < 0; i++) {
    if (isBlankOrComment(lines[i])) continue
    const indent = indentOf(lines[i])
    if (indent === 0) break // the next top-level key: the objects are over
    if (entryIndent < 0) entryIndent = indent
    if (indent === entryIndent && keyOf(lines[i]) === id) found = i
  }
  if (found < 0) return undefined
  let end = found
  for (let i = found + 1; i < lines.length; i++) {
    if (isBlankOrComment(lines[i])) continue
    if (indentOf(lines[i]) <= entryIndent) break
    end = i
  }
  return { start: found + 1, end: end + 1 }
}

/** The clock for a time on the same day as `now`, else the short date and the clock. `locale` and `timeZone` are the reader's unless given. */
export function timeLabel(iso: string, now: Date, locale?: string, timeZone?: string): string {
  const at = new Date(iso)
  const clock = formatter('clock', locale, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  const day = (date: Date) => formatter('day', 'en-CA', timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
  if (day(at) === day(now)) return clock
  return `${formatter('date', locale, timeZone, { month: 'short', day: 'numeric' }).format(at)}, ${clock}`
}

/** Building a formatter costs far more than using one, and a list of steps asks for hundreds of times at every render. */
const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(kind: string, locale: string | undefined, timeZone: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${kind}|${locale ?? ''}|${timeZone ?? ''}`
  let found = formatters.get(key)
  if (!found) {
    found = new Intl.DateTimeFormat(locale, { ...options, timeZone })
    formatters.set(key, found)
  }
  return found
}

/** The label of a restore: "Restored the version from 10:15". */
export const restoreLabel = (iso: string, now: Date, locale?: string, timeZone?: string): string => `Restored the version from ${timeLabel(iso, now, locale, timeZone)}`

/** The chip on a step in the list. The first look at a folder has none: its label says it. */
export const SOURCE_NAMES: Record<StepSource, string | undefined> = { you: 'You', ai: 'AI', outside: 'Outside', restore: 'Restored', first: undefined }

/** The step above (`-1`, newer) or below (`1`, older) one in a newest-first list; from no step, or one that is gone, the newest. */
export function neighbour(steps: StepInfo[], id: string | undefined, delta: -1 | 1): string | undefined {
  if (steps.length === 0) return undefined
  const at = id === undefined ? -1 : steps.findIndex(step => step.id === id)
  return at < 0 ? steps[0].id : steps[at + delta]?.id
}

/** Putting an earlier version back is a write, so it needs edit mode, unless the model is broken and edit mode cannot be turned on. */
export const canRestore = (s: { editing: boolean; broken: boolean }): boolean => s.editing || s.broken
