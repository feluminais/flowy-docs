import { Document, isAlias, isMap as isYamlMap, isNode, isScalar, isSeq, LineCounter, parseDocument, visit, YAMLParseError } from 'yaml'
import type { Scalar, YAMLMap, YAMLSeq } from 'yaml'
import { ParseError } from './model.ts'

/**
 * Parse with YAML's failsafe schema: every value stays the text that was typed, so an id like
 * `007` or a version like `3.10` survives a save instead of turning into a number.
 */
export function readYaml(file: string, text: string): unknown {
  // Line starts are found by \n only: JS's ^ and $ with the m flag also break at U+2028/U+2029,
  // which YAML keeps inside plain values, so a saved value could look like a conflict marker.
  const conflict = /(?<![^\n])(?:(?:<{7}|>{7})(?= |\r?\n|\r?$)|={7}(?=\r?\n|\r?$))/.exec(text)
  if (conflict) throw new ParseError(file, 'unresolved merge conflict', text.slice(0, conflict.index).split('\n').length)
  try {
    const lines = new LineCounter()
    const doc = parseDocument(text, { schema: 'failsafe', lineCounter: lines })
    if (doc.errors.length > 0) throw doc.errors[0]
    // The desktop app's reader refuses them (a few nested aliases can expand into billions of values), so this one does too.
    let shared: number | undefined
    visit(doc, (_, node) => {
      if (!isAlias(node) && !(isNode(node) && node.anchor)) return undefined
      shared = (node as { range?: [number, number, number] }).range?.[0] ?? 0
      return visit.BREAK
    })
    if (shared !== undefined) throw new ParseError(file, 'anchors and aliases are not supported', lines.linePos(shared).line)
    return doc.toJS()
  } catch (e) {
    if (e instanceof ParseError) throw e
    // Any other failure (bad syntax, duplicate keys) means the file can't be trusted.
    const line = e instanceof YAMLParseError ? e.linePos?.[0].line : undefined
    const message = (e instanceof Error ? e.message : String(e)).split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')
    throw new ParseError(file, message, line)
  }
}

// Written with the failsafe schema too, so a save gives back hand-written values exactly as typed
// (`legacy: true` stays unquoted). Model and flow values are always strings: they come from parsed
// text or from string-only MCP fields; a stray number throws instead of being silently retyped.
// Without aliasDuplicateObjects: false, an object used twice would be written as a YAML &anchor/*alias.
export function dump(value: unknown): string {
  const doc = new Document(value, { schema: 'failsafe', aliasDuplicateObjects: false })
  quoteBlankFirstLines(doc)
  return doc.toString({ lineWidth: 0 })
}

const BLANK_LEADING_LINE = /^\n*[ \t]+\n/

/**
 * Text with a line of only spaces or tabs among its leading lines is quoted. Written as a block (`|`), it comes back with that
 * line's spaces gone, or, with a tab among the lines after it, cannot be read at all ("more-indented leading empty lines must use an
 * explicit indentation indicator"). Found by trying every short string of spaces, tabs, line breaks and letters.
 */
export function quoteBlankFirstLines(doc: Document) {
  visit(doc, {
    Scalar(_, node) {
      if (typeof node.value === 'string' && BLANK_LEADING_LINE.test(node.value)) node.type = 'QUOTE_DOUBLE'
    },
  })
}

/**
 * Text that must be quoted in a flow collection: an empty string (`[a, , b]` does not parse) and anything with a line break, which
 * would otherwise be folded over several lines and can read back as something else (`Error:` then a line break is a mapping).
 */
const needsQuotes = (node: unknown) => isScalar(node) && typeof node.value === 'string' && (node.value === '' || /[\r\n\u2028\u2029]/.test(node.value))

export function flowSeq(seq: YAMLSeq) {
  seq.flow = true
  for (const item of seq.items) if (needsQuotes(item)) (item as Scalar).type = 'QUOTE_DOUBLE'
}

export function flowMap(map: YAMLMap) {
  map.flow = true
  for (const pair of map.items) if (needsQuotes(pair.value)) (pair.value as Scalar).type = 'QUOTE_DOUBLE'
}

/** In a sample document, a list of only text is written on one line. */
export function flowTextLists(node: unknown) {
  if (isSeq(node)) {
    if (node.items.every(item => isScalar(item))) flowSeq(node)
    else for (const item of node.items) flowTextLists(item)
  } else if (isYamlMap(node)) for (const pair of node.items) flowTextLists(pair.value)
}
