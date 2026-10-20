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
 * A store's data as `put_object` and the edit forms give it. Numbers and booleans are accepted anywhere a value goes and written as text.
 * A `sample` is any nesting of text, lists and mappings.
 */
export type DataInput = {
  name: string
  kind?: string
  limits?: string
  note?: string
  columns?: (string | { name: string; key?: 'primary'; to?: string; note?: string })[]
  rows?: (string | number | boolean)[][]
  sample?: Record<string, unknown>
  notes?: Record<string, string>
}

const blank = (v: unknown) => typeof v === 'string' && v.trim() === ''

/** Numbers and booleans become text and null becomes "", at any depth; everything else is kept. */
function asText(v: unknown): unknown {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(asText)
  if (isMap(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, asText(x)]))
  return v
}

const mapList = (v: unknown, f: (x: unknown) => unknown) => (Array.isArray(v) ? v.map(f) : v)

function tidyColumn(c: unknown): unknown {
  if (!isMap(c)) return c
  const { name, key, to, note, ...rest } = c
  const tidy: Record<string, unknown> = { name }
  for (const [field, value] of [['key', key], ['to', to], ['note', note]] as const) if (value !== undefined && !blank(value)) tidy[field] = value
  // Spread, not Object.assign: a hand-written `__proto__` key must stay a key and not set the prototype.
  const column = { ...tidy, ...rest }
  return Object.keys(column).length === 1 && typeof name === 'string' ? name : column
}

function tidyEntry(e: unknown): unknown {
  if (!isMap(e)) return e
  const { name, kind, limits, note, columns, rows, sample, notes, ...rest } = e
  const tidy: Record<string, unknown> = { name }
  for (const [field, value] of [['kind', kind], ['limits', limits], ['note', note]] as const) if (value !== undefined && !blank(value)) tidy[field] = value
  if (columns !== undefined) tidy.columns = mapList(columns, tidyColumn)
  if (rows !== undefined) tidy.rows = mapList(rows, row => mapList(row, asText))
  if (sample !== undefined) tidy.sample = asText(sample)
  if (notes !== undefined && !(isMap(notes) && Object.keys(notes).length === 0)) tidy.notes = notes
  return { ...tidy, ...rest }
}

/**
 * The entries of a `data` as they go to disk: keys in the order name, kind, limits, note, columns, rows, sample, notes (others after); a
 * blank kind, limits, note, key or `to` left out; a column with only a name written as the bare name; numbers and booleans as text.
 * A value of the wrong shape, a `data` that is not a list included, is carried through unchanged for check() to report.
 */
export function tidyData(input: DataInput[]): unknown[]
export function tidyData(input: unknown): unknown
export function tidyData(input: unknown): unknown {
  return Array.isArray(input) ? input.map(tidyEntry) : input
}

const present = (v: unknown) => v !== undefined && v !== ''

function gridProblems(label: string, entry: Record<string, unknown>, out: string[]) {
  const columns = entry.columns
  if (!Array.isArray(columns)) return out.push(`${label}: columns must be a list`)
  if (columns.length === 0) out.push(`${label}: columns is empty`)
  const seen = new Set<string>()
  columns.forEach((c, i) => {
    const name = typeof c === 'string' ? text(c) : isMap(c) ? text(c.name) : undefined
    if (typeof c !== 'string' && !isMap(c)) return out.push(`${label}: column ${i + 1} must be a name or a mapping`)
    if (name === undefined) return out.push(`${label}: column ${i + 1} has no name`)
    if (seen.has(name)) out.push(`${label}: column "${name}" appears twice`)
    seen.add(name)
    if (!isMap(c)) return
    if (present(c.key) && c.key !== 'primary') out.push(`${label}: column "${name}": key must be primary`)
    for (const field of ['to', 'note']) if (c[field] !== undefined && typeof c[field] !== 'string') out.push(`${label}: column "${name}": "${field}" must be plain text`)
  })
  if (columns.length > DATA_MAX.columns) out.push(`${label}: ${columns.length} columns, at most ${DATA_MAX.columns}`)
  const rows = entry.rows
  if (!present(rows)) return
  if (!Array.isArray(rows)) return out.push(`${label}: rows must be a list of rows`)
  rows.forEach((row, i) => {
    if (!Array.isArray(row) || row.some(cell => typeof cell !== 'string')) out.push(`${label}: row ${i + 1} must be a list of cells`)
    else if (row.length !== columns.length)
      out.push(`${label}: row ${i + 1} has ${plural(row.length, 'cell')} but there ${columns.length === 1 ? 'is' : 'are'} ${plural(columns.length, 'column')}`)
  })
  if (rows.length > DATA_MAX.rows) out.push(`${label}: ${rows.length} rows, at most ${DATA_MAX.rows}`)
}

