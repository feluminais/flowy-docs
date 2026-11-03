import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { describeEdit } from '../src/core/editlabel.ts'
import {
  DASHES, isKindId, isPlainLook, KIND_IDS, KIND_LIST, kindName, kindOf, KINDS, lookOf, lookOfKind, MARKS, markPath, markStroke, mergedLook, PLAIN_LOOK, PLAIN_NAME,
  sameLook, sharedKind,
} from '../src/core/kinds.ts'
import type { LineLook } from '../src/core/kinds.ts'
import { viewToMermaid } from '../src/core/mermaid.ts'
import { parseModelFile, serializeFile } from '../src/core/modelfiles.ts'
import { connect, setKind } from '../src/core/ops.ts'
import type { Model } from '../src/core/model.ts'
import { computeView } from '../src/core/views.ts'
import { shop } from './fixtures.ts'

/** The shop with a pair of apps that can take any number of connections between them. */
const pair = (...connections: Record<string, unknown>[]): Model => ({
  ...shop(),
  connections: connections.map(c => ({ from: 'web', to: 'api', ...c })) as Model['connections'],
})

const edgeOf = (m: Model) => computeView(m, 'shop').edges

test('there are six kinds, each with a name a person says and a look of its own', () => {
  assert.deepEqual([...KIND_IDS], ['request', 'stream', 'publish', 'cached', 'object', 'extension'])
  assert.deepEqual(KIND_IDS.map(kindName), ['Request and reply', 'Request then stream', 'Publish and subscribe', 'Cached publish', 'Object updates', 'Extension point'])
  assert.equal(PLAIN_NAME, 'Plain line')
  assert.equal(KIND_LIST, 'request, stream, publish, cached, object, extension')
  // No two kinds look alike, and none looks like the plain line, or a reader could not tell them apart.
  const looks = [PLAIN_LOOK, ...KIND_IDS.map(id => KINDS[id].look)]
  for (const [i, a] of looks.entries()) for (const b of looks.slice(i + 1)) assert.ok(!sameLook(a, b), `${JSON.stringify(a)} and ${JSON.stringify(b)} look alike`)
  // Only the extension point is not solid, and only the call family has a filled head.
  assert.deepEqual(KIND_IDS.filter(id => KINDS[id].look.pattern !== 'solid'), ['extension'])
  assert.deepEqual(KIND_IDS.filter(id => KINDS[id].look.head === 'filled'), ['request', 'stream', 'extension'])
  assert.deepEqual(KIND_IDS.map(id => KINDS[id].look.tail), ['open', 'double', 'none', 'ring', 'diamond', 'none'])
})

test('a word is a kind only when it is written exactly', () => {
  for (const id of KIND_IDS) assert.equal(isKindId(id), true)
  for (const v of ['rpc', 'Request', ' request', 'request ', '', 3, null, undefined, ['request'], 'toString', '__proto__', 'constructor']) assert.equal(isKindId(v), false, String(v))
  assert.equal(kindOf({ kind: 'cached' }), 'cached')
  assert.equal(kindOf({ kind: 'rpc' }), undefined)
  assert.equal(kindOf({}), undefined)
  assert.deepEqual(lookOf({ kind: 'rpc' }), PLAIN_LOOK)
  assert.deepEqual(lookOf({ kind: 'extension' }), { pattern: 'dashdot', head: 'filled', tail: 'none' })
  assert.deepEqual(lookOfKind(undefined), PLAIN_LOOK)
  assert.equal(isPlainLook(lookOf({})), true)
  assert.equal(isPlainLook(lookOf({ kind: 'publish' })), false)
})

