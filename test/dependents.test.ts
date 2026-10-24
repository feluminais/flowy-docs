import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dependents, describeDependent, needsDecision } from '../src/core/dependents.ts'
import { deleteWith, OpError, removeStep } from '../src/core/ops.ts'
import type { Resolution } from '../src/core/ops.ts'
import { check } from '../src/core/check.ts'
import { shopWithFailures } from './fixtures.ts'
import type { Model } from '../src/core/model.ts'

const keys = (rows: { key: string }[]) => rows.map(r => r.key)
const refused = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (e: unknown) => e instanceof OpError && pattern.test(e.message), String(pattern))

/** The shop with a second flow, a mode that names a step, and the states that name a shape. */
function busy(): Model {
  const m = shopWithFailures()
  m.flows.pay = { name: 'Pay', view: 'shop', states: { db: 'stopped' }, steps: [{ from: 'web', to: 'api', text: 'Asks' }, { from: 'api', to: 'db', text: 'Charges' }, { from: 'api', to: 'web', text: 'Answers', states: { db: 'running' } }] }
  m.failures.ordering.modes['api-slow'].flow = 'pay'
  m.failures.ordering.modes['api-slow'].step = '3'
  m.failures.ordering.modes['db-down'].affects = ['web', 'db']
  return m
}

test('dependents: a shape in a flow, a mode and lines gives a row for each, the decisions first', () => {
  const rows = dependents(busy(), [{ object: 'db' }])
  assert.deepEqual(keys(rows), ['step:checkout:3', 'step:pay:2', 'mode:ordering:db-down:on', 'stepState:pay:3', 'start:pay', 'line:2', 'line:3', 'affects:ordering:db-down'])
  assert.deepEqual(rows.map(needsDecision), [true, true, true, false, false, false, false, false])
  assert.deepEqual(rows[0], { key: 'step:checkout:3', kind: 'step', of: 'db', flow: 'checkout', step: 3, ends: ['to'], actions: ['removeStep', 'reroute', 'deleteFlow'] })
  assert.deepEqual(rows[2].actions, ['removeMode', 'repoint'])
  assert.deepEqual(rows.find(r => r.key === 'line:2')!.line, { from: 'orders', to: 'db', label: 'reads/writes' })
})

test('dependents: a shape with shapes inside it, a flow view and a scope', () => {
  const rows = dependents(busy(), [{ object: 'shop' }])
  assert.deepEqual(keys(rows).filter(k => !k.startsWith('line:')), ['view:checkout', 'view:pay', 'scope:ordering', 'child:web', 'child:api', 'child:db'])
  assert.deepEqual(rows.find(r => r.key === 'view:pay')!.actions, ['changeView', 'deleteFlow'])
  assert.deepEqual(rows.find(r => r.key === 'child:api')!.actions, ['deleteWith', 'moveOut'])
})

test('dependents: shapes deleted together do not depend on each other', () => {
  const m = busy()
  const alone = dependents(m, [{ object: 'shop' }])
  const together = dependents(m, [{ object: 'shop' }, { object: 'web' }, { object: 'api' }, { object: 'db' }, { object: 'auth' }, { object: 'orders' }])
  assert.equal(alone.filter(r => r.kind === 'child').length, 3)
  assert.equal(together.filter(r => r.kind === 'child').length, 0)
  const both = dependents(m, [{ object: 'customer' }, { object: 'web' }]).find(r => r.key === 'step:checkout:1')!
  assert.deepEqual(both.ends, ['from', 'to'])
})

test('dependents: when every step of a flow is a row, the rows say so and offer the flow first', () => {
  const m = busy()
  m.flows.pay.steps = [{ from: 'web', to: 'api', text: 'Asks' }, { from: 'api', to: 'web', text: 'Answers' }]
  const rows = dependents(m, [{ object: 'api' }]).filter(r => r.flow === 'pay')
  assert.deepEqual(rows.map(r => r.emptiesFlow), [true, true])
  assert.deepEqual(rows[0].actions, ['deleteFlow', 'reroute', 'removeStep'])
  assert.equal(dependents(m, [{ object: 'api' }]).find(r => r.key === 'step:checkout:2')!.emptiesFlow, undefined)
})

test('dependents: a line a mode needs is a row only when no other from → to line is left', () => {
  const m = busy()
  const line = { from: 'orders', to: 'mail', label: 'sends receipts' }
  const rows = dependents(m, [{ line }])
  assert.deepEqual(rows, [{ key: 'mode:ordering:mail-timeout:line', kind: 'mode', of: 'orders>mail', analysis: 'ordering', mode: 'mail-timeout', part: 'line', actions: ['removeMode'] }])
  m.connections.push({ from: 'orders', to: 'mail', label: 'second' })
  assert.deepEqual(dependents(m, [{ line }]), [])
  assert.equal(dependents(m, [{ line: { ...line, label: undefined, all: true } }]).length, 1)
  assert.deepEqual(dependents(m, [{ line: { from: 'web', to: 'api' } }]), [])
})

