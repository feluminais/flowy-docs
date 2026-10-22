import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffFlows } from '../../src/core/flowdiff.ts'
import type { Change, FlowDiff, SideMarks } from '../../src/core/flowdiff.ts'
import { setRunCompare } from '../../src/core/perf/comparetag.ts'
import type { CompareTag } from '../../src/core/compare.ts'
import { modelOf } from '../../src/core/state.ts'
import { loadState } from '../../src/node/files.ts'
import {
  CHANGE_NAMES, changeOfStop, choicesFor, firstLinkedRun, fromAddress, keyItems, linkedRuns, noteOf, noteOff, openable, orderPair, pairKey, pairOff, removeNeedsConfirm, runCompareOff, runPairOf, saveTarget, unsaved,
} from '../../ui/src/compare.ts'
import type { Choice } from '../../ui/src/compare.ts'
import { crossfadeDuration, FADE_MS, planSwap, SWAP_MS, swapDuration } from '../../ui/src/swap.ts'
import type { GraphNode } from '../../ui/src/swap.ts'

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

const COMPARE = 'desktop/fixtures/cases/compare/flowy'

/** Every flow's and every run's choices of the compare case, and the order every pair of them reads in: the C# CompareChoices must give the same. */
export async function dumpCompareChoices(): Promise<unknown> {
  const state = await loadState(join(root, COMPARE))
  if ('parseError' in state) throw new Error(`${COMPARE} can't be read`)
  const model = modelOf(state)
  const runs = state.runs ?? {}
  const choice = (c: Choice) => ({ id: c.id, name: c.name, side: c.side ?? null, missing: c.missing === true })
  const choices = (kind: 'flow' | 'run', ids: string[]) =>
    ids.map(id => {
      const { linked, others } = choicesFor(model, runs, kind, id)
      return { id, linked: linked.map(choice), others: others.map(choice) }
    })
  const orders = (kind: 'flow' | 'run', items: Record<string, { name?: string; compare?: unknown }>) => {
    const ids = Object.keys(items)
    return ids.flatMap(a => ids.map(b => ({ a, b, order: orderPair(kind, items, a, b) })))
  }
  const runIds = Object.keys(runs)
  const flowIds = Object.keys(model.flows)
  // A run that is not there, to ask about as well.
  const asked = [...runIds, 'nope']
  const none = (id: string | undefined) => id ?? null
  return {
    folder: COMPARE,
    flows: choices('flow', flowIds),
    runs: choices('run', runIds),
    flowOrders: orders('flow', model.flows),
    runOrders: orders('run', runs),
    // The rules the Performance panel and the launch option ask about runs: whether Compare is blocked, the run C opens, which runs show Linked, the pair that opens and what an address says.
    runRules: {
      off: [0, 1, 2].flatMap(count => [false, true].map(editing => ({ count, editing, result: runCompareOff(Object.fromEntries(runIds.slice(0, count).map(id => [id, runs[id]])), editing) ?? null }))),
      firstLinked: runIds.map(id => ({ id, result: none(firstLinkedRun(model, runs, id)) })),
      linked: [...linkedRuns(runs)].sort(),
      pairs: runIds.flatMap(id => runIds.map(other => { const c = runPairOf(runs, id, other); return { id, other, a: c.a, b: c.b } })),
      openable: asked.map(id => ({ id, result: openable(runs, id) })),
      addresses: [
        ...asked.flatMap(a => asked.map(b => ({ kind: 'run', a, b, notice: none(fromAddress(model, runs, { kind: 'run', a, b, mode: 'side' }).notice) }))),
        ...[...flowIds, 'nope'].flatMap(a => [...flowIds, 'nope'].map(b => ({ kind: 'flow', a, b, notice: none(fromAddress(model, runs, { kind: 'flow', a, b, mode: 'side' }).notice) }))),
      ],
    },
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

type Tags = Record<string, unknown>
const itemsOf = (tags: Tags): Record<string, { name?: string; compare?: unknown }> => Object.fromEntries(Object.entries(tags).map(([id, compare]) => [id, compare === null ? { name: id } : { name: id, compare }]))

/** Sets of flows (each id with its raw `compare`, null for none): every ordered pair of each is asked for its note and its save target. */
const TAG_SETS: { name: string; tags: Tags }[] = [
  { name: 'tagged with a note', tags: { old: null, now: { with: 'old', note: 'After the fix' }, other: null } },
  { name: 'tagged without a note', tags: { old: null, now: 'old', other: null } },
  { name: 'the older holds the tag', tags: { a: 'b', b: null } },
  { name: 'both link elsewhere', tags: { x: null, y: 'z', z: null, w: 'v', v: null } },
  { name: 'a mutual pair with notes', tags: { a: { with: 'b', note: 'from a' }, b: { with: 'a', note: 'from b' } } },
  { name: 'a mutual pair, one note', tags: { a: 'b', b: { with: 'a', note: 'from b' } } },
  { name: 'a mutual pair, no notes', tags: { a: 'b', b: 'a' } },
  { name: 'tags to flows that are not there', tags: { a: 'gone2', b: 'gone', c: null } },
  { name: 'a tag to another flow', tags: { old: null, now: 'gone', other: null } },
  { name: 'a blank note', tags: { old: null, now: { with: 'old', note: '   ' } } },
]

const NOTES = ['', 'N', '  Padded  ', '  \n']

/** Every pair of each tag set, asked for its note, its key and its save target (for each note). The C# CompareUi must say the same. */
function dumpTagCases() {
  return TAG_SETS.map(({ name, tags }) => {
    const items = itemsOf(tags)
    const ids = Object.keys(tags)
    return {
      name,
      tags,
      pairs: ids.flatMap(a => ids.map(b => ({
        a,
        b,
        note: noteOf(items, a, b),
        key: pairKey(a, b),
        targets: NOTES.map(text => ({ text, ...saveTarget('flow', items, a, b, text) })),
      }))),
    }
  })
}

const diffDump = (d: FlowDiff) => ({ related: d.related, older: marksDump(d.older), newer: marksDump(d.newer) })
const SIDE_CHOICES: ('older' | 'newer')[][] = [['older', 'newer'], ['newer'], ['older'], []]

/** Hand-made diffs, for the cases a pair of real flows doesn't reach. */
const KEY_DIFFS: { name: string; diff: FlowDiff }[] = [
  { name: 'new step and changed shape', diff: { related: true, older: { steps: {}, shapes: {}, lines: {} }, newer: { steps: { 2: 'new' }, shapes: { fee: 'changed' }, lines: {} } } },
  { name: 'every kind, found in a different order', diff: { related: true, older: { steps: {}, shapes: {}, lines: { 'a b': 'removed' } }, newer: { steps: { 0: 'new' }, shapes: { b: 'changed' }, lines: {} } } },
  { name: 'a kind on the older side alone', diff: { related: true, older: { steps: { 1: 'removed' }, shapes: {}, lines: {} }, newer: { steps: {}, shapes: {}, lines: {} } } },
  { name: 'both sides', diff: { related: true, older: { steps: {}, shapes: { gone: 'removed' }, lines: {} }, newer: { steps: { 0: 'new' }, shapes: {}, lines: {} } } },
  { name: 'nothing differs', diff: { related: true, older: { steps: {}, shapes: {}, lines: {} }, newer: { steps: {}, shapes: {}, lines: {} } } },
  { name: 'nothing in common', diff: { related: false, older: { steps: {}, shapes: {}, lines: {} }, newer: { steps: {}, shapes: {}, lines: {} } } },
]

const STOP_CASES: { name: string; steps: number[]; changes: Record<number, Change> }[] = [
  { name: 'one marked step', steps: [2], changes: { 0: 'new', 2: 'removed', 3: 'changed' } },
  { name: 'mixed kinds read as changed', steps: [0, 2], changes: { 0: 'new', 2: 'removed', 3: 'changed' } },
  { name: 'the same changed twice', steps: [3, 3], changes: { 0: 'new', 2: 'removed', 3: 'changed' } },
  { name: 'an unmarked step beside a marked one', steps: [0, 1], changes: { 0: 'new', 2: 'removed', 3: 'changed' } },
  { name: 'no marks', steps: [1], changes: { 0: 'new', 2: 'removed', 3: 'changed' } },
  { name: 'no steps', steps: [], changes: { 0: 'new' } },
  { name: 'no changes', steps: [1], changes: {} },
  { name: 'file step numbers, not stops', steps: [0], changes: { 1: 'new' } },
]

const UNSAVED: [string | null, string][] = [[null, 'x'], ['', ''], ['  \n', ''], ['x', ''], ['x', 'x'], ['', 'x'], ['x', 'x\n'], ['x\n', 'x\n'], ['y', 'x\n']]
const TAGS_FOR_REMOVE: (CompareTag | null)[] = [{ with: 'a', note: 'why' }, { with: 'a' }, null]

/** What the comparison's key, stop marks, note and save target say, for the C# CompareUi to say the same. */
export async function dumpCompareUi(): Promise<unknown> {
  const state = await loadState(join(root, FLOWDIFF))
  if ('parseError' in state) throw new Error(`${FLOWDIFF} can't be read`)
  const model = modelOf(state)
  const real = PAIRS.map(([older, newer]) => ({ name: `${older} to ${newer}`, diff: diffFlows(model.flows[older], model.flows[newer]) }))
  return {
    names: CHANGE_NAMES,
    keys: [...KEY_DIFFS, ...real].map(({ name, diff }) => ({
      name,
      diff: diffDump(diff),
      results: SIDE_CHOICES.map(sides => ({ sides, ...keyItems(diff, sides) })),
    })),
    stops: STOP_CASES.map(c => ({ ...c, result: changeOfStop(c.steps, c.changes) ?? null })),
    tagCases: dumpTagCases(),
    unsaved: UNSAVED.map(([draft, saved]) => ({ draft, saved, result: unsaved(draft ?? undefined, saved) })),
    noteOff: [[true, false], [false, false], [true, true], [false, true]].map(([live, readOnly]) => ({ live, readOnly, result: noteOff(live, readOnly) ?? null })),
    pairOff: [['flow', 'old', 'old'], ['flow', 'old', 'other'], ['run', 'r1', 'r1']].map(([kind, a, b]) => ({ kind, a, b, result: pairOff(kind as 'flow' | 'run', a, b) ?? null })),
    removeNeedsConfirm: TAGS_FOR_REMOVE.map(tag => ({ tag, result: removeNeedsConfirm(tag ?? undefined) })),
  }
}

const N = (id: string, x = 0, y = 0): GraphNode => ({ id, position: { x, y } })
const MANY = (count: number, shift: number): GraphNode[] => Array.from({ length: count }, (_, i) => N(`n${i * 2 + shift}`, (i * 37) % 900, (i * 53) % 700))

/** Cases for planSwap: what two diagrams' shapes do when the canvas swaps from one to the other. */
const SWAP_CASES: { name: string; from: GraphNode[]; to: GraphNode[] }[] = [
  { name: 'a,b to b,c', from: [N('a', 0, 0), N('b', 10, 20)], to: [N('b', 30, 40), N('c', 50, 60)] },
  { name: 'identical', from: [N('a', 1, 2), N('b', 3, 4)], to: [N('a', 1, 2), N('b', 3, 4)] },
  { name: 'empty from', from: [], to: [N('a', 1, 2), N('b', 3, 4)] },
  { name: 'empty to', from: [N('a', 1, 2), N('b', 3, 4)], to: [] },
  { name: 'both empty', from: [], to: [] },
  { name: 'reordered', from: [N('a', 0, 0), N('b', 1, 1), N('c', 2, 2)], to: [N('c', 5, 5), N('a', 6, 6), N('b', 7, 7)] },
  { name: 'duplicate ids in from', from: [N('a', 0, 0), N('a', 9, 9), N('b', 1, 1)], to: [N('a', 5, 5)] },
  { name: 'duplicate ids in to', from: [N('a', 0, 0)], to: [N('a', 1, 1), N('a', 2, 2), N('z', 3, 3), N('z', 4, 4)] },
  { name: 'duplicate leaving ids', from: [N('a', 0, 0), N('a', 1, 1), N('b', 2, 2)], to: [N('c', 3, 3)] },
  { name: '__proto__ stays', from: [N('__proto__', 1, 2), N('toString', 3, 4)], to: [N('__proto__', 5, 6), N('constructor', 7, 8)] },
  { name: '__proto__ enters and leaves', from: [N('__proto__', 1, 2)], to: [N('hasOwnProperty', 3, 4)] },
  { name: 'changed positions', from: [N('a', 0, 0), N('b', 100, 0)], to: [N('a', -50.5, 12.25), N('b', 100, 0)] },
  { name: 'fractions and negatives', from: [N('a', -1.5, -2.5)], to: [N('a', 0.0000001, 123456.789)] },
  { name: 'many nodes', from: MANY(400, 0), to: MANY(400, 1) },
]

/** What planSwap says for each case, with the swap's constants and durations: the C# SwapPlans must give the same. */
export function dumpSwapPlans(): unknown {
  const xy = (p: { x: number; y: number }) => ({ x: p.x, y: p.y })
  return {
    swapMs: SWAP_MS,
    fadeMs: FADE_MS,
    durations: { swap: swapDuration(false), swapReduced: swapDuration(true), crossfade: crossfadeDuration(false), crossfadeReduced: crossfadeDuration(true) },
    cases: SWAP_CASES.map(({ name, from, to }) => {
      const plan = planSwap(from, to)
      return {
        name,
        from: from.map(n => ({ id: n.id, ...xy(n.position) })),
        to: to.map(n => ({ id: n.id, ...xy(n.position) })),
        stay: plan.stay.map(s => ({ id: s.id, from: xy(s.from), to: xy(s.to) })),
        entering: plan.entering,
        leaving: plan.leaving,
      }
    }),
  }
}