test('the marks are drawn in a 10 px band, each in a frame of its own with the tip at the origin', () => {
  assert.deepEqual(Object.keys(MARKS), ['filled', 'open', 'double', 'ring', 'diamond'])
  assert.equal(markPath('filled'), 'M0 0L-10 -4.5L-10 4.5Z')
  assert.equal(markPath('open'), 'M-9.5 -4L-1.5 0L-9.5 4')
  assert.equal(markPath('double'), 'M-9.5 -4L-1.5 0L-9.5 4M-15.5 -4L-7.5 0L-15.5 4')
  assert.equal(markPath('diamond'), 'M0 0L-6 -3.5L-12 0L-6 3.5Z')
  assert.equal(markPath('ring'), 'M0 0C0 1.933 -1.567 3.5 -3.5 3.5C-5.433 3.5 -7 1.933 -7 0C-7 -1.933 -5.433 -3.5 -3.5 -3.5C-1.567 -3.5 0 -1.933 0 0Z')
  for (const [shape, { path }] of Object.entries(MARKS)) {
    // The numbers come in pairs (x then y), and nothing reaches past 4.5 px either side of the line.
    const numbers = path.match(/-?\d*\.?\d+/g)!.map(Number)
    assert.equal(numbers.length % 2, 0, shape)
    const ys = numbers.filter((_, i) => i % 2 === 1)
    assert.ok(ys.every(y => Math.abs(y) <= 4.5), `${shape} is wider than the band`)
    assert.ok(numbers.filter((_, i) => i % 2 === 0).every(x => x <= 0), `${shape} reaches past the tip`)
    assert.ok(!/[a-z]/.test(path), `${shape} uses a relative command, which the path reader does not take apart`)
  }
  // The ring is four cubics (the reader flattens M, L, C and Q) and does not stray from its radius.
  assert.equal((MARKS.ring.path.match(/C/g) ?? []).length, 4)
  assert.deepEqual(Object.values(MARKS).map(m => m.paint), ['fill', 'stroke', 'stroke', 'hollow', 'hollow'])
  assert.deepEqual(Object.values(MARKS).map(m => m.width), [0, 1.75, 1.75, 1.5, 1.5])
})

test('a mark scales with the line, rounded to 3 decimals, and keeps its stroke in step', () => {
  assert.equal(markPath('filled', 1.55), 'M0 0L-15.5 -6.975L-15.5 6.975Z')
  assert.equal(markPath('open', 1.55), 'M-14.725 -6.2L-2.325 0L-14.725 6.2')
  assert.equal(markPath('diamond', 1.2), 'M0 0L-7.2 -4.2L-14.4 0L-7.2 4.2Z')
  assert.equal(markStroke('open', 1), 1.75)
  assert.equal(markStroke('open', 1.55), 2.713)
  assert.equal(markStroke('filled', 1.55), 0)
  assert.ok(!markPath('ring', 1.2).includes('-0'), 'a zero never prints as -0')
  // An odd scale never leaves a stray digit.
  for (const shape of Object.keys(MARKS) as (keyof typeof MARKS)[]) for (const s of [0.7, 1.2, 1.333, 1.55]) assert.doesNotMatch(markPath(shape, s), /\d\.\d{4}/, `${shape} at ${s}`)
})

test('the dash-dot pattern clears the dashes the canvas already uses', () => {
  assert.deepEqual(DASHES.solid, [])
  assert.deepEqual(DASHES.dashdot, [10, 4, 2, 4])
  assert.equal(DASHES.dashdot.reduce((a, b) => a + b, 0), 20)
})

test('a line that stands for several connections: the merge rule', () => {
  const request = lookOf({ kind: 'request' })
  const stream = lookOf({ kind: 'stream' })
  const publish = lookOf({ kind: 'publish' })
  const cached = lookOf({ kind: 'cached' })
  const extension = lookOf({ kind: 'extension' })
  // All the same and one way: the full look, tail included.
  assert.deepEqual(mergedLook([request], false), request)
  assert.deepEqual(mergedLook([stream, stream, stream], false), stream)
  assert.deepEqual(mergedLook([extension, extension], false), extension)
  // All the same and both ways: heads at both ends and no tails (the reader draws the heads from `both`).
  assert.deepEqual(mergedLook([publish, publish], true), publish)
  assert.deepEqual(mergedLook([cached, cached], true), { pattern: 'solid', head: 'open', tail: 'none' })
  assert.deepEqual(mergedLook([extension, extension], true), extension)
  // Both ways with a tail that would sit where the other end's head is: plain once the tail goes, so no look at all.
  assert.equal(mergedLook([request, request], true), undefined)
  // Mixed: plain, whatever the mix. A kind and no kind, two kinds, a kind and an unknown word.
  assert.equal(mergedLook([request, PLAIN_LOOK], false), undefined)
  assert.equal(mergedLook([request, stream], false), undefined)
  assert.equal(mergedLook([publish, cached], false), undefined)
  assert.equal(mergedLook([extension, request], false), undefined)
  assert.equal(mergedLook([extension, PLAIN_LOOK], true), undefined)
  // The same pattern with different marks keeps the pattern and draws a plain head. With the six kinds that only means plain, but the rule is general.
  const dashed: LineLook[] = [{ pattern: 'dashdot', head: 'open', tail: 'ring' }, { pattern: 'dashdot', head: 'filled', tail: 'none' }]
  assert.deepEqual(mergedLook(dashed, false), { pattern: 'dashdot', head: 'filled', tail: 'none' })
  assert.deepEqual(mergedLook([{ pattern: 'dashdot', head: 'open', tail: 'ring' }, { pattern: 'dashdot', head: 'open', tail: 'double' }], true), { pattern: 'dashdot', head: 'filled', tail: 'none' })
  // Plain stays plain, and no connections say nothing.
  assert.equal(mergedLook([PLAIN_LOOK, PLAIN_LOOK], true), undefined)
  assert.equal(mergedLook([], false), undefined)
  // What it returns is a copy, so a reader that edits it cannot change the table.
  const out = mergedLook([request], false)!
  out.tail = 'none'
  assert.equal(KINDS.request.look.tail, 'open')
})

