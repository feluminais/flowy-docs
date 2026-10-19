import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Step } from '../src/core/model.ts'
import { groupSteps, OpError, putFlow, putGroup, removeGroup, removeStep, setGroupKind, setStepGroup, updateFlow } from '../src/core/ops.ts'
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

const plain = () => putFlow(shop(), {
  id: 'pays', name: 'Pays', view: 'shop',
  groups: { retry: { kind: 'repeat', times: '3', text: 'Up to three tries' }, pick: { kind: 'branch' } },
  steps: [s('a'), s('b', { group: 'retry' }), s('c', { group: 'retry' }), s('d', { group: 'pick', lane: 'One' }), s('e')],
})
const at = (m: ReturnType<typeof plain>, i: number) => m.flows.pays.steps[i]

test('setStepGroup puts a step in a repeat without a lane, and in a branch behind the lane it follows', () => {
  assert.deepEqual(at(setStepGroup(plain(), 'pays', 0, 'retry'), 0), s('a', { group: 'retry' }))
  assert.deepEqual(at(setStepGroup(plain(), 'pays', 4, 'pick'), 4), s('e', { group: 'pick' }))
})

test('setStepGroup puts a step that comes first at the front of the first lane, which hands over its label', () => {
  const m = setStepGroup(plain(), 'pays', 2, 'pick')
  assert.deepEqual(at(m, 2), s('c', { group: 'pick', lane: 'One' }))
  assert.deepEqual(at(m, 3), s('d', { group: 'pick' }))
  assert.deepEqual(at(m, 1), s('b', { group: 'retry' }))
})

test('setStepGroup leaves the old group as removeStep does, and drops it when it was the last member', () => {
  const left = setStepGroup(plain(), 'pays', 3, '')
  assert.deepEqual(at(left, 3), s('d'))
  assert.deepEqual(Object.keys(left.flows.pays.groups!), ['retry'])
  const moved = setStepGroup(plain(), 'pays', 1, 'pick')
  assert.deepEqual(at(moved, 1), s('b', { group: 'pick', lane: 'One' }))
  assert.deepEqual(at(moved, 2), s('c', { group: 'retry' }))
  assert.deepEqual(at(moved, 3), s('d', { group: 'pick' }))
})

test('setStepGroup starts "Lane 1" in a group nobody is in, does nothing for the group a step is already in, and refuses what is not there', () => {
  const empty = updateFlow(plain(), 'pays', { groups: { ...plain().flows.pays.groups!, lone: { kind: 'parallel' } } })
  assert.deepEqual(at(setStepGroup(empty, 'pays', 0, 'lone'), 0), s('a', { group: 'lone', lane: 'Lane 1' }))
  const m = plain()
  assert.equal(setStepGroup(m, 'pays', 1, 'retry'), m)
  assert.equal(setStepGroup(m, 'pays', 0, ''), m)
  assert.throws(() => setStepGroup(m, 'pays', 0, 'nope'), /unknown group "nope"/)
  assert.throws(() => setStepGroup(m, 'pays', 7, 'retry'), /flow "pays" has no step 8/)
  assert.throws(() => setStepGroup(m, 'nope', 0, 'retry'), /unknown flow "nope"/)
})

test('setGroupKind turns a repeat into a branch: times and until go, the first step starts a lane, the text stays', () => {
  const m = setGroupKind(plain(), 'pays', 'retry', 'branch')
  assert.deepEqual(m.flows.pays.groups!.retry, { kind: 'branch', text: 'Up to three tries' })
  assert.deepEqual(at(m, 1), s('b', { group: 'retry', lane: 'Lane 1' }))
  assert.deepEqual(at(m, 2), s('c', { group: 'retry' }))
})

test('setGroupKind turns a branch into a repeat: the lanes go and it gets "times: 3" when it has neither times nor until', () => {
  const m = setGroupKind(plain(), 'pays', 'pick', 'repeat')
  assert.deepEqual(m.flows.pays.groups!.pick, { kind: 'repeat', times: '3' })
  assert.deepEqual(at(m, 3), s('d', { group: 'pick' }))
  const until = updateFlow(plain(), 'pays', { groups: { retry: { kind: 'repeat', until: 'it works' }, pick: { kind: 'branch' } } })
  assert.deepEqual(setGroupKind(until, 'pays', 'retry', 'repeat').flows.pays.groups!.retry, { kind: 'repeat', until: 'it works' })
})

test('setGroupKind refuses a kind or group that is not there', () => {
  assert.throws(() => setGroupKind(plain(), 'pays', 'retry', 'zig'), /unknown kind "zig" \(use repeat, branch, parallel\)/)
  assert.throws(() => setGroupKind(plain(), 'pays', 'nope', 'branch'), /unknown group "nope"/)
  assert.throws(() => setGroupKind(plain(), 'nope', 'retry', 'branch'), /unknown flow "nope"/)
})

test('groupSteps declares a repeat over a stretch with times 3, and a branch with a lane for every step', () => {
  const repeat = groupSteps(plain(), 'pays', 'again', 'repeat', 0, 0)
  assert.deepEqual(repeat.flows.pays.groups!.again, { kind: 'repeat', times: '3' })
  assert.deepEqual(at(repeat, 0), s('a', { group: 'again' }))
  assert.deepEqual(Object.keys(repeat.flows.pays.groups!), ['retry', 'pick', 'again'])
  const m = groupSteps(shop(), 'checkout', 'ways', 'parallel', 0, 1)
  assert.deepEqual(m.flows.checkout.groups, { ways: { kind: 'parallel' } })
  assert.deepEqual(m.flows.checkout.steps.slice(0, 2).map(x => [x.group, x.lane]), [['ways', 'Lane 1'], ['ways', 'Lane 2']])
  assert.deepEqual(Object.keys(m.flows.checkout), ['name', 'view', 'groups', 'steps'])
})

test('groupSteps refuses a bad id, a taken one, a step already in a group, a backwards or missing range and an unknown kind', () => {
  assert.throws(() => groupSteps(plain(), 'pays', 'Bad Id', 'repeat', 0, 0), /not a valid group id/)
  assert.throws(() => groupSteps(plain(), 'pays', 'retry', 'repeat', 0, 0), /group "retry" already exists/)
  assert.throws(() => groupSteps(plain(), 'pays', 'x', 'repeat', 0, 1), /step 2 is already in group "retry"/)
  assert.throws(() => groupSteps(plain(), 'pays', 'x', 'repeat', 4, 0), /step 1 comes before step 5/)
  assert.throws(() => groupSteps(plain(), 'pays', 'x', 'repeat', 0, 9), /flow "pays" has no step 10/)
  assert.throws(() => groupSteps(plain(), 'pays', 'x', 'zig', 0, 0), /unknown kind "zig"/)
  assert.throws(() => groupSteps(plain(), 'nope', 'x', 'repeat', 0, 0), /unknown flow "nope"/)
})
