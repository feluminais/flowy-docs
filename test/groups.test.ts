import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repeatWords } from '../src/core/captions.ts'
import { changeKind, dropGroup, groupRange, joinGroup, laneName, leaveGroup, newGroup, stepGroupId, stepLaneLabel, withGroups } from '../src/core/groups.ts'
import type { Flow, Step } from '../src/core/model.ts'
import { declaredGroups, GROUP_INFO, groupOf, hasLanes, takesOption } from '../src/core/structure.ts'

const flowWith = (groups: unknown, steps: Step[] = []): Flow => ({ name: 'Pays', view: 'shop', groups, steps }) as Flow
const step = (text: string, extra: Partial<Step> = {}): Step => ({ from: 'web', to: 'api', text, ...extra })

test('groupOf reads a declared group once, with trimmed text and only what it says', () => {
  const flow = flowWith({
    retry: { kind: 'repeat', times: '3', until: '  it works ', text: ' Backs off ' },
    pick: { kind: 'branch', times: '  ', until: 4 },
    odd: { kind: 'loop' },
    none: {},
    flat: 'repeat',
  })
  assert.deepEqual(groupOf(flow, 'retry'), { kind: 'repeat', times: '3', until: 'it works', text: 'Backs off' })
  assert.deepEqual(groupOf(flow, 'pick'), { kind: 'branch' })
  assert.deepEqual(groupOf(flow, 'odd'), { kind: undefined })
  assert.deepEqual(groupOf(flow, 'none'), { kind: undefined })
  assert.equal(groupOf(flow, 'flat'), undefined)
})

test('groupOf finds nothing for a blank id, an undeclared one, a name Object has, or a flow without groups', () => {
  const flow = flowWith({ retry: { kind: 'repeat', times: '3' } })
  assert.equal(groupOf(flow, ''), undefined)
  assert.equal(groupOf(flow, 'missing'), undefined)
  assert.equal(groupOf(flow, 'constructor'), undefined)
  assert.equal(groupOf(flowWith(undefined), 'retry'), undefined)
  assert.equal(groupOf(flowWith(['retry']), 'retry'), undefined)
})

test('declaredGroups is the mapping the file has, or none', () => {
  const groups = { retry: { kind: 'repeat' } }
  assert.equal(declaredGroups(flowWith(groups)), groups)
  assert.deepEqual(declaredGroups(flowWith('retry')), {})
  assert.deepEqual(declaredGroups(flowWith(undefined)), {})
  assert.deepEqual(declaredGroups(undefined), {})
})

test('the kind table says which kinds have lanes and which options a kind takes', () => {
  assert.deepEqual(Object.keys(GROUP_INFO), ['repeat', 'branch', 'parallel'])
  assert.deepEqual(['repeat', 'branch', 'parallel', 'loop', undefined, 3].map(hasLanes), [false, true, true, false, false, false])
  assert.equal(takesOption('repeat', 'times'), true)
  assert.equal(takesOption('repeat', 'until'), true)
  assert.equal(takesOption('branch', 'times'), false)
  assert.equal(takesOption('parallel', 'until'), false)
  assert.equal(takesOption('loop', 'times'), false)
})

test('repeatWords says times then until, and a heading asks for a capital', () => {
  assert.equal(repeatWords({ times: '3', until: 'it works' }), 'up to 3 times, until it works')
  assert.equal(repeatWords({ times: '3', until: 'it works' }, true), 'Up to 3 times, until it works')
  assert.equal(repeatWords({ until: 'it works' }), 'until it works')
  assert.equal(repeatWords({ until: 'it works' }, true), 'Until it works')
  assert.equal(repeatWords({ times: '2' }), 'up to 2 times')
  assert.equal(repeatWords({}, true), '')
  assert.equal(repeatWords(undefined), '')
})

test('a step\'s group and lane are trimmed text, and "" for anything else', () => {
  assert.equal(stepGroupId(step('a', { group: ' try ' })), 'try')
  assert.equal(stepGroupId(step('a')), '')
  assert.equal(stepGroupId(undefined), '')
  assert.equal(stepLaneLabel(step('a', { lane: ' Paid ' })), 'Paid')
  assert.equal(stepLaneLabel({ ...step('a'), lane: 3 as unknown as string }), '')
  assert.equal(laneName(2), 'Lane 2')
})