test('sharedKind is the kind every connection has, or nothing', () => {
  assert.equal(sharedKind([{ kind: 'request' }, { kind: 'request' }]), 'request')
  assert.equal(sharedKind([{ kind: 'request' }, {}]), undefined)
  assert.equal(sharedKind([{ kind: 'request' }, { kind: 'stream' }]), undefined)
  assert.equal(sharedKind([{ kind: 'rpc' }, { kind: 'rpc' }]), undefined)
  assert.equal(sharedKind([]), undefined)
})

test('a view line carries the kind and look of its connections, and nothing when there are none', () => {
  // No kind anywhere: no new keys, so a model written before kinds reads the same.
  assert.deepEqual(edgeOf(pair({ label: 'REST' })), [{ from: 'web', to: 'api', label: 'REST', count: 1 }])
  assert.deepEqual(edgeOf(pair({ label: 'REST', kind: 'rpc' })), [{ from: 'web', to: 'api', label: 'REST', count: 1 }])
  assert.deepEqual(edgeOf(pair({ label: 'REST', kind: 'request' })), [{ from: 'web', to: 'api', label: 'REST', count: 1, kind: 'request', look: lookOf({ kind: 'request' }) }])
  // Several of one kind, one way: the full look.
  const [same] = edgeOf(pair({ label: 'a', kind: 'stream' }, { label: 'b', kind: 'stream' }))
  assert.deepEqual([same.kind, same.look, same.count, same.label], ['stream', lookOf({ kind: 'stream' }), 2, '2 connections'])
  // The other way too: the look keeps its head, loses its tail, and the line has `both`.
  const [back] = edgeOf(pair({ label: 'a', kind: 'cached' }, { label: 'b', kind: 'cached', from: 'api', to: 'web' }))
  assert.deepEqual([back.both, back.kind, back.look], [true, 'cached', { pattern: 'solid', head: 'open', tail: 'none' }])
  const [calls] = edgeOf(pair({ label: 'a', kind: 'request' }, { label: 'b', kind: 'request', from: 'api', to: 'web' }))
  assert.deepEqual([calls.both, calls.kind, 'look' in calls], [true, 'request', false]) // plain once the tails go
  // Mixed: a plain line; a kind with none; two kinds.
  for (const mix of [[{ label: 'a', kind: 'request' }, { label: 'b' }], [{ label: 'a', kind: 'request' }, { label: 'b', kind: 'stream' }], [{ label: 'a', kind: 'extension' }, { label: 'b', kind: 'request' }]]) {
    const [mixed] = edgeOf(pair(...mix))
    assert.equal('look' in mixed, false, JSON.stringify(mix))
    assert.equal('kind' in mixed, false, JSON.stringify(mix))
  }
  // Zoomed out, connections of different pairs below land on one line and merge the same way.
  const out: Model['connections'] = [{ from: 'web', to: 'mail', label: 'a', kind: 'publish' }, { from: 'orders', to: 'mail', label: 'b', kind: 'publish' }]
  const [merged] = computeView({ ...shop(), connections: out }, 'root').edges
  assert.deepEqual([merged.from, merged.to, merged.count, merged.kind, merged.look], ['shop', 'mail', 2, 'publish', lookOf({ kind: 'publish' })])
  const [odd] = computeView({ ...shop(), connections: [...out, { from: 'api', to: 'mail', label: 'c', kind: 'extension' }] }, 'root').edges
  assert.deepEqual([odd.count, 'kind' in odd, 'look' in odd], [3, false, false])
})

