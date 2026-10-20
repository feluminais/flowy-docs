import { isMap } from './model.ts'
import type { FlowyObject } from './model.ts'

/** How much of a store's data the section shows, so it stays a picture of the few tables that matter and never a dump. */
export const DATA_MAX = { columns: 12, rows: 8, depth: 3, fields: 20 } as const

/** A column of a grid. `key` is only ever `primary`; `to` names the table a foreign key points to. */
export type DataColumn = { name: string; key?: 'primary'; to?: string; note?: string }
/** One note under the data: the column's name, or the field's dotted path in a document, and what it says. */
export type NoteLine = { name: string; text: string }
/** One line of a sample document. `path` is missing for a line under a list item, which a note cannot address. */
export type SampleLine = { depth: number; key: string; value: string; path?: string; noted: boolean }

/** One entry of a store's `data`, ready to draw. Renderers read this and decide nothing. */
export type DataShown = {
  name: string
  kind?: string
  limits?: string
  note?: string
  /** "5 columns", "1 column", "4 fields", "1 field". */
  summary: string
  /** A grid: its columns and rows (each row as wide as the columns). Both empty for a document. */
  columns: DataColumn[]
  rows: string[][]
  /** A document: its lines. Empty for a grid. */
  lines: SampleLine[]
  /** One per noted column or field, in drawn order. */
  notes: NoteLine[]
}

/** Non-blank text, or undefined: a blank value counts as left out. */
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function columnOf(raw: unknown): DataColumn | undefined {
  if (typeof raw === 'string') return raw.trim() === '' ? undefined : { name: raw }
  if (!isMap(raw)) return undefined
  const name = text(raw.name)
  if (name === undefined) return undefined
  const column: DataColumn = { name }
  if (raw.key === 'primary') column.key = 'primary'
  const to = text(raw.to)
  if (to !== undefined) column.to = to
  const note = text(raw.note)
  if (note !== undefined) column.note = note
  return column
}

function rowsOf(raw: unknown, width: number): string[][] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row): row is unknown[] => Array.isArray(row))
    .map(row => Array.from({ length: width }, (_, i) => (typeof row[i] === 'string' ? row[i] : '')))
}

const inline = (items: unknown[]) => `[${items.filter((i): i is string => typeof i === 'string').join(', ')}]`

/**
 * A sample document as lines. A text field is one line; a mapping is a line followed by its fields one level deeper; a list of text is one
 * line, `[a, b]`; any other list is a line followed by a `-` line for each item (and an item's fields two levels deeper). A line's `path` is
 * its keys joined with dots, and is missing under a list item. `noted` says `notes` has text for that path.
 */
function linesOf(sample: Record<string, unknown>, notes: Record<string, unknown>): SampleLine[] {
  const lines: SampleLine[] = []
  const noted = (path: string | undefined) => path !== undefined && Object.hasOwn(notes, path) && text(notes[path]) !== undefined
  const add = (depth: number, key: string, value: string, path?: string) =>
    lines.push({ depth, key, value, ...(path === undefined ? {} : { path }), noted: noted(path) })
  // `prefix` is the path of the mapping being walked, "" at the top, and null under a list item.
  const walk = (map: Record<string, unknown>, depth: number, prefix: string | null) => {
    for (const [key, value] of Object.entries(map)) {
      const path = prefix === null ? undefined : prefix === '' ? key : `${prefix}.${key}`
      if (isMap(value)) {
        add(depth, key, '', path)
        walk(value, depth + 1, path ?? null)
      } else if (Array.isArray(value)) {
        if (value.every(item => typeof item === 'string')) add(depth, key, inline(value), path)
        else {
          add(depth, key, '', path)
          for (const item of value) {
            if (typeof item === 'string') add(depth + 1, '-', item)
            else if (isMap(item)) {
              add(depth + 1, '-', '')
              walk(item, depth + 2, null)
            } else if (Array.isArray(item)) add(depth + 1, '-', inline(item))
          }
        }
      } else add(depth, key, typeof value === 'string' ? value : '', path)
    }
  }
  walk(sample, 1, '')
  return lines
}

/**
 * What a store's `data` shows, entry by entry. An entry that is not a mapping or has no name is left out, and so is one with neither
 * `columns` (a grid) nor `sample` (a document); check() reports those. Never throws.
 */
export function dataShown(o: FlowyObject): DataShown[] {
  if (!Array.isArray(o.data)) return []
  const shown: DataShown[] = []
  for (const entry of o.data) {
    if (!isMap(entry)) continue
    const name = text(entry.name)
    if (name === undefined) continue
    const head: Pick<DataShown, 'name' | 'kind' | 'limits' | 'note'> = { name }
    for (const field of ['kind', 'limits', 'note'] as const) {
      const value = text(entry[field])
      if (value !== undefined) head[field] = value
    }
    if (Array.isArray(entry.columns)) {
      const columns = entry.columns.map(columnOf).filter((c): c is DataColumn => c !== undefined)
      const notes = columns.filter(c => c.note !== undefined).map(c => ({ name: c.name, text: c.note! }))
      shown.push({ ...head, summary: plural(columns.length, 'column'), columns, rows: rowsOf(entry.rows, columns.length), lines: [], notes })
    } else if (isMap(entry.sample)) {
      const lines = linesOf(entry.sample, isMap(entry.notes) ? entry.notes : {})
      const notes = isMap(entry.notes)
        ? lines.filter(l => l.noted).map(l => ({ name: l.path!, text: (entry.notes as Record<string, string>)[l.path!] }))
        : []
      shown.push({ ...head, summary: plural(Object.keys(entry.sample).length, 'field'), columns: [], rows: [], lines, notes })
    }
  }
  return shown
}
