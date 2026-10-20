import { test } from 'node:test'
import assert from 'node:assert/strict'
import { carried, homeView, inView, lineKey, reach, rollUp } from '../src/core/failures.ts'
import type { Marks } from '../src/core/failures.ts'
import type { Mode } from '../src/core/model.ts'
import { connect } from '../src/core/ops.ts'
import { shopWithFailures } from './fixtures.ts'

const m = shopWithFailures()
const mode = (id: string): Mode => m.failures.ordering.modes[id]
const total = (marks: Marks) => [...Object.values(marks.boxes), ...Object.values(marks.lines)].reduce((n, x) => n + x.count, 0)

test('homeView is the view that draws the part: a shape\'s parent, a line\'s lowest view with both ends', () => {
  assert.equal(homeView(m, mode('auth-lock')), 'api')
  assert.equal(homeView(m, mode('db-down')), 'shop')
  assert.equal(homeView(m, mode('mail-timeout')), 'api') // orders is inside api and mail is drawn beside it
  assert.equal(homeView(m, { mode: 'x', on: 'gone' }), 'root')
  assert.equal(homeView(m, { mode: 'x', from: 'gone', to: 'db' }), 'root')
  assert.equal(homeView(m, { mode: 'x', from: 'web', to: 'api' }), 'shop')
  assert.equal(homeView(m, { mode: 'x' }), 'root')
})

test('inView: a shape mode when its shape is in the view, a line mode when one end is', () => {
  for (const view of ['shop', 'api', 'root']) assert.equal(inView(m, view, mode('auth-lock')), true, view)
  assert.equal(inView(m, 'web', mode('auth-lock')), false)
  assert.equal(inView(m, 'api', mode('db-down')), false)
  assert.equal(inView(m, 'api', mode('api-slow')), true) // on the frame
  assert.equal(inView(m, 'api', mode('mail-timeout')), true)
  assert.equal(inView(m, 'shop', mode('mail-timeout')), true) // mail is outside both, orders is inside
  assert.equal(inView(m, 'web', mode('mail-timeout')), false)
  assert.equal(inView(m, 'root', { mode: 'x', on: 'gone' }), true)
  assert.equal(inView(m, 'shop', { mode: 'x', on: 'gone' }), false)
})

test('rollUp: a shape that holds others takes the worst band and the count of what is inside', () => {
  assert.deepEqual(rollUp(m, m.failures.ordering, 'shop'), {
    boxes: { web: { band: 'low', count: 1 }, api: { band: 'high', count: 3 }, db: { band: 'high', count: 1 } },
    lines: { 'api mail': { band: 'medium', count: 1 } },
  })
  assert.deepEqual(rollUp(m, m.failures.ordering, 'root'), { boxes: { shop: { band: 'high', count: 5 } }, lines: { 'shop mail': { band: 'medium', count: 1 } } })
  assert.deepEqual(rollUp(m, m.failures.ordering, 'api'), {
    boxes: { auth: { band: 'high', count: 1 }, orders: { band: 'unrated', count: 1 } },
    lines: { 'orders mail': { band: 'medium', count: 1 } }, // api-slow is on the frame, which carries no badge
  })
})

test('rollUp loses nothing and counts nothing twice: the counts add up in every view', () => {
  assert.equal(total(rollUp(m, m.failures.ordering, 'root')), 6)
  assert.equal(total(rollUp(m, m.failures.ordering, 'shop')), 6)
  assert.equal(total(rollUp(m, m.failures.ordering, 'api')), 3) // auth-lock, orders-unrated and the mail line
})

test('a mode whose id equals a shape id marks the shape it names, not the one its id spells', () => {
  const a = { name: 'A', modes: { web: { mode: 'x', on: 'db' } } }
  assert.deepEqual(rollUp(m, a, 'shop'), { boxes: { db: { band: 'unrated', count: 1 } }, lines: {} })
  assert.deepEqual(carried(m, a, 'shop', { box: 'web' }), [])
  assert.deepEqual(carried(m, a, 'shop', { box: 'db' }), ['web'])
  assert.deepEqual(reach(m, 'shop', a.modes.web), { fails: ['db'], affects: [] })
})

test('a line whose two ends sit in one drawn box counts toward that box, and shows as a line inside it', () => {
  const both = connect(shopWithFailures(), { from: 'orders', to: 'auth', label: 'asks' })
  both.failures.ordering.modes['orders-auth'] = { mode: 'x', from: 'orders', to: 'auth' }
  const shop = rollUp(both, both.failures.ordering, 'shop')
  assert.equal(shop.boxes.api.count, 4)
  assert.deepEqual(Object.keys(shop.lines), ['api mail'])
  assert.equal(rollUp(both, both.failures.ordering, 'api').lines['orders auth'].count, 1)
  assert.deepEqual(carried(both, both.failures.ordering, 'shop', { box: 'api' }).includes('orders-auth'), true)
})

test('carried lists the modes a drawn shape or line carries, worst first', () => {
  const a = m.failures.ordering
  assert.deepEqual(carried(m, a, 'shop', { box: 'api' }), ['auth-lock', 'api-slow', 'orders-unrated'])
  assert.deepEqual(carried(m, a, 'shop', { line: ['api', 'mail'] }), ['mail-timeout'])
  assert.deepEqual(carried(m, a, 'shop', { box: 'web' }), ['web-glitch'])
  assert.deepEqual(carried(m, a, 'shop', { box: 'mail' }), [])
  assert.deepEqual(carried(m, a, 'shop', { line: ['web', 'api'] }), [])
  assert.deepEqual(carried(m, a, 'root', { box: 'shop' }), ['auth-lock', 'db-down', 'api-slow', 'web-glitch', 'orders-unrated'])
})

test('reach: the drawn parts that fail, and the drawn shapes it hurts that are not already failing', () => {
  assert.deepEqual(reach(m, 'shop', mode('db-down')), { fails: ['db'], affects: [] })
  assert.deepEqual(reach(m, 'shop', { ...mode('db-down'), affects: ['web', 'db', 'gone'] }), { fails: ['db'], affects: ['web'] })
  assert.deepEqual(reach(m, 'shop', mode('mail-timeout')), { fails: ['api', 'mail'], failsLine: 'api mail', affects: [] })
  assert.deepEqual(reach(m, 'web', mode('db-down')), { fails: [], affects: [] }) // the view cannot draw it
  assert.deepEqual(reach(m, 'api', { ...mode('auth-lock'), affects: ['web', 'orders', 'orders'] }), { fails: ['auth'], affects: ['orders'] })
})

test('lineKey is the text a drawn line is known by', () => {
  assert.equal(lineKey('api', 'mail'), 'api mail')
})
