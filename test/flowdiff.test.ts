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

const animated = (animation?: unknown, description?: string): Flow => {
  const step: Step = { from: 'a', to: 'b', text: 'one' }
  if (animation !== undefined) step.animation = animation
  if (description !== undefined) step.description = description
  return flow([step])
}

test('an animation with its keys reordered is not changed', () => {
  const d = diffFlows(animated({ kind: 'send', a: '1', b: { y: '2', x: '3' } }), animated({ b: { x: '3', y: '2' }, a: '1', kind: 'send' }))
  assert.deepEqual(d.older, empty)
  assert.deepEqual(d.newer, empty)
})

test('a bare animation text equals a mapping with that kind', () => {
  assert.deepEqual(diffFlows(animated('pulse'), animated({ kind: 'pulse' })).newer, empty)
  assert.deepEqual(diffFlows(animated(''), animated()).newer, empty)
})

test('a different animation is changed, and so is a missing one against a real one', () => {
  assert.deepEqual(diffFlows(animated('pulse'), animated('flash')).newer.steps, { 0: 'changed' })
  assert.deepEqual(diffFlows(animated('pulse'), animated()).older.steps, { 0: 'changed' })
})

test('a different description is changed', () => {
  const d = diffFlows(animated(undefined, 'before'), animated(undefined, 'after'))
  assert.deepEqual(d.older.steps, { 0: 'changed' })
  assert.deepEqual(d.newer.steps, { 0: 'changed' })
  assert.deepEqual(diffFlows(animated(undefined, 'same'), animated(undefined, 'same')).newer, empty)
})

test('a shape id of __proto__ keeps its mark as data', () => {
  const step = (text: string): Step => ({ from: '__proto__', to: 'b', text })
  const d = diffFlows(flow([step('one')]), flow([step('two')]))
  assert.deepEqual(Object.keys(d.older.shapes).sort(), ['__proto__', 'b'])
  assert.equal(Object.getOwnPropertyDescriptor(d.older.shapes, '__proto__')?.value, 'changed')
  assert.equal(Object.getOwnPropertyDescriptor(d.newer.shapes, '__proto__')?.value, 'changed')
  assert.deepEqual(Object.keys(d.newer.lines), [lineKey('__proto__', 'b')])
})

test('leftover pairing is by ends and need not keep order', () => {
  const s = (from: string, to: string, text: string): Step => ({ from, to, text })
  const d = diffFlows(flow([s('a', 'b', 'A'), s('c', 'd', 'B')]), flow([s('c', 'd', 'D'), s('a', 'b', 'C')]))
  // A pairs with C and B with D, crossing. Keeping the order would leave A removed and D new.
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
