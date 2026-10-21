import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, newProblems } from '../src/core/check.ts'
import { describeEdit } from '../src/core/editlabel.ts'
import { deleteObject, OpError, putFlow, refuseNewProblems, setStepStates } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

const refused = (re: RegExp) => (e: unknown) => e instanceof OpError && re.test(e.message)

test('ops: setStepStates sets, replaces, clears, and refuses an unknown state', () => {
  const m = shop()
  const set = setStepStates(m, 'checkout', 1, { api: 'stopped' })
  assert.deepEqual(set.flows.checkout.steps[1], { from: 'web', to: 'api', text: 'POST /orders', states: { api: 'stopped' } })
  assert.equal(m.flows.checkout.steps[1].states, undefined) // the model it was given is untouched

  const replaced = setStepStates(set, 'checkout', 1, { db: 'degraded', web: 'starting' })
  assert.deepEqual(replaced.flows.checkout.steps[1].states, { db: 'degraded', web: 'starting' })
  assert.deepEqual(Object.keys(replaced.flows.checkout.steps[1]), ['from', 'to', 'text', 'states'])

  const cleared = setStepStates(replaced, 'checkout', 1, {})
  assert.deepEqual(cleared.flows.checkout.steps[1], { from: 'web', to: 'api', text: 'POST /orders' })

  assert.throws(() => setStepStates(m, 'checkout', 1, { api: 'asleep' }), refused(/^states: unknown state "asleep" for "api" \(use running, starting, stopping, stopped, restarting, degraded\)$/))
  assert.throws(() => setStepStates(m, 'checkout', 1, { ghost: 'stopped' }), refused(/^states: unknown shape "ghost"$/))
  assert.throws(() => setStepStates(m, 'checkout', 1, { ['__proto__']: 'stopped' }), refused(/unknown shape "__proto__"/))
  assert.throws(() => setStepStates(m, 'checkout', 9, { api: 'stopped' }), refused(/has no step 10/))
  assert.throws(() => setStepStates(m, 'nope', 0, { api: 'stopped' }), refused(/unknown flow "nope"/))
})

test('ops: setStepStates keeps every other key of the step, and puts a new states after the animation', () => {
  const m = putFlow(shop(), {
    id: 'pays', name: 'Pays', view: 'shop',
    steps: [{ from: 'web', to: 'api', text: 'Pays', description: 'More.', animation: 'call', group: 'g', lane: 'A', flow: 'checkout', owner: 'payments' }],
    groups: { g: { kind: 'branch' } },
  })
  const next = setStepStates(m, 'pays', 0, { api: 'stopped' })
  assert.deepEqual(Object.keys(next.flows.pays.steps[0]), ['from', 'to', 'text', 'description', 'animation', 'states', 'group', 'lane', 'flow', 'owner'])
  assert.deepEqual(next.flows.pays.groups, m.flows.pays.groups)
})

test('ops: putFlow writes states after the view, and an empty states or a blank description nowhere', () => {
  const m = putFlow(shop(), {
    id: 'outage', name: 'Outage', view: 'shop', states: { db: 'stopped' },
    steps: [{ from: 'web', to: 'api', text: 'Asks', description: ' ', states: {} }, { from: 'web', to: 'api', text: 'Asks again', states: { db: 'running' } }],
  })
  assert.deepEqual(Object.keys(m.flows.outage), ['name', 'view', 'states', 'steps'])
  assert.deepEqual(m.flows.outage.steps, [{ from: 'web', to: 'api', text: 'Asks' }, { from: 'web', to: 'api', text: 'Asks again', states: { db: 'running' } }])
  assert.deepEqual(Object.keys(putFlow(shop(), { id: 'plain', name: 'Plain', view: 'shop', states: {}, steps: [] }).flows.plain), ['name', 'view', 'steps'])
})

