import { check } from '../../src/core/check.ts'
import { describeEdit } from '../../src/core/editlabel.ts'
import { headScale } from '../../src/core/heads.ts'
import {
  DASHES, isKindId, isPlainLook, KIND_IDS, KIND_LIST, kindName, kindOf, KINDS, lookOf, lookOfKind, MARKS, markPath, markStroke, mergedLook, PLAIN_LOOK, PLAIN_NAME,
  sameLook, sharedKind,
} from '../../src/core/kinds.ts'
import type { LineLook } from '../../src/core/kinds.ts'
import { viewToMermaid } from '../../src/core/mermaid.ts'
import type { Connection, Model } from '../../src/core/model.ts'
import { modelFiles } from '../../src/core/modelfiles.ts'
import { computeView } from '../../src/core/views.ts'
import { shop } from '../../test/fixtures.ts'

// The kinds of a connection: the six words and their names, the marks and how they scale, the look of a line that stands for several connections, what
// check says of a word that is no kind, how a view line carries a kind, what the history says and what Mermaid keeps. The C# tests read the file
// `dumpKinds` writes (expected/kinds.json) and compare their own with it. A case that needs a model carries its files (`files`), which the C# side reads
// the way it reads a folder. The `labels` are the one part with no C# reader: the desktop has no edit history, so there is no label to compare.

/** Values `isKindId` and `kindOf` are asked about: the six words, and what a file could hold instead. */
const WORDS: unknown[] = [...KIND_IDS, 'rpc', 'Request', ' request', 'request ', '', 'toString', '__proto__', 3, null, ['request']]

/** The scales the marks are drawn at: a quiet line, a lit one, the lane cap, a line thickened by traffic (headScale of 6), and an odd one. */
const SCALES = [1, 1.2, headScale(6), 1.333]

/** The looks that `mergedLook` is asked to merge, by the kind words, plain for none, and two looks only a project table could make. */
const ODD: Record<string, LineLook> = {
  'dashed ring': { pattern: 'dashdot', head: 'open', tail: 'ring' },
  'dashed filled': { pattern: 'dashdot', head: 'filled', tail: 'none' },
  'dashed double': { pattern: 'dashdot', head: 'open', tail: 'double' },
}
const named = (name: string): LineLook => (name === 'plain' ? PLAIN_LOOK : name in ODD ? ODD[name] : lookOf({ kind: name }))
/** The looks `sameLook` is asked to compare with each other: the plain one, the six kinds and the odd ones. */
const SAME = ['plain', ...KIND_IDS, ...Object.keys(ODD)]

const MERGES: { looks: string[]; both: boolean }[] = [
  ...KIND_IDS.flatMap(k => [{ looks: [k], both: false }, { looks: [k, k], both: false }, { looks: [k, k], both: true }]),
  { looks: ['plain', 'plain'], both: true },
  { looks: ['request', 'plain'], both: false },
  { looks: ['request', 'stream'], both: false },
  { looks: ['publish', 'cached'], both: true },
  { looks: ['extension', 'request'], both: false },
  { looks: ['extension', 'plain'], both: true },
  { looks: ['dashed ring', 'dashed filled'], both: false },
  { looks: ['dashed ring', 'dashed double'], both: true },
  { looks: [], both: false },
]

/** The shop's web and API, with the connections a case gives them; a connection `back` runs from the API to the web app. */
type Spec = { label?: string; kind?: string; back?: true }
const pairOf = (specs: Spec[]): Model => ({
  ...shop(),
  connections: specs.map(({ label, kind, back }): Connection => ({ from: back ? 'api' : 'web', to: back ? 'web' : 'api', ...(label === undefined ? {} : { label }), ...(kind === undefined ? {} : { kind }) })),
})

const VIEWS: { name: string; specs: Spec[] }[] = [
  { name: 'no kind', specs: [{ label: 'REST' }] },
  { name: 'a word that is no kind', specs: [{ label: 'REST', kind: 'rpc' }] },
  { name: 'one request', specs: [{ label: 'REST', kind: 'request' }] },
  { name: 'two streams', specs: [{ label: 'a', kind: 'stream' }, { label: 'b', kind: 'stream' }] },
  { name: 'cached publish both ways', specs: [{ label: 'a', kind: 'cached' }, { label: 'b', kind: 'cached', back: true }] },
  { name: 'requests both ways', specs: [{ label: 'a', kind: 'request' }, { label: 'b', kind: 'request', back: true }] },
  { name: 'extension both ways', specs: [{ label: 'a', kind: 'extension' }, { label: 'b', kind: 'extension', back: true }] },
  { name: 'a kind and none', specs: [{ label: 'a', kind: 'request' }, { label: 'b' }] },
  { name: 'two kinds', specs: [{ label: 'a', kind: 'request' }, { label: 'b', kind: 'stream' }] },
  { name: 'an extension and a request', specs: [{ label: 'a', kind: 'extension' }, { label: 'b', kind: 'request' }] },
]

