import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chain, computeView, hasChildren, memberIds, placeEnds, placeStep, stepEnds } from '../src/core/views.ts'
import { shop } from './fixtures.ts'

test('chain walks up to root', () => {
  assert.deepEqual(chain(shop(), 'auth'), ['auth', 'api', 'shop', 'root'])
  assert.deepEqual(chain(shop(), 'root'), ['root'])
})

test('chain survives cycles', () => {
  const m = shop()
  m.objects.web.in = 'api'
  m.objects.api.in = 'web'
  assert.deepEqual(chain(m, 'web'), ['web', 'api', 'root'])
})

test('members are the direct children', () => {
  const m = shop()
  assert.deepEqual(memberIds(m, 'root'), ['customer', 'shop', 'mail'])
  assert.deepEqual(memberIds(m, 'shop'), ['web', 'api', 'db'])
  assert.equal(hasChildren(m, 'api'), true)
  assert.equal(hasChildren(m, 'db'), false)
})

test('root view folds everything inside shop into one box', () => {
  assert.deepEqual(computeView(shop(), 'root'), {
    id: 'root',
    members: ['customer', 'shop', 'mail'],
    outsiders: [],
    edges: [
      { from: 'customer', to: 'shop', label: 'browses', count: 1 },
      { from: 'shop', to: 'mail', label: 'sends receipts', count: 1 },
    ],
  })
})

test('inside shop: outsiders appear and the two api → db lines merge', () => {
  assert.deepEqual(computeView(shop(), 'shop'), {
    id: 'shop',
    members: ['web', 'api', 'db'],
    outsiders: ['customer', 'mail'],
    edges: [
      { from: 'customer', to: 'web', label: 'browses', count: 1 },
      { from: 'web', to: 'api', label: 'REST', count: 1 },
      { from: 'api', to: 'db', label: '2 connections', count: 2 },
      { from: 'api', to: 'mail', label: 'sends receipts', count: 1 },
    ],
  })
})

test('inside api: sibling stores and other systems are outsiders', () => {
  const v = computeView(shop(), 'api')
  assert.deepEqual(v.members, ['auth', 'orders'])
  assert.deepEqual(v.outsiders, ['db', 'mail'])
  assert.deepEqual(v.edges.map(e => `${e.from}>${e.to}`), ['orders>db', 'auth>db', 'orders>mail'])
})

test('a connection to the system you are inside shows that system as an outsider', () => {
  const m = shop()
  m.connections.push({ from: 'auth', to: 'shop', label: 'reports to' })
  const v = computeView(m, 'api')
  assert.deepEqual(v.outsiders, ['db', 'mail', 'shop'])
  assert.deepEqual(v.edges.at(-1), { from: 'auth', to: 'shop', label: 'reports to', count: 1 })
})

test('deep objects in other branches are lifted to the box you can see', () => {
  const m = shop()
  m.objects.ui = { type: 'component', in: 'web', name: 'UI' }
  m.objects.queue = { type: 'store', in: 'mail', name: 'Queue' }
  m.connections = [{ from: 'ui', to: 'auth' }, { from: 'auth', to: 'queue' }]
  const v = computeView(m, 'api')
  assert.deepEqual(v.outsiders, ['web', 'mail'])
  assert.deepEqual(v.edges.map(e => `${e.from}>${e.to}`), ['web>auth', 'auth>mail'])
})

test('opposite directions stay separate lines', () => {
  const m = shop()
  m.connections.push({ from: 'api', to: 'web', label: 'pushes' })
  const v = computeView(m, 'shop')
  assert.ok(v.edges.some(e => e.from === 'web' && e.to === 'api' && e.count === 1))
  assert.ok(v.edges.some(e => e.from === 'api' && e.to === 'web' && e.count === 1))
})

test('a missing or self-pointing parent counts as top level', () => {
  const m = shop()
  m.objects.lost = { type: 'app', in: 'nowhere', name: 'Lost' }
  m.objects.loop = { type: 'system', in: 'loop', name: 'Loop' }
  m.connections.push({ from: 'loop', to: 'customer' })
  assert.deepEqual(memberIds(m, 'root'), ['customer', 'shop', 'mail', 'lost', 'loop'])
  const v = computeView(m, 'root')
  assert.deepEqual(v.outsiders, [])
  assert.ok(v.edges.some(e => e.from === 'loop' && e.to === 'customer'))
})

test('placeEnds maps flow steps and hides what a view cannot show', () => {
  const m = shop()
  assert.deepEqual(placeEnds(m, 'shop', 'customer', 'web'), ['customer', 'web'])
  assert.deepEqual(placeEnds(m, 'shop', 'orders', 'db'), ['api', 'db'])
  assert.equal(placeEnds(m, 'root', 'web', 'api'), null)
  assert.equal(placeEnds(m, 'api', 'customer', 'web'), null)
  assert.equal(placeEnds(m, 'shop', 'ghost', 'web'), null)
  assert.equal(placeEnds(m, 'root', 'root', 'web'), null)
})

test('placeStep puts a one-box step on the box that stands for it, twice', () => {
  const m = shop()
  assert.deepEqual(placeStep(m, 'shop', { from: 'auth' }), ['api', 'api'])
  assert.equal(placeStep(m, 'shop', { from: 'mail' }), null) // around the view, not in it
  assert.equal(placeStep(m, 'shop', { from: 'shop' }), null) // the box you're inside
  assert.deepEqual(placeStep(m, 'shop', { from: 'web', to: 'api' }), ['web', 'api'])
  assert.equal(placeStep(m, 'shop', { from: 'ghost' }), null)
})

test('stepEnds names the part inside a box a step lands on, so two steps on one box never read as a round trip', () => {
  // In Shop, web and api are boxes of their own.
  assert.equal(stepEnds(shop(), { from: 'web', to: 'api' }, ['web', 'api']), 'Web app → API')
  // At the top, Web app is drawn as Shop.
  assert.equal(stepEnds(shop(), { from: 'customer', to: 'web' }, ['customer', 'shop']), 'Customer → Web app in Shop')
  // Two parts of one box: both named, never just "Shop".
  assert.equal(stepEnds(shop(), { from: 'web', to: 'api' }, ['shop', 'shop']), 'Web app in Shop → API in Shop')
  // A step one box does on its own names it once.
  assert.equal(stepEnds(shop(), { from: 'api' }, ['shop', 'shop']), 'API in Shop')
  assert.equal(stepEnds(shop(), { from: 'api' }, null), 'API')
})
