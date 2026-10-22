import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpError, setCompare } from '../src/core/ops.ts'
import { compareOf } from '../src/core/compare.ts'
import { ParseError } from '../src/core/model.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import { setRunCompare } from '../src/core/perf/comparetag.ts'
import { shop } from './fixtures.ts'

const flowIds = () => Object.keys(shop().flows)

test('setCompare refuses an unknown flow, an unknown target and the flow itself', () => {
  const [first] = flowIds()
  assert.throws(() => setCompare(shop(), 'nope', { with: first }), OpError)
  assert.throws(() => setCompare(shop(), first, { with: 'nope' }), OpError)
  assert.throws(() => setCompare(shop(), first, { with: first }), OpError)
})

test('setCompare sets the tag and removing it gives back the model it started from', () => {
  const m = shop()
  const m2 = { ...m, flows: { ...m.flows, other: { ...m.flows[flowIds()[0]], name: 'Other' } } }
  const before = structuredClone(m2)
  const tagged = setCompare(m2, 'other', { with: flowIds()[0], note: 'after the fix' })
  assert.deepEqual(compareOf(tagged.flows.other.compare), { with: flowIds()[0], note: 'after the fix' })
  assert.deepEqual(m2, before, 'the model it was given is not changed')
  assert.deepEqual(setCompare(tagged, 'other', undefined), before)
})

test('setCompare with no note writes the short form', () => {
  const m = shop()
  const [first] = flowIds()
  const m2 = { ...m, flows: { ...m.flows, other: { ...m.flows[first], name: 'Other' } } }
  assert.equal(setCompare(m2, 'other', { with: first }).flows.other.compare, first)
})

const RUN = `# Dinner rush, before the fix
name: "Dinner rush"
about: Orders at the evening peak
unit: orders/min
entry: gateway
levels:
  - load: 100
    overall: { p50: 20, p95: 40 }
  # the second level
  - load: 200
    overall: { p50: 30, p95: 90 }
    objects:
      db: { util: 0.7 }
`

test('setRunCompare adds the short form at the end and removing it gives back the original bytes', () => {
  const tagged = setRunCompare(RUN, { with: 'other' })
  assert.equal(tagged, `${RUN}compare: other\n`)
  assert.equal(setRunCompare(tagged, undefined), RUN)
})

test('setRunCompare adds the long form with a double-quoted note, and removes it again', () => {
  const tagged = setRunCompare(RUN, { with: 'other', note: 'after the "fix", 5\\5' })
  assert.equal(tagged, `${RUN}compare:\n  with: other\n  note: "after the \\"fix\\", 5\\\\5"\n`)
  assert.equal(setRunCompare(tagged, undefined), RUN)
})

test('setRunCompare writes a note with a line break as a block scalar indented four spaces', () => {
  const tagged = setRunCompare(RUN, { with: 'other', note: 'first line\nsecond: line\n\nlast' })
  assert.equal(tagged, `${RUN}compare:\n  with: other\n  note: |-\n    first line\n    second: line\n\n    last\n`)
  assert.deepEqual(compareOf(parseRun('r', tagged).run.compare), { with: 'other', note: 'first line\nsecond: line\n\nlast' })
  assert.equal(setRunCompare(tagged, undefined), RUN)
})

test('setRunCompare falls back to the quoted form for a note a block scalar cannot hold', () => {
  for (const note of [' indented\nnext', '\nstarts empty', 'ends with a break\n', 'tab\u0001\nx', 'line separator']) {
    const tagged = setRunCompare(RUN, { with: 'other', note })
    assert.equal(parseRun('r', tagged).run.compare?.note, note, JSON.stringify(note))
    assert.equal(setRunCompare(tagged, undefined), RUN)
  }
})

test('setRunCompare replaces a tag where it stands', () => {
  const middle = RUN.replace('unit: orders/min\n', 'unit: orders/min\ncompare: old\n')
  const replaced = setRunCompare(middle, { with: 'new', note: 'why' })
  assert.equal(replaced, RUN.replace('unit: orders/min\n', 'unit: orders/min\ncompare:\n  with: new\n  note: "why"\n'))
  assert.equal(setRunCompare(replaced, { with: 'old' }), middle)
  const long = RUN.replace('entry: gateway\n', 'entry: gateway\ncompare: { with: old, note: x }\n')
  assert.equal(setRunCompare(long, { with: 'new' }), RUN.replace('entry: gateway\n', 'entry: gateway\ncompare: new\n'))
})

test('setRunCompare removes a tag that has a long form in the middle of the file', () => {
  const withLong = RUN.replace('entry: gateway\n', 'entry: gateway\ncompare:\n  with: old\n  note: |-\n    a\n    b\n')
  assert.equal(setRunCompare(withLong, undefined), RUN)
})

test('setRunCompare leaves a text without a tag as it is when asked to remove one', () => {
  assert.equal(setRunCompare(RUN, undefined), RUN)
})

test('setRunCompare adds the missing newline before a new key, and keeps a CRLF file in CRLF', () => {
  assert.equal(setRunCompare('name: R\nunit: x', { with: 'o' }), 'name: R\nunit: x\ncompare: o\n')
  const crlf = RUN.replaceAll('\n', '\r\n')
  const tagged = setRunCompare(crlf, { with: 'o', note: 'a\nb' })
  assert.equal(tagged, `${crlf}compare:\r\n  with: o\r\n  note: |-\r\n    a\r\n    b\r\n`)
  assert.equal(setRunCompare(tagged, undefined), crlf)
})

test('setRunCompare quotes an id a plain value could not hold', () => {
  const tagged = setRunCompare(RUN, { with: 'a: b' })
  assert.equal(tagged, `${RUN}compare: "a: b"\n`)
  assert.equal(parseRun('r', tagged).run.compare?.with, 'a: b')
})

test('setRunCompare keeps the comments and blank lines around a tag it replaces or removes', () => {
  const text = 'name: R\n\ncompare:\n  with: old\n  note: |-\n    a\n    b\n\n# about the unit\nunit: x\ncompare2: kept\n'
  assert.equal(setRunCompare(text, undefined), 'name: R\n\n\n# about the unit\nunit: x\ncompare2: kept\n')
  assert.equal(setRunCompare(text, { with: 'new' }), 'name: R\n\ncompare: new\n\n# about the unit\nunit: x\ncompare2: kept\n')
  const last = 'name: R\ncompare:\n  with: old\n  note: |-\n    a\n    b'
  assert.equal(setRunCompare(last, undefined), 'name: R\n')
  assert.equal(setRunCompare(last, { with: 'new' }), 'name: R\ncompare: new')
})

test('setRunCompare refuses text that is not a mapping', () => {
  for (const bad of ['', '- a\n- b\n', 'just text\n', '[a, b]\n', '{ name: R }\n', 'name: [unclosed\n']) assert.throws(() => setRunCompare(bad, { with: 'o' }), ParseError, JSON.stringify(bad))
})