test('describeDependent says where a row is', () => {
  const rows = dependents(busy(), [{ object: 'db' }])
  assert.deepEqual(rows.map(describeDependent).slice(0, 3), ['flow checkout, step 3', 'flow pay, step 2', 'mode db-down of ordering'])
})

test('deleteWith: with nothing to decide it takes the lines, states and affects entries along', () => {
  const m = busy()
  m.flows.pay.steps = m.flows.pay.steps.filter(s => s.to !== 'db')
  m.flows.checkout.steps = m.flows.checkout.steps.slice(0, 2)
  delete m.failures.ordering.modes['db-down']
  const next = deleteWith(m, [{ object: 'db' }], [])
  assert.equal(next.objects.db, undefined)
  assert.equal(next.connections.some(c => c.from === 'db' || c.to === 'db'), false)
  assert.equal('states' in next.flows.pay, false)
  assert.equal('states' in next.flows.pay.steps[1], false)
})

test('deleteWith: refuses a row nobody settled, a choice that does not fit and one that points at what goes', () => {
  const m = busy()
  refused(() => deleteWith(m, [{ object: 'db' }], []), /flow checkout, step 3 needs a choice: removeStep, reroute, deleteFlow/)
  const all: Resolution[] = [
    { key: 'step:checkout:3', action: 'removeStep' }, { key: 'step:pay:2', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'removeMode' },
  ]
  assert.ok(deleteWith(m, [{ object: 'db' }], all))
  refused(() => deleteWith(m, [{ object: 'db' }], [...all.slice(0, 2), { key: 'mode:ordering:db-down:on', action: 'changeView' }]), /changeView is not one of the choices for mode db-down of ordering/)
  refused(() => deleteWith(m, [{ object: 'db' }], [...all.slice(0, 2), { key: 'mode:ordering:db-down:on', action: 'repoint', to: 'db' }]), /repoint for mode db-down of ordering needs "to"/)
  refused(() => deleteWith(m, [{ object: 'db' }], [...all, { key: 'step:pay:9', action: 'removeStep' }]), /nothing is waiting on "step:pay:9"/)
  refused(() => deleteWith(m, [{ object: 'db' }], [...all, all[0]]), /"step:checkout:3" is settled twice/)
  refused(() => deleteWith(m, [{ object: 'nope' }], []), /unknown object "nope"/)
})

test('deleteWith: removing a step moves the modes on later steps up, and a mode on the removed step keeps its flow only', () => {
  const m = busy()
  m.failures.ordering.modes['db-down'].flow = 'pay'
  m.failures.ordering.modes['db-down'].step = '2'
  const next = deleteWith(m, [{ object: 'db' }], [
    { key: 'step:checkout:3', action: 'removeStep' }, { key: 'step:pay:2', action: 'removeStep' }, { key: 'mode:ordering:db-down:on', action: 'repoint', to: 'api' },
  ])
  assert.deepEqual(next.flows.pay.steps.map(s => s.text), ['Asks', 'Answers'])
  assert.equal(next.failures.ordering.modes['db-down'].on, 'api')
  assert.deepEqual(next.failures.ordering.modes['db-down'].affects, ['web'])
  assert.equal('step' in next.failures.ordering.modes['db-down'], false)
  assert.equal(next.failures.ordering.modes['db-down'].flow, 'pay')
  assert.equal(next.failures.ordering.modes['api-slow'].step, '2')
  assert.deepEqual(check(next).filter(p => p.file.startsWith('flows/')), [])
})

test('removeStep alone keeps the modes that name a step of the flow right', () => {
  const next = removeStep(busy(), 'pay', 0)
  assert.equal(next.failures.ordering.modes['api-slow'].step, '2')
  assert.equal(removeStep(busy(), 'pay', 2).failures.ordering.modes['api-slow'].step, undefined)
  assert.equal(removeStep(busy(), 'checkout', 0).failures.ordering.modes['api-slow'].step, '3')
})

