import { isMap as isYamlMap, isScalar, isSeq, parse, stringify, YAMLParseError } from 'yaml'
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
    return parse(text, { schema: 'failsafe' })
  } catch (e) {
    // Any failure (bad syntax, duplicate keys, alias bombs) means the file can't be trusted.
    const line = e instanceof YAMLParseError ? e.linePos?.[0].line : undefined
    const message = (e instanceof Error ? e.message : String(e)).split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')
    throw new ParseError(file, message, line)
  }
}

// Written with the failsafe schema too, so a save gives back hand-written values exactly as typed
// (`legacy: true` stays unquoted). Model and flow values are always strings: they come from parsed
// text or from string-only MCP fields; a stray number throws instead of being silently retyped.
// Without aliasDuplicateObjects: false, an object used twice would be written as a YAML &anchor/*alias.
export const dump = (value: unknown) => stringify(value, { schema: 'failsafe', lineWidth: 0, aliasDuplicateObjects: false })

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
