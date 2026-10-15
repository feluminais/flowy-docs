import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chain, computeView, hasChildren, memberIds, placeEnds } from '../src/core/views.ts'
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
  assert.ok(v.outsiders.includes('shop'))
  assert.ok(v.edges.some(e => e.from === 'auth' && e.to === 'shop'))
})

test('placeEnds maps flow steps and hides what a view cannot show', () => {
  const m = shop()
  assert.deepEqual(placeEnds(m, 'shop', 'customer', 'web'), ['customer', 'web'])
  assert.deepEqual(placeEnds(m, 'shop', 'orders', 'db'), ['api', 'db'])
  assert.equal(placeEnds(m, 'root', 'web', 'api'), null)
  assert.equal(placeEnds(m, 'api', 'customer', 'web'), null)
})
