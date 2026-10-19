import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  connect, deleteFlow, deleteObject, disconnect, forgetLayout, OpError, placeBoxes, putFlow, putObject, refuseNewProblems,
  relabel, removeConnection, setLines, updateFlow,
} from '../src/core/ops.ts'
import type { ObjectInput } from '../src/core/ops.ts'
import { lineStyle } from '../src/core/model.ts'
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
  relabel(m, { from: 'web', to: 'api', label: 'REST' }, 'HTTPS')
  removeConnection(m, { from: 'web', to: 'api', label: 'REST' })
  updateFlow(m, 'checkout', { steps: [] })
  placeBoxes(m, 'root', { shop: [1, 2] })
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

test('files that only a person can fix get a clear refusal', () => {
  const m = shop()
  m.flows.Visit = { name: 'V', view: 'root', steps: [] }
  assert.throws(() => deleteFlow(m, 'Visit'), /flows\/Visit\.yaml has an invalid file name/)
  const steps = [{ from: 'customer', to: 'shop', text: 'Visits' }]
  assert.throws(() => putFlow(m, { id: 'visit', name: 'V', view: 'root', steps }), /flows\/Visit\.yaml already exists and differs only in case/)
  m.objects.root = { type: 'actor', name: 'R' }
  assert.throws(() => deleteObject(m, 'root'), /"root" is reserved/)
})

test('refusals are OpErrors', () => {
  assert.throws(() => deleteObject(shop(), 'ghost'), (e: unknown) => e instanceof OpError && e.name === 'OpError')
})

test('relabel changes one connection in place, and "" removes the label', () => {
  const m = connect(shop(), { from: 'web', to: 'api', label: 'REST' })
  const n = relabel(m, { from: 'web', to: 'api', label: 'REST' }, 'HTTPS')
  assert.deepEqual(n.connections.map(c => c.label), ['browses', 'HTTPS', 'reads/writes', 'checks users', 'sends receipts', 'REST'])
  assert.deepEqual(relabel(n, { from: 'web', to: 'api', label: 'HTTPS' }, '').connections[1], { from: 'web', to: 'api' })
  assert.equal(relabel(connect(shop(), { from: 'web', to: 'db' }), { from: 'web', to: 'db' }, 'reads').connections.at(-1)?.label, 'reads')
  assert.throws(() => relabel(shop(), { from: 'web', to: 'api', label: 'SOAP' }, 'x'), /no connection web → api labelled "SOAP"/)
  assert.throws(() => relabel(shop(), { from: 'web', to: 'db' }, 'x'), /no connection web → db without a label/)
})

test('removeConnection removes one connection, so a duplicate goes and the original stays', () => {
  const m = connect(shop(), { from: 'web', to: 'api', label: 'REST' })
  assert.deepEqual(removeConnection(m, { from: 'web', to: 'api', label: 'REST' }).connections.filter(c => c.to === 'api'),
    [{ from: 'web', to: 'api', label: 'REST' }])
  assert.equal(removeConnection(shop(), { from: 'customer', to: 'web', label: 'browses' }).connections.length, 4)
  assert.throws(() => removeConnection(shop(), { from: 'web', to: 'api' }), /no connection web → api without a label/)
})

test('updateFlow changes the name or steps and keeps the rest', () => {
  const base = shop()
  base.flows.checkout.owner = 'team-a'
  const steps = base.flows.checkout.steps.slice(1)
  assert.deepEqual(updateFlow(base, 'checkout', { steps }).flows.checkout, { name: 'Customer checks out', view: 'shop', steps, owner: 'team-a' })
  assert.equal(updateFlow(base, 'checkout', { name: 'Pays' }).flows.checkout.name, 'Pays')
  assert.throws(() => updateFlow(shop(), 'nope', { name: 'X' }), /unknown flow "nope"/)
  base.flows.Visit = { name: 'V', view: 'root', steps: [] }
  assert.throws(() => updateFlow(base, 'Visit', { name: 'X' }), /flows\/Visit\.yaml has an invalid file name/)
})

test('placeBoxes merges positions into one view and drops what no longer exists', () => {
  const layout: Record<string, Record<string, [number, number]>> = { root: { customer: [0, 0], gone: [1, 1] }, shop: { web: [5, 5] }, ghost: { x: [2, 2] } }
  const m = { ...shop(), layout }
  assert.deepEqual(placeBoxes(m, 'shop', { api: [10, 20] }).layout, { root: { customer: [0, 0] }, shop: { web: [5, 5], api: [10, 20] } })
  assert.deepEqual(placeBoxes(shop(), 'api', { auth: [1, 2] }).layout, { api: { auth: [1, 2] } })
})

