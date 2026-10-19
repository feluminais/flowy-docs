import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changedPaths, CLOSED_LABEL, collapseSteps, fallbackLabel, FIRST_LABEL, HISTORY_LIMIT, isLabelled, mcpLabel, outsideLabel,
  planRetention, sameFiles, stepId, stepInfos,
} from '../src/core/history.ts'
import type { Step, StepSource } from '../src/core/history.ts'

const step = (id: string, files: Record<string, string>, source: StepSource = 'you'): Step =>
  ({ id, time: '2026-10-20T10:00:00.000Z', label: `label ${id}`, source, app: 'browser', files })

test('the limit is 300 steps', () => {
  assert.equal(HISTORY_LIMIT, 300)
})

test('stepId sorts by time', () => {
  const earlier = stepId(new Date('2026-10-20T10:15:00.123Z'), 'ab12cd')
  assert.equal(earlier, '20261020T101500123Z-ab12cd')
  assert.ok(stepId(new Date('2026-10-20T10:15:00.124Z'), '000000') > earlier)
})

test('you, claude and restore are labelled; outside and first are not', () => {
  for (const source of ['you', 'claude', 'restore'] as const) assert.equal(isLabelled(source), true)
  for (const source of ['outside', 'first'] as const) assert.equal(isLabelled(source), false)
})

test('sameFiles ignores key order and sees an extra or different file', () => {
  assert.equal(sameFiles({ a: '1', b: '2' }, { b: '2', a: '1' }), true)
  assert.equal(sameFiles({ a: '1' }, { a: '2' }), false)
  assert.equal(sameFiles({ a: '1' }, { a: '1', b: '2' }), false)
  assert.equal(sameFiles({}, {}), true)
})

test('changedPaths lists changed, added and removed files, sorted', () => {
  assert.deepEqual(changedPaths({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' }), ['b', 'c', 'd'])
  assert.deepEqual(changedPaths({ a: '1' }, { a: '1' }), [])
})

test('collapse: an outside step with the same files as the labelled one before it is dropped', () => {
  const a = step('1', { m: '1' })
  assert.deepEqual(collapseSteps([a, step('2', { m: '1' }, 'outside')]), [a])
})

test('collapse: a labelled step replaces the identical outside one before it', () => {
  const a = step('1', { m: '1' })
  const c = step('3', { m: '2' })
  assert.deepEqual(collapseSteps([a, step('2', { m: '2' }, 'outside'), c]), [a, c])
})

test('collapse: a labelled step replaces the identical first-seen step', () => {
  const edit = step('2', { m: '1' }, 'claude')
  assert.deepEqual(collapseSteps([step('1', { m: '1' }, 'first'), edit]), [edit])
})

test('collapse: two labelled steps with equal files keep the earlier', () => {
  const a = step('1', { m: '1' })
  assert.deepEqual(collapseSteps([a, step('2', { m: '1' }, 'claude')]), [a])
})

test('collapse: nothing in, nothing out, and the input is left alone', () => {
  assert.deepEqual(collapseSteps([]), [])
  const input = [step('1', { m: '1' }), step('2', { m: '1' }, 'outside')]
  collapseSteps(input)
  assert.equal(input.length, 2)
})

test('stepInfos: newest first, changed against the step before, the oldest lists all its files', () => {
  const infos = stepInfos([step('1', { a: '1' }), step('2', { a: '2', b: '1' }), step('3', { a: '2', b: '1', c: '1' })])
  assert.deepEqual(infos.map(i => [i.id, i.changed]), [['3', ['c']], ['2', ['a', 'b']], ['1', ['a']]])
  assert.deepEqual(infos[0], { id: '3', time: '2026-10-20T10:00:00.000Z', label: 'label 3', source: 'you', app: 'browser', changed: ['c'] })
})

test('planRetention keeps the newest N, drops the rest, and keeps the blobs the kept steps name', () => {
  const steps = [1, 2, 3, 4, 5].map(n => step(String(n), { m: `h${n}`, shared: 'same' }))
  const plan = planRetention(steps, 3)
  assert.deepEqual(plan.dropSteps, ['1', '2'])
  assert.deepEqual([...plan.keepBlobs].sort(), ['h3', 'h4', 'h5', 'same'])
  assert.deepEqual(planRetention(steps, 5).dropSteps, [])
  assert.deepEqual(planRetention(steps, 9).dropSteps, [])
})

test('labels', () => {
  assert.equal(FIRST_LABEL, 'First seen')
  assert.equal(CLOSED_LABEL, 'Changed while Flowy was closed')
  assert.equal(outsideLabel(['model.yaml']), 'Changed outside Flowy: model.yaml')
  assert.equal(outsideLabel(['model.yaml', 'layout.yaml', 'flows/a.yaml']), 'Changed outside Flowy: model.yaml, layout.yaml, flows/a.yaml')
  assert.equal(outsideLabel(['a', 'b', 'c', 'd']), 'Changed outside Flowy: 4 files')
  assert.equal(fallbackLabel(['layout.yaml']), 'Changed layout.yaml')
  assert.equal(fallbackLabel(['a', 'b', 'c', 'd']), 'Changed 4 files')
  assert.equal(outsideLabel([]), 'Changed outside Flowy')
  assert.equal(fallbackLabel([]), 'Changed files')
})

test('mcpLabel names the tool and what it was given', () => {
  assert.equal(mcpLabel('put_object', { id: 'cart' }), 'Claude: put_object cart')
  assert.equal(mcpLabel('connect', { from: 'a', to: 'b' }), 'Claude: connect a → b')
  assert.equal(mcpLabel('put_icon', { name: 'stripe' }), 'Claude: put_icon stripe')
  assert.equal(mcpLabel('get_model', {}), 'Claude: get_model')
  assert.equal(mcpLabel('put_object', { id: 5 }), 'Claude: put_object')
  assert.equal(mcpLabel('connect', { from: 'a' }), 'Claude: connect')
})
