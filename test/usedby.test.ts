import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteWith } from '../src/core/ops.ts'
import { check } from '../src/core/check.ts'
import type { Model } from '../src/core/model.ts'
import { alongText, defaultChoice, doneText, planOf, removeAll, rerouteAll, resolutionsOf, rowText, shapesLeft } from '../ui/src/usedby.ts'
import { shopWithFailures } from './fixtures.ts'

function busy(): Model {
  const m = shopWithFailures()
  m.flows.pay = { name: 'Pay', view: 'shop', states: { db: 'stopped' }, steps: [{ from: 'web', to: 'api', text: 'Asks' }, { from: 'api', to: 'db', text: 'Charges' }] }
  m.failures.ordering.modes['api-slow'].flow = 'pay'
  m.failures.ordering.modes['api-slow'].step = '2'
  return m
}
const db = [{ object: 'db' }]

test('a plan lists what needs a decision, what is still open, and what goes along', () => {
  const plan = planOf(busy(), db, {})
  assert.deepEqual(plan.asks.map(r => r.key), ['step:checkout:3', 'step:pay:2', 'mode:ordering:db-down:on'])
  assert.equal(plan.open.length, 3)
  assert.deepEqual(plan.along.map(r => r.kind), ['stepState', 'start', 'line', 'line'].filter(k => plan.along.some(r => r.kind === k)).length ? plan.along.map(r => r.kind) : [])
  assert.ok(plan.along.length > 0)
})

test('a row is settled by one of its actions, and a reroute is not settled until it has a shape', () => {
  const m = busy()
  const half = planOf(m, db, { 'step:checkout:3': { action: 'reroute' }, 'step:pay:2': { action: 'removeStep' }, 'mode:ordering:db-down:on': { action: 'changeView' } })
  assert.deepEqual(half.open.map(r => r.key), ['step:checkout:3', 'mode:ordering:db-down:on'])
  const full = planOf(m, db, { 'step:checkout:3': { action: 'reroute', to: 'web' }, 'step:pay:2': { action: 'removeStep' }, 'mode:ordering:db-down:on': { action: 'repoint', to: 'web' } })
  assert.equal(full.open.length, 0)
})

test('the rows of a flow that is going need nothing more', () => {
  const plan = planOf(busy(), db, { 'step:pay:2': { action: 'deleteFlow' } })
  assert.deepEqual(plan.asks.map(r => r.key), ['step:checkout:3', 'mode:ordering:db-down:on'])
  assert.deepEqual([...plan.flows], ['pay'])
})

test('remove all settles every open row, and leaves what was chosen alone', () => {
  const m = busy()
  const choices = removeAll(m, db, { 'step:checkout:3': { action: 'reroute', to: 'web' } })
  assert.deepEqual(choices['step:checkout:3'], { action: 'reroute', to: 'web' })
  assert.deepEqual(choices['mode:ordering:db-down:on'], { action: 'removeMode' })
  assert.equal(planOf(m, db, choices).open.length, 0)
  const next = deleteWith(m, db, resolutionsOf(planOf(m, db, choices), choices))
  assert.equal(next.objects.db, undefined)
  assert.deepEqual(check(next).filter(p => p.file.startsWith('flows/')), [])
})

test('remove all takes the flow when its steps are all of it, and brings the rows of shapes inside along', () => {
  const m = busy()
  m.flows.pay.steps = [{ from: 'web', to: 'api', text: 'Asks' }, { from: 'api', to: 'web', text: 'Answers' }]
  const choices = removeAll(m, [{ object: 'api' }], {})
  assert.equal(choices['step:pay:1'].action, 'deleteFlow')
  assert.equal(choices['child:auth'].action, 'deleteWith')
  assert.equal(planOf(m, [{ object: 'api' }], choices).open.length, 0)
  const plan = planOf(m, [{ object: 'api' }], choices)
  const next = deleteWith(m, [{ object: 'api' }], resolutionsOf(plan, choices))
  assert.equal(next.objects.auth, undefined)
  assert.equal(next.flows.pay, undefined)
})

test('reroute all moves steps and mode parts to one shape and leaves rows that cannot move', () => {
  const m = busy()
  const choices = rerouteAll(m, [{ object: 'shop' }], {}, 'customer')
  assert.deepEqual(planOf(m, [{ object: 'shop' }], choices).open.map(r => r.kind), ['view', 'view', 'scope', 'child', 'child', 'child'])
  const web = rerouteAll(m, [{ object: 'web' }], {}, 'api')
  assert.equal(web['step:checkout:1'].action, 'reroute')
  assert.equal(web['mode:ordering:web-glitch:on'].action, 'repoint')
})

test('only shapes that stay can be picked to take over', () => {
  const m = busy()
  const left = shapesLeft(m, planOf(m, [{ object: 'db' }, { object: 'mail' }], {}))
  assert.equal(left.includes('db'), false)
  assert.equal(left.includes('mail'), false)
  assert.equal(left.includes('api'), true)
})

test('a row says where it is in the words of the flow or the analysis', () => {
  const m = busy()
  const rows = planOf(m, db, {}).asks
  assert.deepEqual(rowText(m, rows[0]), { title: 'Customer checks out', where: 'Step 3: API → Orders DB', shapes: ['api', 'db'] })
  assert.deepEqual(rowText(m, rows[2]), { title: 'Ordering', where: 'The database is unreachable: On', shapes: ['db'] })
})

test('the notice says what went, what was done, and what went along', () => {
  const m = busy()
  const choices = removeAll(m, db, {})
  const plan = planOf(m, db, choices)
  assert.equal(doneText(m, plan, choices, db), 'Deleted Orders DB. 2 steps removed, 1 mode removed. Went with it: 2 lines, 1 state.')
  assert.equal(alongText([]), '')
  const none = planOf(shopWithFailures(), [{ object: 'customer' }], {})
  assert.equal(doneText(shopWithFailures(), none, {}, [{ object: 'customer' }]).startsWith('Deleted Customer.'), true)
  assert.equal(defaultChoice(plan.asks[0]).action, 'removeStep')
})