test('leaveGroup hands the lane label to the next step and drops a group that is left empty', () => {
  const flow = flowWith({ both: { kind: 'parallel' } }, [step('a', { group: 'both', lane: 'Audit' }), step('b', { group: 'both' }), step('c')])
  const left = leaveGroup(flow, 0)
  assert.deepEqual(left.steps, [step('a'), step('b', { group: 'both', lane: 'Audit' }), step('c')])
  assert.deepEqual(left.groups, { both: { kind: 'parallel' } })
  const alone = leaveGroup(flowWith({ both: { kind: 'parallel' } }, [step('a', { group: 'both', lane: 'Audit' })]), 0)
  assert.deepEqual(alone.groups, {})
  assert.equal(leaveGroup(flow, 2).groups, flow.groups)
})

test('withGroups puts groups before the steps, replaces them where they are, and takes them out when none are left', () => {
  const plain = { name: 'Pays', view: 'shop', steps: [] } as Flow
  assert.deepEqual(Object.keys(withGroups(plain, { a: { kind: 'repeat' } })), ['name', 'view', 'groups', 'steps'])
  const grouped = withGroups(plain, { a: { kind: 'repeat' } })
  assert.deepEqual(withGroups(grouped, { b: { kind: 'branch' } }).groups, { b: { kind: 'branch' } })
  assert.equal('groups' in withGroups(grouped, {}), false)
  assert.equal('groups' in withGroups(plain, undefined), false)
})

test('joinGroup starts "Lane 1" in a group with lanes, takes over the label of a later first step, and gives a repeat no lane', () => {
  const alone = joinGroup([step('a'), step('b')], 0, 'both', 'parallel')
  assert.deepEqual(alone[0], step('a', { group: 'both', lane: 'Lane 1' }))
  const before = joinGroup([step('a'), step('b', { group: 'both', lane: 'Audit' })], 0, 'both', 'branch')
  assert.deepEqual(before, [step('a', { group: 'both', lane: 'Audit' }), step('b', { group: 'both' })])
  const repeat = joinGroup([step('a', { lane: 'Old' })], 0, 'try', 'repeat')
  assert.deepEqual(repeat, [step('a', { group: 'try' })])
})

test('changeKind keeps a repeat\'s options, gives it times 3 when it has none, and names the lanes of the new kind', () => {
  const flow = flowWith({ g: { kind: 'repeat', until: 'it works', text: 'Backs off' } }, [step('a', { group: 'g' }), step('b', { group: 'g' }), step('c', { group: 'g' })])
  const branch = changeKind(flow, 'g', 'branch')
  assert.deepEqual(branch.declared, { text: 'Backs off', kind: 'branch' })
  assert.deepEqual(branch.steps.map(stepLaneLabel), ['Lane 1', '', ''])
  const parallel = changeKind(flow, 'g', 'parallel')
  assert.deepEqual(parallel.steps.map(stepLaneLabel), ['Lane 1', 'Lane 2', 'Lane 3'])
  const again = changeKind(flowWith({ g: { kind: 'branch' } }, [step('a', { group: 'g', lane: 'X' })]), 'g', 'repeat')
  assert.deepEqual(again.declared, { kind: 'repeat', times: '3' })
  assert.deepEqual(again.steps, [step('a', { group: 'g' })])
  assert.deepEqual(changeKind(flow, 'g', 'repeat').declared, { text: 'Backs off', kind: 'repeat', until: 'it works' })
})

test('newGroup, groupRange and dropGroup', () => {
  assert.deepEqual(newGroup('repeat'), { kind: 'repeat', times: '3' })
  assert.deepEqual(newGroup('branch'), { kind: 'branch' })
  const steps = [step('a'), step('b'), step('c')]
  assert.deepEqual(groupRange(steps, 'g', 'branch', 1, 2), [step('a'), step('b', { group: 'g', lane: 'Lane 1' }), step('c', { group: 'g', lane: 'Lane 2' })])
  assert.deepEqual(groupRange(steps, 'g', 'repeat', 0, 1), [step('a', { group: 'g' }), step('b', { group: 'g' }), step('c')])
  assert.deepEqual(dropGroup(groupRange(steps, 'g', 'branch', 0, 2), 'g'), steps)
})
