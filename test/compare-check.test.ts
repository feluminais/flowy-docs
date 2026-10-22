import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { checkRuns } from '../src/core/perf/check.ts'
import { parseFlowFile } from '../src/core/modelfiles.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import type { Run } from '../src/core/perf/types.ts'
import { shop } from './fixtures.ts'

/** The shop with a second flow that carries `compare`. */
function withTag(compare: unknown) {
  const m = shop()
  const [first] = Object.keys(m.flows)
  m.flows.newer = { ...m.flows[first], name: 'Newer', compare }
  return { m, first }
}
const messages = (m: ReturnType<typeof shop>) => check(m).map(p => `${p.file} ${p.message}`)

test('a flow that compares with a flow that is there has no problem, in either form', () => {
  const { m, first } = withTag(undefined)
  assert.deepEqual(check(m), [])
  m.flows.newer.compare = first
  assert.deepEqual(check(m), [])
  m.flows.newer.compare = { with: first, note: 'after the fix' }
  assert.deepEqual(check(m), [])
})

test('a flow that compares with a missing flow is a problem on its file', () => {
  const { m } = withTag('nope')
  assert.deepEqual(messages(m), ['flows/newer.yaml compare "nope" is not a flow'])
})

test('a flow that compares with itself is a problem', () => {
  const { m } = withTag('newer')
  assert.deepEqual(messages(m), ['flows/newer.yaml compare points at this flow itself'])
})

test('a compare that is not an id or a mapping with one is a problem', () => {
  for (const bad of [['a'], 3, { note: 'x' }, '']) {
    const { m } = withTag(bad)
    assert.deepEqual(messages(m), ['flows/newer.yaml compare must be a flow id, or { with, note } with text'])
  }
})

test('parseRun keeps the tag, in either form, and leaves out one that cannot be read', () => {
  const body = 'name: Run\nlevels:\n  - { load: 1 }\n  - { load: 2 }\n'
  assert.deepEqual(parseRun('r', `compare: other\n${body}`).run.compare, { with: 'other' })
  assert.deepEqual(parseRun('r', `compare: { with: other, note: why }\n${body}`).run.compare, { with: 'other', note: 'why' })
  assert.equal('compare' in parseRun('r', body).run, false)
  const bad = parseRun('r', `compare: [a]\n${body}`)
  assert.equal('compare' in bad.run, false)
  assert.deepEqual(bad.problems, [{ file: 'perf/r.yaml', message: 'compare must be a run id, or { with, note } with text' }])
})

test('a run that adds others keeps its tag too', () => {
  const text = 'name: Both\ncompare: other\nadds: [a, b]\n'
  assert.deepEqual(parseRun('both', text).run.compare, { with: 'other' })
})

const run = (compare?: Run['compare']): Run => ({ name: 'R', unit: 'load', levels: [], ...(compare ? { compare } : {}) })
const said = (runs: Record<string, Run>) => checkRuns(runs).map(p => `${p.file} ${p.message}`)

test('a bare compare on a run is no tag and no problem', () => {
  const read = parseRun('r', 'name: Run\ncompare:\nlevels:\n  - { load: 1 }\n  - { load: 2 }\n')
  assert.equal('compare' in read.run, false)
  assert.deepEqual(read.problems, [])
})

test('a bare compare on a flow file gives the shape problem and no empty-key one', () => {
  const m = shop()
  m.flows.bare = parseFlowFile('bare', 'name: Bare\nview: shop\ncompare:\nsteps:\n  - { from: customer, to: web, text: Opens the shop }\n')
  assert.deepEqual(messages(m), ['flows/bare.yaml compare must be a flow id, or { with, note } with text'])
})

test('checkRuns names a compare that is not a run, or the run itself', () => {
  assert.deepEqual(said({ a: run({ with: 'b' }) }), ['perf/a.yaml compare "b" is not a run'])
  assert.deepEqual(said({ a: run({ with: 'a' }) }), ['perf/a.yaml compare points at this run itself'])
  assert.deepEqual(said({ a: run({ with: 'b' }), b: run() }), [])
})
