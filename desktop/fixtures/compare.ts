import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffFlows } from '../../src/core/flowdiff.ts'
import type { SideMarks } from '../../src/core/flowdiff.ts'
import { setRunCompare } from '../../src/core/perf/comparetag.ts'
import type { CompareTag } from '../../src/core/compare.ts'
import { modelOf } from '../../src/core/state.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

const FLOWDIFF = 'desktop/fixtures/cases/flowdiff/flowy'

/** The pairs of flows (older, newer) of the flowdiff case that are diffed. Each name is a file in its flows folder. */
const PAIRS: [string, string][] = [
  ['base', 'same'], ['base', 'base'], ['base', 'appended'], ['base', 'inserted'], ['base', 'removed'], ['base', 'retexted'], ['appended', 'base'],
  ['anim-pulse', 'anim-flash'], ['anim-pulse', 'anim-kind-pulse'], ['anim-order-1', 'anim-order-2'], ['desc-1', 'desc-2'],
  ['cross-old', 'cross-new'], ['base', 'apart'], ['alone-old', 'alone-new'], ['proto-old', 'proto-new'], ['dup-old', 'dup-new'],
]

/** Keys sorted by UTF-16 code unit (what an ordinal sort gives in C#), so the dump does not depend on insertion order. */
const sorted = (record: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const key of Object.keys(record).sort()) Object.defineProperty(out, key, { value: record[key], enumerable: true, writable: true, configurable: true })
  return out
}
const marksDump = (m: SideMarks) => ({
  steps: Object.fromEntries(Object.entries(m.steps).sort(([a], [b]) => Number(a) - Number(b))),
  shapes: sorted(m.shapes),
  lines: sorted(m.lines),
})

/** What the diff of every pair of flows says: the C# FlowDiffs.Diff must give the same. */
export async function dumpFlowDiffs(): Promise<unknown> {
  const state = await loadState(join(root, FLOWDIFF))
  if ('parseError' in state) throw new Error(`${FLOWDIFF} can't be read`)
  const model = modelOf(state)
  return {
    folder: FLOWDIFF,
    pairs: PAIRS.map(([older, newer]) => {
      const diff = diffFlows(model.flows[older], model.flows[newer])
      return { older, newer, related: diff.related, olderMarks: marksDump(diff.older), newerMarks: marksDump(diff.newer) }
    }),
  }
}

const RUN = 'name: r\nunit: req/s\nlevels:\n  - { load: 1 }\n  - { load: 2 }\n'
const WITH_TAG = (value: string) => `name: r\ncompare: ${value}\nunit: req/s\nlevels:\n  - { load: 1 }\n  - { load: 2 }\n`
const BLOCK_TAG = 'name: r\ncompare:\n  with: old\n  note: |-\n    one\n    two\n\n\n# keep this comment\nunit: req/s\nlevels:\n  - { load: 1 }\n'

const NOTE = (with_: string, note?: string): CompareTag => (note === undefined ? { with: with_ } : { with: with_, note })

/** Cases of text and tag for setRunCompare. A tag of null takes the tag out. */
const CASES: { name: string; text: string; tag: CompareTag | null }[] = [
  { name: 'add short', text: RUN, tag: NOTE('before') },
  { name: 'add short, no trailing newline', text: RUN.slice(0, -1), tag: NOTE('before') },
  { name: 'add short to an empty mapping value file', text: 'name: r\n', tag: NOTE('before') },
  { name: 'add with a plain note', text: RUN, tag: NOTE('before', 'Faster now') },
  { name: 'add with quotes, backslash and unicode', text: RUN, tag: NOTE('before', 'He said "hi" \\ ✓   end') },
  { name: 'add with a note that holds a break', text: RUN, tag: NOTE('before', 'line one\nline two') },
  { name: 'add with an empty line inside the note', text: RUN, tag: NOTE('before', 'a\n\nb') },
  { name: 'add with a break and a leading space', text: RUN, tag: NOTE('before', ' lead\nx') },
  { name: 'add with a trailing break', text: RUN, tag: NOTE('before', 'x\ny\n') },
  { name: 'add with a tab and a break', text: RUN, tag: NOTE('before', 'a\tb\nc') },
  { name: 'add with a line of spaces', text: RUN, tag: NOTE('before', 'a\n  \nb') },
  { name: 'id that reads as null', text: RUN, tag: NOTE('null') },
  { name: 'id with a dot', text: RUN, tag: NOTE('v1.2-b') },
  { name: 'id with a space', text: RUN, tag: NOTE('a b') },
  { name: 'replace short with short', text: WITH_TAG('old'), tag: NOTE('new') },
  { name: 'replace short with long', text: WITH_TAG('old'), tag: NOTE('new', 'why') },
  { name: 'replace long with short', text: BLOCK_TAG, tag: NOTE('new') },
  { name: 'replace long with long', text: BLOCK_TAG, tag: NOTE('new', 'one\ntwo') },
  { name: 'replace a quoted value', text: WITH_TAG('"old id"'), tag: NOTE('new') },
  { name: 'replace a flow-style value', text: WITH_TAG('{ with: old, note: why }'), tag: NOTE('new') },
  { name: 'replace keeps a trailing comment out', text: WITH_TAG('old # why'), tag: NOTE('new') },
  { name: 'remove short', text: WITH_TAG('old'), tag: null },
  { name: 'remove long with a block note and blank lines', text: BLOCK_TAG, tag: null },
  { name: 'remove when absent', text: RUN, tag: null },
  { name: 'comments and flow style elsewhere', text: '# a run\nname: r  # its name\nunit: req/s\nlevels: [ { load: 1 }, { load: 2 } ]\n', tag: NOTE('before', 'x') },
  { name: 'compare in the middle, replaced', text: '# top\nname: r\ncompare: old\n# between\nunit: req/s\nlevels:\n  - { load: 1 }\n', tag: NOTE('new') },
  { name: 'nested compare is not the tag', text: 'name: r\nsource:\n  compare: inner\nlevels:\n  - { load: 1 }\n', tag: NOTE('outer') },
  { name: 'nested compare stays when removing', text: 'name: r\nsource:\n  compare: inner\nlevels:\n  - { load: 1 }\n', tag: null },
  { name: 'crlf add', text: RUN.replaceAll('\n', '\r\n'), tag: NOTE('before', 'a\nb') },
  { name: 'crlf replace', text: WITH_TAG('old').replaceAll('\n', '\r\n'), tag: NOTE('new', 'why') },
  { name: 'crlf remove', text: WITH_TAG('old').replaceAll('\n', '\r\n'), tag: null },
  { name: 'last key replaced, no trailing newline', text: 'name: r\ncompare: old', tag: NOTE('new') },
  { name: 'last key removed, no trailing newline', text: 'name: r\ncompare: old', tag: null },
  { name: 'not a mapping', text: '- a\n- b\n', tag: NOTE('x') },
  { name: 'duplicate keys', text: 'name: r\ncompare: a\ncompare: b\n', tag: NOTE('x') },
  { name: 'top level in braces', text: '{ name: r }\n', tag: NOTE('x') },
  { name: 'empty text', text: '', tag: NOTE('x') },
]

/** The text setRunCompare gives for each case: the C# RunCompareText.Set must write the same bytes. An error is only said to be one. */
export function dumpRunCompareText(): unknown {
  return CASES.map(({ name, text, tag }) => {
    try {
      return { name, text, tag, result: setRunCompare(text, tag ?? undefined) }
    } catch {
      return { name, text, tag, error: true }
    }
  })
}