const CHECKS: { name: string; specs: Spec[] }[] = [
  { name: 'all six', specs: KIND_IDS.map((kind, i) => ({ label: `c${i}`, kind })) },
  { name: 'a word that is no kind', specs: [{ label: 'a', kind: 'rpc' }] },
  { name: 'a kind with a capital', specs: [{ label: 'a', kind: 'Request' }] },
  { name: 'a blank kind', specs: [{ label: 'a', kind: '' }] },
  { name: 'kinds make no duplicate', specs: [{ label: 'a', kind: 'request' }, { label: 'a', kind: 'stream' }] },
]

/** Two models, one edit: the history label the second earns, with kinds in it. */
const LABELS: { name: string; before: Spec[]; after: Spec[] }[] = [
  { name: 'a kind set', before: [{ label: 'REST' }], after: [{ label: 'REST', kind: 'stream' }] },
  { name: 'a kind changed', before: [{ label: 'REST', kind: 'stream' }], after: [{ label: 'REST', kind: 'cached' }] },
  { name: 'a kind taken off', before: [{ label: 'REST', kind: 'stream' }], after: [{ label: 'REST' }] },
  { name: 'a kind and a label', before: [{ label: 'REST' }], after: [{ label: 'HTTP', kind: 'request' }] },
  { name: 'a connection made with a kind', before: [], after: [{ label: 'REST', kind: 'request' }] },
]

export function dumpKinds(): unknown {
  return {
    ids: [...KIND_IDS],
    list: KIND_LIST,
    plainName: PLAIN_NAME,
    plain: PLAIN_LOOK,
    kinds: KIND_IDS.map(id => ({ id, name: kindName(id), look: KINDS[id].look, lookOfKind: lookOfKind(id), plainLook: isPlainLook(KINDS[id].look) })),
    noKind: { lookOfKind: lookOfKind(undefined), plainLook: isPlainLook(PLAIN_LOOK) },
    same: SAME.map(a => ({ look: a, row: SAME.map(b => sameLook(named(a), named(b))) })),
    words: WORDS.map(value => ({ value, isKind: isKindId(value), kind: kindOf({ kind: value }) ?? null })),
    shared: [
      [{ kind: 'request' }, { kind: 'request' }], [{ kind: 'request' }, {}], [{ kind: 'request' }, { kind: 'stream' }], [{ kind: 'rpc' }, { kind: 'rpc' }], [],
    ].map(connections => ({ connections, kind: sharedKind(connections) ?? null })),
    dashes: DASHES,
    marks: Object.entries(MARKS).map(([shape, mark]) => ({
      shape, paint: mark.paint, width: mark.width, path: mark.path,
      scaled: SCALES.map(scale => ({ scale, path: markPath(shape as keyof typeof MARKS, scale), stroke: markStroke(shape as keyof typeof MARKS, scale) })),
    })),
    merges: MERGES.map(({ looks, both }) => ({ looks, both, result: mergedLook(looks.map(named), both) ?? null })),
    looks: Object.fromEntries(Object.entries(ODD)),
    views: VIEWS.map(({ name, specs }) => ({ name, connections: pairOf(specs).connections, files: modelFiles(pairOf(specs)), edges: computeView(pairOf(specs), 'shop').edges })),
    checks: CHECKS.map(({ name, specs }) => ({ name, connections: pairOf(specs).connections, files: modelFiles(pairOf(specs)), problems: check(pairOf(specs)).map(p => ({ message: p.message, connection: p.connection ?? null })) })),
    labels: LABELS.map(({ name, before, after }) => ({ name, before: pairOf(before).connections, after: pairOf(after).connections, label: describeEdit(pairOf(before), pairOf(after)) ?? null })),
    mermaid: VIEWS.map(({ name, specs }) => ({ name, files: modelFiles(pairOf(specs)), text: viewToMermaid(pairOf(specs), 'shop') })),
  }
}
