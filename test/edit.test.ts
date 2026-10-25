import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { deleteFlow, placeBoxes, putObject } from '../src/core/ops.ts'
import { changesBetween, connectionsOf, linesOf, locate, moveBetween, newId, problemsOf, withKey } from '../ui/src/edit.ts'
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
  assert.deepEqual(connectionsOf(shop(), 'root', 'shop', 'customer').map(c => [c.index, c.back]), [[0, true]], 'a line given the other way still finds it')
  const both = shop()
  both.connections.push({ from: 'api', to: 'web', label: 'pushes' })
  assert.deepEqual(connectionsOf(both, 'shop', 'web', 'api').map(c => [c.connection.label, c.back]), [['REST', false], ['pushes', true]])
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

test('locate finds a line between a box and its own child, in both directions', () => {
  const m = shop()
  m.connections.push({ from: 'shop', to: 'api' }, { from: 'shop', to: 'api' }, { from: 'api', to: 'shop' }, { from: 'api', to: 'shop' })
  const spots = check(m).map(p => locate(m, p))
  assert.deepEqual(spots, [{ view: 'shop', line: ['shop', 'api'] }, { view: 'shop', line: ['api', 'shop'] }])
})

test('problemsOf gives an object its own problems and those of connections touching it', () => {
  const m = shop()
  m.objects.web.name = ''
  m.connections.push({ from: 'web', to: 'web' }, { from: 'api', to: 'ghost' })
  assert.deepEqual(problemsOf(m, check(m), 'web').map(p => p.message), ['web: name is missing', 'connection web → web: connects an object to itself'])
  assert.deepEqual(problemsOf(m, check(m), 'api').map(p => p.message), ['connection api → ghost: unknown object "ghost"'])
})

test('linesOf lists the lines touching a box where it sits, out then in, with the connections behind each', () => {
  const ends = (lines: ReturnType<typeof linesOf>['out']) =>
    lines.map(l => [l.other, l.connections.map(c => `${c.from}>${c.to}:${c.label ?? ''}`)])
  // API sits in Shop. Its line to Orders DB stands for two connections from the components inside it.
  const api = linesOf(shop(), 'api')
  assert.deepEqual(ends(api.out), [['db', ['orders>db:reads/writes', 'auth>db:checks users']], ['mail', ['orders>mail:sends receipts']]])
  assert.deepEqual(ends(api.in), [['web', ['web>api:REST']]])
  // Mail service sits at the top, where Shop's line to it stands for Orders' connection.
  assert.deepEqual(ends(linesOf(shop(), 'mail').in), [['shop', ['orders>mail:sends receipts']]])
  assert.deepEqual(linesOf(shop(), 'mail').out, [])
})

test('moveBetween: into a box inside, out to one around, across to one beside', () => {
  // Mail service gets an app inside, so it opens too, beside Shop.
  const m = putObject(shop(), { id: 'smtp', type: 'app', name: 'SMTP', in: 'mail' })
  assert.equal(moveBetween(m, 'root', 'shop'), 'in')
  assert.equal(moveBetween(m, 'root', 'api'), 'in', 'two levels down is still in')
  assert.equal(moveBetween(m, 'api', 'shop'), 'out')
  assert.equal(moveBetween(m, 'api', 'root'), 'out')
  assert.equal(moveBetween(m, 'shop', 'mail'), 'across', 'side by side')
  assert.equal(moveBetween(m, 'mail', 'shop'), 'across', 'and back: still across, never in twice')
  assert.equal(moveBetween(m, 'api', 'mail'), 'across', 'a cousin is across too')
})

test('withKey sets a lane or a flow link trimmed, keeps its place, and a blank one takes the key away', () => {
  const step = { from: 'a', lane: 'Old', text: 'x', note: 'kept' }
  assert.deepEqual(Object.entries(withKey(step, 'lane', '  New lane ')), [['from', 'a'], ['lane', 'New lane'], ['text', 'x'], ['note', 'kept']])
  assert.deepEqual(withKey(step, 'lane', '   '), { from: 'a', text: 'x', note: 'kept' })
  assert.deepEqual(withKey({ from: 'a', text: 'x' }, 'flow', 'deliver'), { from: 'a', text: 'x', flow: 'deliver' })
  assert.deepEqual(withKey({ from: 'a', text: 'x' }, 'flow', ''), { from: 'a', text: 'x' })
})
