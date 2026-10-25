import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chain, computeView, hasChildren, lineKey, memberIds, pathName, placeEnds, placeStep, stepEnds } from '../src/core/views.ts'
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

test('connections both ways between two shapes are one line, running the way the first one does', () => {
  const m = shop()
  m.connections.push({ from: 'api', to: 'web', label: 'pushes' })
  const v = computeView(m, 'shop')
  assert.deepEqual(v.edges.filter(e => lineKey(e.from, e.to) === lineKey('api', 'web')), [{ from: 'web', to: 'api', label: '2 connections', count: 2, both: true }])
  assert.equal(computeView(shop(), 'shop').edges.find(e => e.from === 'web' && e.to === 'api')?.both, undefined, 'one way has no flag')
})

test('lineKey is the same whichever way a line is given', () => {
  assert.equal(lineKey('web', 'api'), 'api web')
  assert.equal(lineKey('api', 'web'), 'api web')
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

test('pathName names a shape the way the view draws it: the shape drawn there that holds it, then down to it', () => {
  const m = shop()
  assert.equal(pathName(m, 'api', 'auth'), 'Auth', 'a shape the view draws is just its name')
  assert.equal(pathName(m, 'shop', 'auth'), 'API > Auth', 'inside the shape the view draws')
  assert.equal(pathName(m, 'root', 'auth'), 'Shop > API > Auth', 'from the top, where the view is the overview')
  assert.equal(pathName(m, 'api', 'db'), 'Orders DB', 'a neighbour of the shapes in view')
  assert.equal(pathName(m, 'api', 'api'), 'API', 'the view itself keeps its name')
})

test('an actor a flow names is drawn on the level the flow plays at, even with no line to it there', () => {
  const m = shop()
  // Inside api the customer has no line: the web app stands between them. A flow that plays in api and starts with the customer draws them.
  assert.deepEqual(computeView(m, 'api').outsiders, ['db', 'mail'])
  m.flows = { ...m.flows, order: { name: 'An order is saved', view: 'api', steps: [{ from: 'customer', to: 'web', text: 'Clicks "Buy"' }, { from: 'web', to: 'orders', text: 'POST /orders' }] } }
  const v = computeView(m, 'api')
  assert.deepEqual(v.outsiders, ['db', 'mail', 'customer'])
  assert.deepEqual(v.edges.map(e => `${e.from}>${e.to}`), ['orders>db', 'auth>db', 'orders>mail']) // no line is made up for it
  // A step from the customer to another outside box is shown between the two. The web app has no line here: like any box a step
  // lands on, it joins the view while the flow plays.
  assert.deepEqual(placeStep(m, 'api', { from: 'customer', to: 'db' }), ['customer', 'db'])
  assert.deepEqual(placeStep(m, 'api', { from: 'customer', to: 'web' }), ['customer', 'web'])
})

test('a step between two outside boxes needs an actor drawn for the flows', () => {
  const m = shop()
  assert.equal(placeStep(m, 'api', { from: 'customer', to: 'web' }), null) // no flow in api names the customer
  m.flows = { ...m.flows, order: { name: 'x', view: 'api', steps: [{ from: 'customer', to: 'web', text: 'a' }] } }
  assert.equal(placeStep(m, 'api', { from: 'web', to: 'mail' }), null) // two outside boxes, neither an actor
  assert.equal(placeStep(m, 'api', { from: 'customer', to: 'customer' }), null)
})

test('only actors are drawn for the flows, and only where the view would draw them as themselves', () => {
  const m = shop()
  m.objects = { ...m.objects, clerk: { type: 'actor', name: 'Clerk', in: 'shop' } }
  m.flows = { ...m.flows, order: { name: 'x', view: 'api', steps: [{ from: 'mail', to: 'orders', text: 'a' }, { from: 'clerk', to: 'orders', text: 'b' }, { from: 'customer', to: 'orders', text: 'c' }] } }
  // Mail is a system, and the clerk sits in the shop beside the api, where the view draws them as themselves too: both are actors only if typed so.
  assert.deepEqual(computeView(m, 'api').outsiders, ['db', 'mail', 'clerk', 'customer'])
  m.flows = { order: { ...m.flows.order, view: 'root' } } // an edit makes new maps, which is what the views' caches go by
  assert.deepEqual(computeView(m, 'api').outsiders, ['db', 'mail']) // a flow that plays elsewhere adds nothing here
})