test('check reports a kind that is none of the six, and a model with kinds is otherwise sound', () => {
  assert.deepEqual(check(pair({ label: 'a', kind: 'request' }, { label: 'b', kind: 'extension' }, { label: 'c' })), [])
  const problems = check(pair({ label: 'a', kind: 'rpc' })).map(p => p.message)
  assert.deepEqual(problems, ['connection web → api: unknown kind "rpc" (use request, stream, publish, cached, object, extension)'])
  assert.deepEqual(check(pair({ label: 'a', kind: 'Request' })).map(p => p.message), ['connection web → api: unknown kind "Request" (use request, stream, publish, cached, object, extension)'])
  // Blank text is plain, like any blank field. (A `kind:` with nothing after it reads as blank text.)
  assert.deepEqual(check(pair({ label: 'a', kind: '' })), [])
  // The problem points at its connection, a kind never makes or hides a duplicate, and an extension from a store is fine.
  assert.equal(check(pair({ label: 'a', kind: 'rpc' })).at(0)?.connection, 0)
  assert.deepEqual(check(pair({ label: 'a', kind: 'request' }, { label: 'a', kind: 'stream' })).map(p => p.message), ['connection web → api: duplicate "a"'])
  assert.deepEqual(check({ ...shop(), connections: [{ from: 'db', to: 'api', label: 'hook', kind: 'extension' }] }), [])
})

test('the file reader takes kind as text, and a list or a mapping there is refused', () => {
  const text = 'objects:\n  a: { type: actor, name: A }\n  b: { type: system, name: B }\nconnections:\n  - { from: a, to: b, label: x, kind: stream }\n'
  const parsed = parseModelFile(text)
  assert.equal(parsed.connections[0].kind, 'stream')
  assert.throws(() => parseModelFile(text.replace('kind: stream', 'kind: [stream]')), /connection 1: "kind" must be plain text/)
  assert.throws(() => parseModelFile(text.replace('kind: stream', 'kind: { a: 1 }')), /connection 1: "kind" must be plain text/)
  assert.equal(parseModelFile(text.replace('kind: stream', 'kind:')).connections[0].kind, '') // a blank kind reads as blank text, which is the plain line
  // It is written back as it was read, in its place.
  const model = { objects: parsed.objects, connections: parsed.connections, meta: parsed.meta }
  assert.match(serializeFile('model', model as never), /- from: a\n {4}to: b\n {4}label: x\n {4}kind: stream\n/)
})

test('connect takes a kind, setKind sets and clears one, and a word that is no kind is refused', () => {
  const base = shop()
  const withKind = connect(base, { from: 'web', to: 'db', label: 'reads', kind: 'request' })
  assert.deepEqual(withKind.connections.at(-1), { from: 'web', to: 'db', label: 'reads', kind: 'request' })
  assert.deepEqual(connect(base, { from: 'web', to: 'db', kind: '' }).connections.at(-1), { from: 'web', to: 'db' })
  assert.deepEqual(connect(base, { from: 'web', to: 'db' }).connections.at(-1), { from: 'web', to: 'db' })
  // Key order: from, to, label, kind, payloads.
  assert.deepEqual(Object.keys(connect(base, { from: 'web', to: 'db', label: 'x', kind: 'stream', payloads: [{ name: 'P' }] }).connections.at(-1)!), ['from', 'to', 'label', 'kind', 'payloads'])
  assert.throws(() => connect(base, { from: 'web', to: 'db', kind: 'rpc' }), /unknown kind "rpc" \(use request, stream, publish, cached, object, extension\)/)
  assert.throws(() => connect(base, { from: 'web', to: 'db', kind: 'Request' }), /unknown kind/)

  const which = { from: 'web', to: 'api', label: 'REST' }
  const set = setKind(base, which, 'publish')
  assert.deepEqual(set.connections[1], { from: 'web', to: 'api', label: 'REST', kind: 'publish' })
  assert.deepEqual(setKind(set, which, 'extension').connections[1], { from: 'web', to: 'api', label: 'REST', kind: 'extension' })
  assert.deepEqual(setKind(set, which, '').connections[1], { from: 'web', to: 'api', label: 'REST' })
  assert.deepEqual(setKind(base, which, '').connections, base.connections)
  assert.equal(setKind(set, which, 'publish').connections[1].kind, 'publish')
  // Only that connection changes, and the model it was given does not.
  assert.deepEqual(set.connections.filter((_, i) => i !== 1), base.connections.filter((_, i) => i !== 1))
  assert.equal(base.connections[1].kind, undefined)
  // A new kind goes after the label and ahead of the other keys.
  const withPayloads: Model = { ...base, connections: [{ from: 'web', to: 'api', label: 'REST', payloads: ['p'], note: 'n' }] }
  assert.deepEqual(Object.keys(setKind(withPayloads, which, 'stream').connections[0]), ['from', 'to', 'label', 'kind', 'payloads', 'note'])
  // An unlabelled connection is found by "" or by leaving the label out.
  const bare: Model = { ...base, connections: [{ from: 'web', to: 'api' }] }
  assert.deepEqual(setKind(bare, { from: 'web', to: 'api' }, 'request').connections[0], { from: 'web', to: 'api', kind: 'request' })
  assert.throws(() => setKind(base, { from: 'web', to: 'api', label: 'nope' }, 'request'), /no connection web → api labelled "nope"/)
  assert.throws(() => setKind(base, which, 'rpc'), /unknown kind "rpc"/)
})

