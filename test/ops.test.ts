import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect, deleteFlow, deleteObject, disconnect, OpError, putFlow, putObject } from '../src/core/ops.ts'
import type { ObjectInput } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

test('putObject creates with fields in a stable order, whatever order they come in', () => {
  const m = putObject(shop(), { tech: 'Redis', in: 'shop', name: 'Cache', type: 'store', id: 'cache' })
  assert.deepEqual(m.objects.cache, { type: 'store', name: 'Cache', in: 'shop', tech: 'Redis' })
  assert.deepEqual(Object.keys(m.objects.cache), ['type', 'name', 'in', 'tech'])
})

test('putObject ignores keys it does not know', () => {
  const input = JSON.parse('{"id":"cache","type":"store","name":"Cache","in":"shop","color":"red","__proto__":{"polluted":"yes"}}')
  const cache = putObject(shop(), input as ObjectInput).objects.cache
  assert.deepEqual(Object.keys(cache), ['type', 'name', 'in'])
  assert.equal(Object.getPrototypeOf(cache), Object.prototype)
})

test('putObject needs a valid id, and type and name to create', () => {
  assert.throws(() => putObject(shop(), { id: 'cache', name: 'Cache' }), /type and name are required/)
  assert.throws(() => putObject(shop(), { id: 'Cache!', type: 'store', name: 'Cache' }), /not a valid id/)
  assert.throws(() => putObject(shop(), { id: 'root', type: 'actor', name: 'R' }), /"root" is reserved/)
})

test('putObject updates only what is given, and "" removes a field', () => {
  const base = shop()
  base.objects.api.owner = 'team-a'
  const m = putObject(base, { id: 'api', tech: '', description: 'Handles orders.' })
  assert.deepEqual(m.objects.api, { type: 'app', in: 'shop', name: 'API', owner: 'team-a', description: 'Handles orders.' })
  assert.equal(putObject(m, { id: 'api', in: '' }).objects.api.in, undefined)
})

test('ops never change the model they are given', () => {
  const m = shop()
  const copy = structuredClone(m)
  putObject(m, { id: 'api', name: 'Renamed' })
  deleteObject(m, 'mail')
  connect(m, { from: 'web', to: 'db' })
  disconnect(m, { from: 'web', to: 'api' })
  putFlow(m, { id: 'x', name: 'X', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'hi' }] })
  deleteFlow(m, 'checkout')
  assert.deepEqual(m, copy)
})

test('ids like "constructor" are ordinary ids, never Object.prototype', () => {
  assert.throws(() => deleteObject(shop(), 'constructor'), /unknown object "constructor"/)
  assert.throws(() => deleteFlow(shop(), 'constructor'), /unknown flow "constructor"/)
  assert.throws(() => connect(shop(), { from: 'constructor', to: 'web' }), /unknown object "constructor"/)
  const m = putObject(shop(), { id: 'constructor', type: 'actor', name: 'C' })
  assert.ok(Object.hasOwn(m.objects, 'constructor'))
  assert.equal(deleteObject(m, 'constructor').objects.constructor, Object.prototype.constructor)
})

test('deleteObject refuses while it has children or a flow uses it', () => {
  assert.throws(() => deleteObject(shop(), 'shop'), /still contains web, api, db/)
  assert.throws(() => deleteObject(shop(), 'customer'), /used by flow checkout/)
  assert.throws(() => deleteObject(shop(), 'db'), /used by flow checkout/)
  const m = shop()
  m.flows.tour = { name: 'Tour', view: 'mail', steps: [] }
  m.flows.visit = { name: 'Visit', view: 'root', steps: [{ from: 'customer', to: 'mail', text: 'Gets mail' }] }
  assert.throws(() => deleteObject(m, 'mail'), /used by flows tour, visit/)
  assert.throws(() => deleteObject(shop(), 'ghost'), /unknown object "ghost"/)
})

test('deleteObject removes the object and every connection touching it', () => {
  const m = deleteObject(shop(), 'mail')
  assert.equal(m.objects.mail, undefined)
  assert.equal(m.connections.length, 4)
  const n = deleteObject(shop(), 'orders')
  assert.deepEqual(n.connections.map(c => `${c.from}>${c.to}`), ['customer>web', 'web>api', 'auth>db'])
})

test('connect checks both ends, and an empty label means no label', () => {
  const m = connect(shop(), { from: 'web', to: 'db', label: 'reads' })
  assert.deepEqual(m.connections.at(-1), { from: 'web', to: 'db', label: 'reads' })
  assert.deepEqual(connect(shop(), { from: 'web', to: 'db', label: '' }).connections.at(-1), { from: 'web', to: 'db' })
  assert.throws(() => connect(shop(), { from: 'web', to: 'ghost' }), /unknown object "ghost"/)
  assert.throws(() => connect(shop(), { from: 'ghost', to: 'web' }), /unknown object "ghost"/)
})

test('disconnect matches direction, both ends and the label', () => {
  const m = connect(connect(shop(), { from: 'web', to: 'db', label: 'reads' }), { from: 'web', to: 'db' })
  const webToDb = (x: typeof m) => x.connections.filter(c => c.from === 'web' && c.to === 'db')
  assert.deepEqual(webToDb(disconnect(m, { from: 'web', to: 'db', label: 'reads' })), [{ from: 'web', to: 'db' }])
  assert.deepEqual(webToDb(disconnect(m, { from: 'web', to: 'db', label: '' })), [{ from: 'web', to: 'db', label: 'reads' }])
  assert.deepEqual(webToDb(disconnect(m, { from: 'web', to: 'db' })), [])
  assert.throws(() => disconnect(m, { from: 'db', to: 'web' }), /no connection db → web/)
  assert.throws(() => disconnect(m, { from: 'web', to: 'mail' }), /no connection web → mail/)
  assert.throws(() => disconnect(m, { from: 'web', to: 'db', label: 'writes' }), /there is "reads", one without a label/)
})

test('putFlow creates or replaces whole, and deleteFlow removes', () => {
  const steps = [{ from: 'customer', to: 'shop', text: 'Visits' }]
  const m = putFlow(shop(), { id: 'visit', name: 'Visit', view: 'root', steps })
  assert.deepEqual(m.flows.visit, { name: 'Visit', view: 'root', steps })
  assert.notEqual(m.flows.visit.steps, steps)
  const base = shop()
  base.flows.checkout.owner = 'team-a'
  assert.deepEqual(putFlow(base, { id: 'checkout', name: 'New', view: 'root', steps }).flows.checkout, { name: 'New', view: 'root', steps })
  assert.equal(deleteFlow(m, 'visit').flows.visit, undefined)
  assert.throws(() => deleteFlow(shop(), 'nope'), /unknown flow "nope"/)
  assert.throws(() => putFlow(shop(), { id: 'Bad', name: 'B', view: 'root', steps }), /not a valid flow id/)
})

test('refusals are OpErrors', () => {
  assert.throws(() => deleteObject(shop(), 'ghost'), (e: unknown) => e instanceof OpError && e.name === 'OpError')
})
