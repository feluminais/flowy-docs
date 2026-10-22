/**
 * A run file is read-only except for one field: its `compare` tag (see compare.ts), which the Compare control writes in place. This edits the
 * run's text and nothing else. Comments, key order, flow-style lines and every other byte stay, so removing a tag that was just added gives back
 * the text that was there before. Nothing here knows what the rest of a run means.
 *
 * The forms it writes are fixed, so the desktop app's twin (RunCompareTag.cs) writes the same bytes:
 * - no note: `compare: <id>`
 * - a note: `compare:` then `  with: <id>` and `  note: <text>` on lines of their own. A note on one line is double-quoted with JSON escapes
 *   (U+2028 and U+2029 written as \u2028 and \u2029 too). A note that holds a line break and can be held by a block scalar is written as
 *   `note: |-` with each line indented four spaces (an empty line stays empty), and any other note falls back to the quoted line.
 * - an id is written as it is when it is letters, digits, `.`, `_` or `-` (starting with a letter or digit), and double-quoted otherwise. (A run
 *   called `null` can't be named by a tag: the readers take the text `null` for no value, quoted or not.)
 * - a key that is not there goes at the end of the file, after the text's last line break (one is added when it has none). A key that is there is
 *   replaced where it stands, and the line breaks of the text (LF or CRLF) are the ones written.
 */
import { isMap, isPair, isScalar, parseDocument } from 'yaml'
import { ParseError } from '../model.ts'
import type { CompareTag } from '../compare.ts'

const FILE = 'run'
const PLAIN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
/** Characters a block scalar cannot carry as they are: control characters, the Unicode line breaks, the byte order mark and a carriage return. */
const NOT_IN_BLOCK = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\ufeff]/

/** A double-quoted single-line YAML text, written the way JSON writes it. */
const quoted = (text: string): string => JSON.stringify(text).replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')

const idText = (id: string): string => (PLAIN_ID.test(id) ? id : quoted(id))

/** Whether a note with a line break reads back the same as a `|-` block scalar: no leading blank or space, no trailing break, no line of only spaces. */
function fitsBlock(note: string): boolean {
  if (!note.includes('\n') || NOT_IN_BLOCK.test(note) || note.endsWith('\n') || /^[ \t\n]/.test(note)) return false
  return note.split('\n').every(line => line === '' || line.trim() !== '')
}

/** The lines of the tag (without the line break after the last), joined with `eol`. */
function render(tag: CompareTag, eol: string): string {
  if (tag.note === undefined) return `compare: ${idText(tag.with)}`
  const lines = ['compare:', `  with: ${idText(tag.with)}`]
  if (fitsBlock(tag.note)) lines.push('  note: |-', ...tag.note.split('\n').map(line => (line === '' ? '' : `    ${line}`)))
  else lines.push(`  note: ${quoted(tag.note)}`)
  return lines.join(eol)
}

/**
 * The text of a run file with its `compare` set to `tag`, or with the tag taken out when `tag` is undefined (a text without one comes back as it
 * was). Throws a ParseError when the text is not a mapping written in block style, so nothing is written over a file that cannot be read.
 */
export function setRunCompare(text: string, tag: CompareTag | undefined): string {
  const doc = parseDocument(text, { schema: 'failsafe' })
  const [error] = doc.errors
  if (error) throw new ParseError(FILE, error.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''), error.linePos?.[0].line)
  const map = doc.contents
  if (!isMap(map)) throw new ParseError(FILE, 'expected a mapping with "name", "unit" and "levels"')
  if (map.flow) throw new ParseError(FILE, 'expected the keys one to a line, not in braces')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'

  const pair = map.items.find(item => isPair(item) && isScalar(item.key) && item.key.value === 'compare')
  if (pair === undefined) {
    if (tag === undefined) return text
    return `${text}${text === '' || text.endsWith('\n') ? '' : eol}${render(tag, eol)}${eol}`
  }
  const start = (pair.key as { range: [number, number, number] }).range[0]
  const valueEnd = (pair.value as { range?: [number, number, number] } | null)?.range?.[1] ?? start + 'compare:'.length
  // The tag ends where its last line does. A value that ends on a line break (a block scalar) already ends there.
  let lineEnd: number
  let contentEnd: number
  if (valueEnd > 0 && text[valueEnd - 1] === '\n') {
    lineEnd = valueEnd
    contentEnd = valueEnd - (text[valueEnd - 2] === '\r' ? 2 : 1)
  } else {
    const at = text.indexOf('\n', valueEnd)
    lineEnd = at === -1 ? text.length : at + 1
    contentEnd = at === -1 ? text.length : at - (text[at - 1] === '\r' ? 1 : 0)
  }
  if (tag === undefined) return text.slice(0, start) + text.slice(lineEnd)
  return text.slice(0, start) + render(tag, eol) + text.slice(contentEnd)
}
