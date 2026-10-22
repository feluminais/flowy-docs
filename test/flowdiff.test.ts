import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffFlows } from '../src/core/flowdiff.ts'
import { lineKey } from '../src/core/failures.ts'
import type { Flow, Step } from '../src/core/model.ts'

const flow = (steps: Step[]): Flow => ({ name: 'F', view: 'overview', steps })
const empty = { steps: {}, shapes: {}, lines: {} }

const base: Step[] = [
  { from: 'a', to: 'b', text: 'one' },
  { from: 'b', to: 'c', text: 'two' },
]

test('identical flows give empty marks and are related', () => {
  const d = diffFlows(flow(base), flow(base.map(s => ({ ...s }))))
  assert.equal(d.related, true)
  assert.deepEqual(d.older, empty)
  assert.deepEqual(d.newer, empty)
})

test('a flow diffed with itself is empty', () => {
  const f = flow(base)
  assert.deepEqual(diffFlows(f, f), { related: true, older: empty, newer: empty })
})

test('a step added at the end is new, with its unused shapes and line new', () => {
  const d = diffFlows(flow(base), flow([...base, { from: 'c', to: 'd', text: 'three' }]))
  assert.deepEqual(d.older, { steps: {}, shapes: { c: 'changed' }, lines: {} })
  assert.deepEqual(d.newer, { steps: { 2: 'new' }, shapes: { c: 'changed', d: 'new' }, lines: { [lineKey('c', 'd')]: 'new' } })
})

test('a step added on shapes both flows already use marks only the step and shapes it touches', () => {
  const d = diffFlows(flow(base), flow([...base, { from: 'a', to: 'c', text: 'skip' }]))
  assert.deepEqual(d.newer.steps, { 2: 'new' })
  assert.deepEqual(d.newer.shapes, { a: 'changed', c: 'changed' })
  assert.deepEqual(d.newer.lines, { [lineKey('a', 'c')]: 'new' })
  assert.deepEqual(d.older.steps, {})
  assert.deepEqual(d.older.lines, {})
})

test('the same ends with different text are changed on both sides', () => {
  const d = diffFlows(flow(base), flow([base[0], { from: 'b', to: 'c', text: 'two, reworded' }]))
  assert.deepEqual(d.older.steps, { 1: 'changed' })
  assert.deepEqual(d.newer.steps, { 1: 'changed' })
  assert.deepEqual(d.older.shapes, { b: 'changed', c: 'changed' })
  assert.deepEqual(d.newer.shapes, { b: 'changed', c: 'changed' })
  assert.deepEqual(d.older.lines, { [lineKey('b', 'c')]: 'changed' })
  assert.deepEqual(d.newer.lines, { [lineKey('b', 'c')]: 'changed' })
})

test('a removed step is removed on the older side only', () => {
  const d = diffFlows(flow([...base, { from: 'c', to: 'd', text: 'three' }]), flow(base))
  assert.deepEqual(d.older.steps, { 2: 'removed' })
  assert.deepEqual(d.older.shapes, { c: 'changed', d: 'removed' })
  assert.deepEqual(d.older.lines, { [lineKey('c', 'd')]: 'removed' })
  assert.deepEqual(d.newer, { steps: {}, shapes: { c: 'changed' }, lines: {} })
})

test('flows with no shape in common are unrelated and every record is empty', () => {
  const d = diffFlows(flow(base), flow([{ from: 'x', to: 'y', text: 'other' }]))
  assert.deepEqual(d, { related: false, older: empty, newer: empty })
})

test('a step with no to touches only its from shape and no line', () => {
  const d = diffFlows(flow([{ from: 'a', text: 'solo' }]), flow([{ from: 'a', text: 'solo' }, { from: 'a', text: 'again' }]))
  assert.deepEqual(d.newer, { steps: { 1: 'new' }, shapes: { a: 'changed' }, lines: {} })
  assert.deepEqual(d.older, { steps: {}, shapes: { a: 'changed' }, lines: {} })
})

test('a matched step whose animation or description differs is changed', () => {
  const older = flow([{ from: 'a', to: 'b', text: 'one', animation: 'pulse' }, { from: 'b', to: 'c', text: 'two' }])
  const newer = flow([{ from: 'a', to: 'b', text: 'one', animation: { kind: 'pulse' } }, { from: 'b', to: 'c', text: 'two', description: 'more' }])
  const d = diffFlows(older, newer)
  assert.deepEqual(d.older.steps, { 0: 'changed', 1: 'changed' })
  assert.deepEqual(d.newer.steps, { 0: 'changed', 1: 'changed' })
})

test('steps are matched in order with a longest common subsequence', () => {
  const s = (t: string, to = 'b'): Step => ({ from: 'a', to, text: t })
  const d = diffFlows(flow([s('x'), s('y'), s('z')]), flow([s('y'), s('z'), s('w', 'c')]))
  assert.deepEqual(d.older.steps, { 0: 'removed' })
  assert.deepEqual(d.newer.steps, { 2: 'new' })
})

test('a tie in the longest common subsequence skips the older step first, so the later older step is matched', () => {
  const p: Step = { from: 'a', to: 'b', text: 'p' }
  const q: Step = { from: 'b', to: 'c', text: 'q' }
  // older [p, q], newer [q, p]: matching p or q is equally long. The rule matches q, so p is left over on both sides and pairs up
  // (same ends). Had p been matched, q would be the changed pair instead.
  const d = diffFlows(flow([p, q]), flow([q, p]))
  assert.deepEqual(d.older.steps, { 0: 'changed' })
  assert.deepEqual(d.newer.steps, { 1: 'changed' })
})

test('leftovers with the same ends pair in order as changed; the rest are removed and new', () => {
  const s = (f: string, t: string, text: string): Step => ({ from: f, to: t, text })
  const d = diffFlows(
    flow([s('a', 'b', '1'), s('a', 'b', '2'), s('b', 'c', 'gone')]),
    flow([s('a', 'b', 'x'), s('a', 'b', 'y'), s('a', 'b', 'z')]),
  )
  assert.deepEqual(d.older.steps, { 0: 'changed', 1: 'changed', 2: 'removed' })
  assert.deepEqual(d.newer.steps, { 0: 'changed', 1: 'changed', 2: 'new' })
})
