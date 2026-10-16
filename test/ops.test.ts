import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect, deleteFlow, deleteObject, disconnect, OpError, putFlow, putObject } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

test('putObject creates with fields in a stable order', () => {
  const m = putObject(shop(), { id: 'cache', type: 'store', name: 'Cache', in: 'shop', tech: 'Redis' })
  assert.deepEqual(m.objects.cache, { type: 'store', name: 'Cache', in: 'shop', tech: 'Redis' })
  assert.deepEqual(Object.keys(m.objects.cache), ['type', 'name', 'in', 'tech'])
})

test('putObject needs a valid id, and type and name to create', () => {
  assert.throws(() => putObject(shop(), { id: 'cache', name: 'Cache' }), OpError)
  assert.throws(() => putObject(shop(), { id: 'Cache!', type: 'store', name: 'Cache' }), OpError)
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
  putFlow(m, { id: 'x', name: 'X', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'hi' }] })
  assert.deepEqual(m, copy)
})

test('deleteObject refuses while it has children or a flow uses it', () => {
  assert.throws(() => deleteObject(shop(), 'shop'), /still contains web, api, db/)
  assert.throws(() => deleteObject(shop(), 'customer'), /used by flow checkout/)
  assert.throws(() => deleteObject(shop(), 'ghost'), OpError)
})

test('deleteObject removes the object and its connections', () => {
  const m = deleteObject(shop(), 'mail')
  assert.equal(m.objects.mail, undefined)
  assert.equal(m.connections.length, 4)
  assert.ok(!m.connections.some(c => c.to === 'mail'))
})

test('connect and disconnect', () => {
  const m = connect(shop(), { from: 'web', to: 'db', label: 'reads' })
  assert.deepEqual(m.connections.at(-1), { from: 'web', to: 'db', label: 'reads' })
  assert.deepEqual(connect(shop(), { from: 'web', to: 'db' }).connections.at(-1), { from: 'web', to: 'db' })
  assert.throws(() => connect(shop(), { from: 'web', to: 'ghost' }), OpError)
  const twice = connect(m, { from: 'web', to: 'db', label: 'writes' })
  const webToDb = (x: typeof m) => x.connections.filter(c => c.from === 'web' && c.to === 'db').length
  assert.equal(webToDb(disconnect(twice, { from: 'web', to: 'db', label: 'reads' })), 1)
  assert.equal(webToDb(disconnect(twice, { from: 'web', to: 'db' })), 0)
  assert.throws(() => disconnect(shop(), { from: 'db', to: 'web' }), OpError)
})

test('putFlow and deleteFlow', () => {
  const steps = [{ from: 'customer', to: 'shop', text: 'Visits' }]
  const m = putFlow(shop(), { id: 'visit', name: 'Visit', view: 'root', steps })
  assert.deepEqual(m.flows.visit, { name: 'Visit', view: 'root', steps })
  assert.equal(deleteFlow(m, 'visit').flows.visit, undefined)
  assert.throws(() => deleteFlow(shop(), 'nope'), OpError)
  assert.throws(() => putFlow(shop(), { id: 'Bad', name: 'B', view: 'root', steps }), OpError)
})
