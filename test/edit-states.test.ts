import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { OpError } from '../src/core/ops.ts'
import { changesBetween, pickStepState, stateOf, stepStateShapes } from '../ui/src/edit.ts'
import { shop } from './fixtures.ts'

const stepOf = (m: ReturnType<typeof shop>, i: number) => m.flows.checkout.steps[i]

test('the form offers a state for the step\'s two ends, once each, and for one shape when the step is its own', () => {
  assert.deepEqual(stepStateShapes({ from: 'web', to: 'api', text: 't' }), ['web', 'api'])
  assert.deepEqual(stepStateShapes({ from: 'web', text: 't' }), ['web'])
  assert.deepEqual(stepStateShapes({ from: 'web', to: 'web', text: 't' }), ['web'])
})

test('edit: picking a state on a step\'s to shape saves one edit, and None clears it', () => {
  const before = shop()
  const picked = pickStepState(before, 'checkout', 1, 'api', 'stopped')
  assert.deepEqual(stepOf(picked, 1).states, { api: 'stopped' })
  assert.deepEqual(changesBetween(before, picked).map(c => c.file), ['flows/checkout.yaml']) // one file, one edit
  assert.deepEqual(check(picked), [])
  assert.equal(stateOf(stepOf(picked, 1), 'api'), 'stopped')

  const cleared = pickStepState(picked, 'checkout', 1, 'api', '')
  assert.equal(Object.hasOwn(stepOf(cleared, 1), 'states'), false)
  assert.deepEqual(changesBetween(before, cleared), [])
  assert.equal(stateOf(stepOf(cleared, 1), 'api'), undefined)
})

test('edit: a pick changes only its own shape, and keeps what the file said about the others', () => {
  const m = shop()
  m.flows.checkout.steps[1].states = { web: 'degraded', api: 'starting' }
  const next = pickStepState(m, 'checkout', 1, 'api', 'running')
  assert.deepEqual(stepOf(next, 1).states, { web: 'degraded', api: 'running' })
  assert.deepEqual(stepOf(pickStepState(next, 'checkout', 1, 'web', ''), 1).states, { api: 'running' })
  // A shape the picker is not offering for this step is kept too.
  m.flows.checkout.steps[1].states = { db: 'stopped' }
  assert.deepEqual(stepOf(pickStepState(m, 'checkout', 1, 'api', 'degraded'), 1).states, { db: 'stopped', api: 'degraded' })
})

test('edit: a word the file has that is not a state is refused in the checker\'s words, not dropped', () => {
  const m = shop()
  m.flows.checkout.steps[1].states = { web: 'asleep' }
  assert.throws(() => pickStepState(m, 'checkout', 1, 'api', 'stopped'), (e: unknown) => e instanceof OpError && /states: unknown state "asleep" for "web"/.test(e.message))
})

test('edit: picking on a step or a flow that is not there is refused', () => {
  assert.throws(() => pickStepState(shop(), 'checkout', 9, 'api', 'stopped'), (e: unknown) => e instanceof OpError && /has no step 10/.test(e.message))
  assert.throws(() => pickStepState(shop(), 'nope', 0, 'api', 'stopped'), (e: unknown) => e instanceof OpError && /unknown flow "nope"/.test(e.message))
})
