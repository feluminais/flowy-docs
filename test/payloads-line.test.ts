import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Model } from '../src/core/model.ts'
import { lineCarries } from '../src/core/payloads.ts'
import { shop } from './fixtures.ts'

/** The shop with three payloads; web → api carries the order, and the checkout flow's step 2 (web → api) sends it and gets the receipt back. */
function model(): Model {
  const m = shop()
  return {
    ...m,
    meta: { payloads: { order: { name: 'Order', about: 'x' }, receipt: { name: 'Receipt', about: 'y' }, saved: { name: 'Saved order', about: 'z' } } },
    connections: m.connections.map(c => (c.from === 'web' && c.to === 'api' ? { ...c, payloads: ['order'] } : c)),
    flows: {
      checkout: {
        name: 'Customer checks out',
        view: 'shop',
        steps: [
          { from: 'customer', to: 'web', text: 'Clicks "Buy"' },
          { from: 'web', to: 'api', text: 'POST /orders', animation: 'call', payload: 'order', reply: 'receipt' },
          { from: 'orders', to: 'db', text: 'Saves the order', payload: 'saved' },
          { from: 'api', to: 'web', text: 'Pushes an update', payload: { name: 'Update', about: 'An inline one.' } },
        ],
      },
    },
  }
}

const rows = (m: Model, from: string, to: string) => lineCarries(m, 'shop', from, to).map(c => ({ name: c.payload.name, back: c.back, own: c.own, steps: c.steps }))

test('a line lists its connections\' payloads, then what steps send along it, once each by id', () => {
  assert.deepEqual(rows(model(), 'web', 'api'), [
    { name: 'Order', back: false, own: true, steps: [{ flow: 'checkout', step: 1, reply: false }] },
    { name: 'Receipt', back: true, own: false, steps: [{ flow: 'checkout', step: 1, reply: true }] },
    { name: 'Update', back: true, own: false, steps: [{ flow: 'checkout', step: 3, reply: false }] },
  ])
})

test('a payload a step sends the other way, and a reply, run back', () => {
  const back = rows(model(), 'api', 'web')
  assert.deepEqual(back.map(r => [r.name, r.back]), [['Order', true], ['Receipt', false], ['Update', false]])
})

test('a line that rolls up connections inside two shapes lists all of them', () => {
  // orders is inside api: on the shop view, orders → db is drawn as api → db.
  const m = model()
  const carried = { ...m, connections: m.connections.map(c => (c.from === 'orders' && c.to === 'db' ? { ...c, payloads: ['saved'] } : c)) }
  assert.deepEqual(rows(carried, 'api', 'db'), [{ name: 'Saved order', back: false, own: true, steps: [{ flow: 'checkout', step: 2, reply: false }] }])
})

test('an inline payload is a row of its own even when a listed one has its name', () => {
  const m = model()
  const twin = { ...m, connections: m.connections.map(c => (c.from === 'web' && c.to === 'api' ? { ...c, payloads: ['order', { name: 'Order', about: 'Written in place.' }] } : c)) }
  assert.deepEqual(rows(twin, 'web', 'api').map(r => r.name), ['Order', 'Order', 'Receipt', 'Update'])
})

test('a line nothing is carried on lists nothing', () => {
  assert.deepEqual(rows(model(), 'customer', 'web'), [])
})

test('motionOf names the dot after the payload when the animation gives no word, and the answer after the reply', async () => {
  const { motionOf } = await import('../src/core/payloads.ts')
  const { beatsFor } = await import('../src/core/animation.ts')
  const m = model()
  const a = motionOf(m, { from: 'web', to: 'api', text: 'x', animation: 'call', payload: 'order', reply: 'receipt' })!
  assert.equal(a.carries, 'Order')
  assert.equal(a.replies, 'Receipt')
  const labels = beatsFor(a, { length: 300, afterLanding: false }).beats.filter(b => b.do === 'blob').map(b => [b.dir, b.label])
  assert.deepEqual(labels, [['fwd', 'Order'], ['back', 'Receipt']])
})

test('a word in the animation wins over the payload\'s name, and a burst keeps its request names', async () => {
  const { motionOf } = await import('../src/core/payloads.ts')
  const m = model()
  assert.equal(motionOf(m, { from: 'web', to: 'api', text: 'x', animation: { kind: 'call', carries: 'POST' }, payload: 'order' })?.carries, 'POST')
  assert.equal(motionOf(m, { from: 'web', to: 'api', text: 'x', animation: { kind: 'send', outcome: 'lost', share: '30' }, payload: 'order' })?.carries, undefined)
})

test('a failed call has no answer, so its way back says no reply', async () => {
  const { motionOf } = await import('../src/core/payloads.ts')
  const { beatsFor } = await import('../src/core/animation.ts')
  const a = motionOf(model(), { from: 'web', to: 'api', text: 'x', animation: { kind: 'call', outcome: 'fail' }, payload: 'order', reply: 'receipt' })!
  const back = beatsFor(a, { length: 300, afterLanding: false }).beats.find(b => b.do === 'blob' && b.dir === 'back')
  assert.equal(back?.label, undefined)
})

test('a recursion\'s way back says the reply\'s name when returns is left out', async () => {
  const { motionOf } = await import('../src/core/payloads.ts')
  assert.equal(motionOf(model(), { from: 'api', text: 'x', animation: 'recurse', reply: 'receipt' })?.returns, 'Receipt')
  assert.equal(motionOf(model(), { from: 'api', text: 'x', animation: { kind: 'recurse', returns: 'price' }, reply: 'receipt' })?.returns, 'price')
})

test('an unknown payload id leaves the dot as it was', async () => {
  const { motionOf } = await import('../src/core/payloads.ts')
  const a = motionOf(model(), { from: 'web', to: 'api', text: 'x', animation: 'call', payload: 'nope' })
  assert.equal(a?.carries, undefined)
  assert.equal(motionOf(model(), { from: 'web', to: 'api', text: 'x' }), undefined)
})