test('refuseNewProblems names what an edit would break, and lets old problems be', () => {
  const before = shop()
  before.connections.push({ from: 'web', to: 'web' })
  assert.doesNotThrow(() => refuseNewProblems(before, putObject(before, { id: 'api', name: 'Backend' })))
  assert.throws(() => refuseNewProblems(before, putObject(before, { id: 'api', name: '' })),
    (e: unknown) => e instanceof OpError && e.message === 'Refused, nothing saved. This would add:\n- model.yaml: api: name is missing')
})

test('putObject sets code after description, and [] removes it', () => {
  const m = putObject(shop(), { id: 'api', code: ['src/api/'], description: 'Handles orders.' })
  assert.deepEqual(Object.keys(m.objects.api), ['type', 'in', 'name', 'tech', 'description', 'code'])
  assert.deepEqual(m.objects.api.code, ['src/api/'])
  assert.equal('code' in putObject(m, { id: 'api', code: [] }).objects.api, false)
})

test('putObject sets links after code, puts the title before the address, and [] removes them', () => {
  const m = putObject(shop(), {
    id: 'api',
    code: ['src/api/'],
    links: [{ url: 'docs/api.md', title: 'API notes' }, { url: 'https://status.example.com', title: '  ' }, { url: 'docs/x.md', note: 'keep' }],
  })
  assert.deepEqual(Object.keys(m.objects.api), ['type', 'in', 'name', 'tech', 'code', 'links'])
  assert.deepEqual(m.objects.api.links, [{ title: 'API notes', url: 'docs/api.md' }, { url: 'https://status.example.com' }, { url: 'docs/x.md', note: 'keep' }])
  assert.deepEqual(Object.keys((m.objects.api.links as object[])[0]), ['title', 'url'])
  assert.equal('links' in putObject(m, { id: 'api', links: [] }).objects.api, false)
})

test('refuseNewProblems counts a missing code path only when it is told what is missing', () => {
  const before = shop()
  const after = putObject(before, { id: 'api', code: ['gone/'] })
  refuseNewProblems(before, after)
  assert.throws(() => refuseNewProblems(before, after, new Set(['gone/'])), /code path "gone\/" doesn't exist/)
})

test('putFlow drops a blank step detail and keeps a real one', () => {
  const m = putFlow(shop(), { id: 'tour', name: 'Tour', view: 'shop', steps: [{ from: 'web', text: 'a', description: '  ' }, { from: 'api', text: 'b', description: 'More.' }] })
  assert.deepEqual(m.flows.tour.steps, [{ from: 'web', text: 'a' }, { from: 'api', text: 'b', description: 'More.' }])
})

test('putObject writes external as "true" in its place, and false removes it', () => {
  const m = putObject(shop(), { id: 'stripe', tech: 'REST', external: true, name: 'Stripe', type: 'system' })
  assert.deepEqual(m.objects.stripe, { type: 'system', name: 'Stripe', external: 'true', tech: 'REST' })
  assert.deepEqual(Object.keys(m.objects.stripe), ['type', 'name', 'external', 'tech'])
  assert.equal(Object.hasOwn(putObject(m, { id: 'stripe', external: false }).objects.stripe, 'external'), false)
  assert.equal(putObject(m, { id: 'stripe', name: 'Stripe API' }).objects.stripe.external, 'true')
})

test('setLines puts lines first in model.yaml, and undefined removes it', () => {
  const m = setLines({ ...shop(), meta: { title: 'Shop' } }, 'curved')
  assert.deepEqual(m.meta, { lines: 'curved', title: 'Shop' })
  assert.deepEqual(Object.keys(m.meta), ['lines', 'title'])
  assert.equal(lineStyle(m), 'curved')
  assert.deepEqual(setLines(m, undefined).meta, { title: 'Shop' })
  assert.equal(lineStyle(shop()), 'straight')
  assert.equal(lineStyle({ ...shop(), meta: { lines: 'wiggly' } }), 'straight')
})

test('setLines leaves straight out, and an existing lines key keeps its place', () => {
  assert.deepEqual(setLines({ ...shop(), meta: { lines: 'curved', title: 'Shop' } }, 'straight').meta, { title: 'Shop' })
  const m = setLines({ ...shop(), meta: { title: 'Shop', lines: 'curved' } }, 'angled')
  assert.deepEqual(Object.keys(m.meta), ['title', 'lines'])
  assert.equal(m.meta.lines, 'angled')
})

test("forgetLayout drops one view's positions, and refuses when there are none", () => {
  const m = { ...shop(), layout: { shop: { web: [0, 0] as [number, number] }, root: { shop: [1, 1] as [number, number] } } }
  assert.deepEqual(forgetLayout(m, 'shop').layout, { root: { shop: [1, 1] } })
  assert.throws(() => forgetLayout(m, 'api'), (e: unknown) => e instanceof OpError && /Nothing to tidy/.test(e.message))
})
