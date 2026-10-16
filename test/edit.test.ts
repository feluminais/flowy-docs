import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { deleteFlow, placeBoxes, putObject } from '../src/core/ops.ts'
import { changesBetween, connectionsOf, locate, newId } from '../ui/src/edit.ts'
import { shop } from './fixtures.ts'

test('changesBetween gives each changed file as PUT takes it, and null for a deleted flow', () => {
  const before = { ...shop(), meta: { title: 'Demo' } }
  const renamed = putObject(before, { id: 'api', name: 'Backend' })
  assert.deepEqual(changesBetween(before, renamed), [
    { file: 'model.yaml', data: { title: 'Demo', objects: renamed.objects, connections: renamed.connections } },
  ])
  assert.deepEqual(changesBetween(before, deleteFlow(before, 'checkout')), [{ file: 'flows/checkout.yaml', data: null }])
  const moved = placeBoxes(before, 'root', { shop: [1, 2] })
  assert.deepEqual(changesBetween(before, moved), [{ file: 'layout.yaml', data: { root: { shop: [1, 2] } } }])
  assert.deepEqual(changesBetween(before, structuredClone(before)), [])
})

test('newId turns a name into a free id', () => {
  assert.equal(newId('Orders DB', [], 'store'), 'orders-db')
  assert.equal(newId('Orders DB', ['orders-db', 'orders-db-2'], 'store'), 'orders-db-3')
  assert.equal(newId('Visit', ['Visit'], 'flow'), 'visit-2')
  assert.equal(newId('  Café — Ünïcode!  ', [], 'app'), 'cafe-unicode')
  assert.equal(newId('Замовлення', [], 'app'), 'app')
  assert.equal(newId('Root', [], 'actor'), 'root-2')
})

test('connectionsOf lists what a merged line stands for', () => {
  assert.deepEqual(connectionsOf(shop(), 'shop', 'api', 'db').map(c => [c.index, c.connection.from]), [[2, 'orders'], [3, 'auth']])
  assert.deepEqual(connectionsOf(shop(), 'root', 'customer', 'shop').map(c => c.index), [0])
  assert.deepEqual(connectionsOf(shop(), 'root', 'shop', 'customer'), [])
})

test('locate finds the box, line or flow step a problem is about', () => {
  const m = shop()
  m.objects.floating = { type: 'app', name: 'F' }
  m.connections.push({ from: 'orders', to: 'ghost' }, { from: 'web', to: 'web' }, { from: 'orders', to: 'db', label: 'reads/writes' })
  m.flows.checkout.steps[1].text = ''
  m.flows.lost = { name: 'Lost', view: 'db', steps: [] }
  const spots = Object.fromEntries(check(m).map(p => [p.message, locate(m, p)]))
  assert.deepEqual(spots['floating: app must be inside system'], { view: 'root', object: 'floating' })
  assert.deepEqual(spots['connection orders → ghost: unknown object "ghost"'], { view: 'api', object: 'orders' })
  assert.deepEqual(spots['connection web → web: connects an object to itself'], { view: 'shop', object: 'web' })
  assert.deepEqual(spots['connection orders → db: duplicate "reads/writes"'], { view: 'api', line: ['orders', 'db'] })
  assert.deepEqual(spots['step 2: text is missing'], { view: 'shop', flow: 'checkout', step: 1 })
  assert.deepEqual(spots['has no steps'], { view: 'root', flow: 'lost', step: undefined })
})
