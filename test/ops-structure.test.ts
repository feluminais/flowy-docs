import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Step } from '../src/core/model.ts'
import { OpError, putFlow, putGroup, removeGroup, removeStep, updateFlow } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

const s = (text: string, extra: Partial<Step> = {}): Step => ({ from: 'web', to: 'api', text, ...extra })
const grouped = () => putFlow(shop(), {
  id: 'pays', name: 'Pays', view: 'shop',
  groups: { retry: { kind: 'repeat', times: 3 }, result: { kind: 'branch' } },
  steps: [
    s('try', { group: 'retry' }), s('try again', { group: 'retry' }),
    s('paid', { group: 'result', lane: 'Accepted' }), s('logged', { group: 'result' }), s('declined', { group: 'result', lane: 'Declined' }),
    s('done'),
  ],
})
const stepsOf = (m: ReturnType<typeof grouped>) => m.flows.pays.steps.map(x => x.text)

test('removing a step in the middle of a group changes nothing else', () => {
  const m = removeStep(grouped(), 'pays', 1)
  assert.deepEqual(stepsOf(m), ['try', 'paid', 'logged', 'declined', 'done'])
  assert.deepEqual(Object.keys(m.flows.pays.groups!), ['retry', 'result'])
})

test('removing the step that starts a lane hands its label to the next step of that lane', () => {
  const m = removeStep(grouped(), 'pays', 2)
  assert.deepEqual(m.flows.pays.steps[2], { from: 'web', to: 'api', text: 'logged', group: 'result', lane: 'Accepted' })
  assert.equal(m.flows.pays.steps[3].lane, 'Declined')
})

test('removing the only step of a lane takes the lane with it, and the next lane keeps its own label', () => {
  const m = removeStep(grouped(), 'pays', 4)
  assert.deepEqual(stepsOf(m), ['try', 'try again', 'paid', 'logged', 'done'])
  const gone = removeStep(removeStep(m, 'pays', 3), 'pays', 2)
  assert.equal(gone.flows.pays.groups!.result, undefined) // no step is in it any more
})

test('removing the last member of a group removes its declaration, and the groups section when it was the last', () => {
  let m = removeStep(removeStep(grouped(), 'pays', 0), 'pays', 0)
  assert.deepEqual(Object.keys(m.flows.pays.groups!), ['result'])
  m = removeStep(removeStep(removeStep(m, 'pays', 0), 'pays', 0), 'pays', 0)
  assert.equal('groups' in m.flows.pays, false)
  assert.deepEqual(stepsOf(m), ['done'])
})

test('removing a step outside any group leaves the groups alone, and a bad flow or place is refused', () => {
  const m = removeStep(grouped(), 'pays', 5)
  assert.deepEqual(m.flows.pays.groups, grouped().flows.pays.groups)
  assert.throws(() => removeStep(grouped(), 'pays', 9), OpError)
  assert.throws(() => removeStep(grouped(), 'pays', -1), OpError)
  assert.throws(() => removeStep(grouped(), 'nope', 0), /unknown flow "nope"/)
})

test('putGroup creates or replaces a declaration, with times as text and blank options left out', () => {
  const m = putGroup(grouped(), 'pays', 'poll', { kind: 'repeat', times: 5, until: '  ', text: 'Every second' })
  assert.deepEqual(m.flows.pays.groups!.poll, { kind: 'repeat', times: '5', text: 'Every second' })
  const replaced = putGroup(m, 'pays', 'poll', { kind: 'repeat', until: 'it is ready' })
  assert.deepEqual(replaced.flows.pays.groups!.poll, { kind: 'repeat', until: 'it is ready' })
  assert.deepEqual(Object.keys(replaced.flows.pays.groups!), ['retry', 'result', 'poll'])
  assert.throws(() => putGroup(grouped(), 'pays', 'Bad Id', { kind: 'branch' }), /not a valid group id/)
  assert.throws(() => putGroup(grouped(), 'nope', 'x', { kind: 'branch' }), /unknown flow "nope"/)
  assert.deepEqual(putGroup(shop(), 'checkout', 'g', { kind: 'parallel' }).flows.checkout.groups, { g: { kind: 'parallel' } })
})

test('removeGroup takes its declaration and every step\'s group and lane that named it', () => {
  const m = removeGroup(grouped(), 'pays', 'result')
  assert.deepEqual(Object.keys(m.flows.pays.groups!), ['retry'])
  assert.deepEqual(m.flows.pays.steps.slice(2), [s('paid'), s('logged'), s('declined'), s('done')])
  assert.equal('groups' in removeGroup(m, 'pays', 'retry').flows.pays, false)
  assert.throws(() => removeGroup(grouped(), 'pays', 'nope'), /unknown group "nope"/)
})

test('updateFlow takes groups too, and keeps the groups when it is not given any', () => {
  const m = updateFlow(grouped(), 'pays', { groups: { retry: { kind: 'repeat', times: '2' } } })
  assert.deepEqual(m.flows.pays.groups, { retry: { kind: 'repeat', times: '2' } })
  assert.deepEqual(updateFlow(grouped(), 'pays', { name: 'Pays again' }).flows.pays.groups, grouped().flows.pays.groups)
})