test('the history says which kind a connection was set to', () => {
  const base = shop()
  const which = { from: 'web', to: 'api', label: 'REST' }
  assert.equal(describeEdit(base, setKind(base, which, 'stream')), 'Set Web app to API as Request then stream')
  assert.equal(describeEdit(setKind(base, which, 'stream'), setKind(base, which, 'cached')), 'Set Web app to API as Cached publish')
  assert.equal(describeEdit(setKind(base, which, 'stream'), base), 'Set Web app to API as Plain line')
  assert.equal(describeEdit(base, connect(base, { from: 'web', to: 'db', label: 'x', kind: 'request' })), 'Connected Web app to Orders DB')
  // A label change is still a relabel, and a label and a kind together too.
  const relabelled: Model = { ...base, connections: base.connections.map((c, i) => (i === 1 ? { ...c, label: 'HTTP' } : c)) }
  assert.equal(describeEdit(base, relabelled), 'Relabelled Web app to API')
  const both: Model = { ...relabelled, connections: relabelled.connections.map((c, i) => (i === 1 ? { ...c, kind: 'request' } : c)) }
  assert.equal(describeEdit(base, both), 'Relabelled Web app to API')
})

test('Mermaid keeps what it can say of a kind: a dotted line for the extension point, an arrowhead at the start for a tail', () => {
  const lines = (m: Model) => viewToMermaid(m, 'shop').split('\n').filter(l => l.includes('-->') || l.includes('-.'))
  assert.deepEqual(lines(pair({ label: 'REST' })).map(l => l.trim().replace(/^\w+ /, '')), ['-- "REST" --> n1'])
  assert.deepEqual(lines(pair({ label: 'REST', kind: 'publish' })).map(l => l.trim().replace(/^\w+ /, '')), ['-- "REST" --> n1'])
  assert.deepEqual(lines(pair({ label: 'REST', kind: 'request' })).map(l => l.trim().replace(/^\w+ /, '')), ['<-- "REST" --> n1'])
  assert.deepEqual(lines(pair({ label: 'REST', kind: 'object' })).map(l => l.trim().replace(/^\w+ /, '')), ['<-- "REST" --> n1'])
  assert.deepEqual(lines(pair({ label: 'hook', kind: 'extension' })).map(l => l.trim().replace(/^\w+ /, '')), ['-. "hook" .-> n1'])
  assert.deepEqual(lines(pair({ kind: 'extension' })).map(l => l.trim().replace(/^\w+ /, '')), ['-.-> n1'])
  assert.deepEqual(lines(pair({ kind: 'extension' }, { label: 'x', kind: 'extension', from: 'api', to: 'web' })).map(l => l.trim().replace(/^\w+ /, '')), ['<-. "2 connections" .-> n1'])
  // Mixed kinds draw plain, here and on the canvas.
  assert.deepEqual(lines(pair({ label: 'a', kind: 'extension' }, { label: 'b' })).map(l => l.trim().replace(/^\w+ /, '')), ['-- "2 connections" --> n1'])
  // The kind's name is not added to the label.
  assert.ok(!viewToMermaid(pair({ label: 'REST', kind: 'request' }), 'shop').includes('Request and reply'))
})