test('ops: deleteObject refuses a shape only a flow\'s states names', () => {
  const m = shop()
  m.objects.cache = { type: 'component', in: 'api', name: 'Cache' }
  m.flows.checkout.states = { cache: 'stopped' }
  assert.throws(() => deleteObject(m, 'cache'), refused(/^"cache" is used by flow checkout\. Change or delete those first\.$/))

  const onStep = shop()
  onStep.objects.cache = { type: 'component', in: 'api', name: 'Cache' }
  onStep.flows.checkout.steps[2].states = { cache: 'degraded' }
  assert.throws(() => deleteObject(onStep, 'cache'), refused(/used by flow checkout/))

  // A list or a text there names nothing, and a shape the states leave alone still goes.
  const odd = shop()
  odd.objects.cache = { type: 'component', in: 'api', name: 'Cache' }
  odd.flows.checkout.states = ['cache']
  odd.flows.checkout.steps[0].states = 'cache'
  assert.equal(deleteObject(odd, 'cache').objects.cache, undefined)
})

test('check: flow states and step states problems are worded with "step N: " for steps', () => {
  const m = shop()
  m.flows.checkout.states = { ghost: 'stopped', db: 'asleep' }
  m.flows.checkout.steps[1].states = { api: 'Stopped' }
  m.flows.checkout.steps[2].states = ['db']
  const messages = check(m).map(p => `${p.file} ${p.message}`)
  assert.deepEqual(messages, [
    'flows/checkout.yaml states: unknown shape "ghost"',
    'flows/checkout.yaml states: unknown state "asleep" for "db" (use running, starting, stopping, stopped, restarting, degraded)',
    'flows/checkout.yaml step 2: states: unknown state "Stopped" for "api" (use running, starting, stopping, stopped, restarting, degraded)',
    'flows/checkout.yaml step 3: states must map shape ids to states',
  ])
  assert.deepEqual(check(m).map(p => p.step), [undefined, undefined, 1, 2])
})

test('check: two lanes of a parallel stop that disagree are one problem on the later step, and the same state twice is none', () => {
  const lanes = (a: string, b: string) => {
    const m = shop()
    m.flows.checkout = {
      name: 'C', view: 'shop', groups: { p: { kind: 'parallel' } },
      steps: [
        { from: 'web', to: 'api', text: 'A', group: 'p', lane: 'a', states: { db: a } },
        { from: 'web', to: 'api', text: 'B', group: 'p', lane: 'b', states: { db: b } },
      ],
    }
    return check(m).map(p => p.message)
  }
  assert.deepEqual(lanes('stopped', 'stopped'), [])
  assert.deepEqual(lanes('stopped', 'degraded'), ['step 2: shape "db" is set to both stopped and degraded in one stop'])
})

test('check: a refused edit names the states problem it would add', () => {
  const before = shop()
  const after = structuredClone(before)
  after.flows.checkout.steps[0].states = { web: 'asleep' }
  assert.equal(newProblems(check(before), check(after)).length, 1)
  assert.throws(() => refuseNewProblems(before, after), refused(/step 1: states: unknown state "asleep" for "web"/))
})

test('editlabel: setting one step\'s state reads "Set Web app to Stopped"', () => {
  const before = shop()
  const after = setStepStates(before, 'checkout', 0, { web: 'stopped' })
  assert.equal(describeEdit(before, after), 'Set Web app to Stopped')
  assert.equal(describeEdit(after, setStepStates(after, 'checkout', 0, {})), "Cleared Web app's state")
  assert.equal(describeEdit(after, setStepStates(after, 'checkout', 0, { web: 'running' })), 'Set Web app to Running')
  // More than one at once, or a change to a step's text as well, is just a changed flow.
  assert.equal(describeEdit(before, setStepStates(before, 'checkout', 0, { web: 'stopped', api: 'degraded' })), 'Changed the Customer checks out flow')
  const both = setStepStates(before, 'checkout', 0, { web: 'stopped' })
  both.flows.checkout.steps[0].text = 'Taps'
  assert.equal(describeEdit(before, both), 'Changed the Customer checks out flow')
})