test('deleteWith: reroute moves the ends that named the shape, and a view moves to a new view', () => {
  const next = deleteWith(busy(), [{ object: 'web' }, { object: 'db' }], [
    { key: 'step:checkout:1', action: 'reroute', to: 'api' }, { key: 'step:checkout:2', action: 'reroute', to: 'customer' }, { key: 'step:checkout:3', action: 'removeStep' },
    { key: 'step:pay:1', action: 'removeStep' }, { key: 'step:pay:2', action: 'removeStep' }, { key: 'step:pay:3', action: 'reroute', to: 'customer' },
    { key: 'mode:ordering:db-down:on', action: 'removeMode' }, { key: 'mode:ordering:web-glitch:on', action: 'removeMode' },
  ])
  assert.deepEqual(next.flows.checkout.steps.map(s => [s.from, s.to]), [['customer', 'api'], ['customer', 'api']])
  assert.deepEqual(next.flows.pay.steps.map(s => [s.from, s.to]), [['api', 'customer']])
  const moved = deleteWith(busy(), [{ object: 'shop' }], [
    { key: 'view:checkout', action: 'changeView', to: 'root' }, { key: 'view:pay', action: 'deleteFlow' }, { key: 'scope:ordering', action: 'changeScope' },
    { key: 'child:web', action: 'moveOut' }, { key: 'child:api', action: 'moveOut', to: 'customer' }, { key: 'child:db', action: 'moveOut' },
  ])
  assert.equal(moved.flows.checkout.view, 'root')
  assert.equal(moved.failures.ordering.scope, undefined)
  assert.equal(moved.objects.web.in, undefined)
  assert.equal(moved.objects.api.in, 'customer')
})

test('deleteWith: a shape moved out of shapes that sit inside each other goes to the top instead of looking for a parent forever', () => {
  const m: Model = { objects: { a: { type: 'system', name: 'A', in: 'b' }, b: { type: 'system', name: 'B', in: 'a' }, c: { type: 'app', name: 'C', in: 'a' } }, connections: [], flows: {}, failures: {} } as unknown as Model
  const next = deleteWith(m, [{ object: 'a' }], [{ key: 'child:b', action: 'deleteWith' }, { key: 'child:c', action: 'moveOut' }])
  assert.deepEqual(Object.keys(next.objects), ['c'])
  assert.equal(next.objects.c.in, undefined)
})

test('deleteWith: a deleted flow takes the flow and step off the modes that named it, and its other rows need nothing', () => {
  const m = busy()
  const next = deleteWith(m, [{ object: 'db' }], [
    { key: 'step:checkout:3', action: 'removeStep' }, { key: 'step:pay:2', action: 'deleteFlow' }, { key: 'mode:ordering:db-down:on', action: 'removeMode' },
  ])
  assert.equal(next.flows.pay, undefined)
  assert.equal('flow' in next.failures.ordering.modes['api-slow'], false)
  assert.equal('step' in next.failures.ordering.modes['api-slow'], false)
  assert.deepEqual(next.flows.checkout.steps.length, 2)
})

test('deleteWith: refuses to remove every step of a flow', () => {
  const m = busy()
  m.flows.pay.steps = [{ from: 'web', to: 'api', text: 'Asks' }, { from: 'api', to: 'web', text: 'Answers' }]
  const rows: Resolution[] = [
    { key: 'step:pay:1', action: 'removeStep' }, { key: 'step:pay:2', action: 'removeStep' }, { key: 'step:checkout:1', action: 'removeStep' }, { key: 'step:checkout:2', action: 'removeStep' },
    { key: 'mode:ordering:web-glitch:on', action: 'removeMode' },
  ]
  refused(() => deleteWith(m, [{ object: 'web' }], rows), /leave flow pay with no steps/)
  assert.ok(deleteWith(m, [{ object: 'web' }], [{ ...rows[0], action: 'deleteFlow' }, ...rows.slice(2)]))
})

test('deleteWith: a child chosen to go with its parent brings its own rows', () => {
  const m = busy()
  const rows = (resolutions: Resolution[]) => () => deleteWith(m, [{ object: 'api' }], resolutions)
  refused(rows([]), /needs a choice/)
  const next = deleteWith(m, [{ object: 'api' }], [
    { key: 'child:auth', action: 'deleteWith' }, { key: 'child:orders', action: 'deleteWith' },
    { key: 'step:checkout:2', action: 'removeStep' }, { key: 'step:checkout:3', action: 'removeStep' }, { key: 'step:pay:1', action: 'deleteFlow' },
    { key: 'mode:ordering:api-slow:on', action: 'removeMode' }, { key: 'mode:ordering:auth-lock:on', action: 'removeMode' },
    { key: 'mode:ordering:mail-timeout:from', action: 'removeMode' }, { key: 'mode:ordering:orders-unrated:on', action: 'removeMode' },
  ])
  assert.equal(next.objects.auth, undefined)
  assert.equal(next.objects.orders, undefined)
  assert.equal(next.objects.api, undefined)
})

test('deleteWith: a line is cut on its own and a mode on it is settled', () => {
  const m = busy()
  const line = { from: 'orders', to: 'mail', label: 'sends receipts' }
  refused(() => deleteWith(m, [{ line }], []), /mode mail-timeout of ordering needs a choice: removeMode/)
  const next = deleteWith(m, [{ line }], [{ key: 'mode:ordering:mail-timeout:line', action: 'removeMode' }])
  assert.equal(next.connections.length, m.connections.length - 1)
  assert.equal('mail-timeout' in next.failures.ordering.modes, false)
})