/** Whether a list sits directly inside a list anywhere in the sample, which the picture cannot draw. */
function hasNestedList(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(item => Array.isArray(item) || hasNestedList(item))
  return isMap(node) && Object.values(node).some(hasNestedList)
}

function sampleProblems(label: string, entry: Record<string, unknown>, out: string[]) {
  const sample = entry.sample
  if (!isMap(sample)) return out.push(`${label}: sample must be a mapping of fields`)
  if (Object.keys(sample).length === 0) return out.push(`${label}: sample is empty`)
  if (hasNestedList(sample)) out.push(`${label}: sample has a list inside a list, which isn't shown`)
  const lines = linesOf(sample, {})
  const depth = Math.max(...lines.map(l => l.depth))
  if (depth > DATA_MAX.depth) out.push(`${label}: sample is nested ${depth} levels deep, at most ${DATA_MAX.depth}`)
  if (lines.length > DATA_MAX.fields) out.push(`${label}: sample shows ${lines.length} fields, at most ${DATA_MAX.fields}`)
  const notes = entry.notes
  if (!present(notes)) return
  if (!isMap(notes) || Object.values(notes).some(v => typeof v !== 'string')) return out.push(`${label}: notes must map a field to its note`)
  const paths = new Set(lines.map(l => l.path))
  for (const key of Object.keys(notes)) if (!paths.has(key)) out.push(`${label}: the note on "${key}" names no field of the sample`)
}

/**
 * What is wrong with a store's `data`, as messages without the object's id (check() adds it). A blank `data`, `kind`, `limits`, `note`,
 * `columns`, `rows`, `sample` or `notes` counts as left out. Never throws, whatever shape the value has.
 */
export function dataProblems(o: FlowyObject): string[] {
  if (!present(o.data)) return []
  if (o.type !== 'store') return ['only a store can have data']
  if (!Array.isArray(o.data)) return ['data must be a list of entries']
  const out: string[] = []
  const names = new Set<string>()
  o.data.forEach((entry, i) => {
    if (!isMap(entry)) return out.push(`data entry ${i + 1} must be a mapping`)
    const name = text(entry.name)
    if (name === undefined) out.push(`data entry ${i + 1} has no name`)
    else if (names.has(name)) out.push(`data "${name}" appears twice`)
    if (name !== undefined) names.add(name)
    const label = name === undefined ? `data entry ${i + 1}` : `data "${name}"`
    for (const field of ['kind', 'limits', 'note']) if (entry[field] !== undefined && typeof entry[field] !== 'string') out.push(`${label}: "${field}" must be plain text`)
    const [grid, document] = [present(entry.columns), present(entry.sample)]
    if (!grid && !document) out.push(`${label} needs columns or a sample`)
    else if (grid && document) out.push(`${label} has both columns and a sample`)
    if (!grid && present(entry.rows)) out.push(`${label}: rows need columns`)
    if (!document && present(entry.notes)) out.push(`${label}: notes need a sample`)
    if (grid) gridProblems(label, entry, out)
    if (document) sampleProblems(label, entry, out)
  })
  return out
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
