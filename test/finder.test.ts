import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { flowChoices, shapeChoices, shapesFor } from '../src/core/finder.ts'

const shop: Model = {
  ...emptyModel(),
  objects: {
    customer: { type: 'actor', name: 'Customer' },
    shop: { type: 'system', name: 'Shop' },
    web: { type: 'app', in: 'shop', name: 'Web app', code: ['apps/web/'] },
    cart: { type: 'component', in: 'web', name: 'Cart', code: ['apps/web/src/cart.ts', 'apps/web/src/cart.test.ts'] },
    checkout: { type: 'component', in: 'web', name: 'Checkout', code: ['apps/web/src/checkout/'] },
    api: { type: 'app', in: 'shop', name: 'API', code: ['services/api'] }, // a folder written without the trailing slash
    audit: { type: 'app', in: 'shop', name: 'Audit', code: ['services/api'] },
    docs: { type: 'app', in: 'shop', name: 'Docs', code: [3, null, 'docs/'] as unknown as string[] }, // a bad entry doesn't stop a good one
    bare: { type: 'app', in: 'shop', name: 'Bare' },
  },
}

test('a file belongs to the shape that lists it, or else to the one whose folder holds it', () => {
  assert.deepEqual(shapesFor(shop, 'apps/web/src/cart.ts'), ['cart'])
  assert.deepEqual(shapesFor(shop, 'apps/web/src/checkout/pay.ts'), ['checkout'])
  assert.deepEqual(shapesFor(shop, 'apps/web/index.html'), ['web'])
  assert.deepEqual(shapesFor(shop, 'docs/guide.md'), ['docs'])
})

test('the nearest listing wins, so a file in a component is not also the app that holds it', () => {
  assert.deepEqual(shapesFor(shop, 'apps/web/src/checkout/pay.ts'), ['checkout']) // not web, which lists apps/web/
  assert.deepEqual(shapesFor(shop, 'apps/web/src/cart.test.ts'), ['cart'])
})

test('a folder listed twice is every shape that lists it, in id order', () => {
  assert.deepEqual(shapesFor(shop, 'services/api/orders.ts'), ['api', 'audit'])
  assert.deepEqual(shapesFor(shop, 'services/api'), ['api', 'audit'])
})

test('a folder is matched whole: a longer name that starts the same is another folder', () => {
  assert.deepEqual(shapesFor(shop, 'apps/web2/index.ts'), [])
  assert.deepEqual(shapesFor(shop, 'services/api-gateway/index.ts'), [])
  assert.deepEqual(shapesFor(shop, 'apps/web/src/cart.tsx'), ['web']) // cart.ts is a file, not a prefix of this one
})

test('a file nothing lists belongs to no shape', () => {
  assert.deepEqual(shapesFor(shop, 'README.md'), [])
  assert.deepEqual(shapesFor(emptyModel(), 'apps/web/index.html'), [])
})

test("a shape's choice says what it is and where it sits", () => {
  const choices = shapeChoices(shop)
  assert.deepEqual(choices.find(c => c.id === 'cart'), { id: 'cart', name: 'Cart', type: 'component', where: 'Shop › Web app' })
  assert.deepEqual(choices.find(c => c.id === 'shop'), { id: 'shop', name: 'Shop', type: 'system', where: 'Overview' })
  assert.deepEqual(choices.map(c => c.name), ['API', 'Audit', 'Bare', 'Cart', 'Checkout', 'Customer', 'Docs', 'Shop', 'Web app'])
})

test('a flow is offered with the view it plays in, when it has steps', () => {
  const model: Model = {
    ...shop,
    flows: {
      buy: { name: 'Buy something', view: 'web', steps: [{ from: 'cart', to: 'checkout', text: 'Pays' }] },
      browse: { name: 'Browse', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Looks' }] },
      empty: { name: 'Nothing yet', view: 'root', steps: [] },
      lost: { name: 'Lost', view: 'gone', steps: [{ from: 'customer', text: 'Wanders' }] },
    },
  }
  assert.deepEqual(flowChoices(model), [
    { id: 'browse', name: 'Browse', where: 'Overview', steps: 1 },
    { id: 'lost', name: 'Lost', where: 'Overview', steps: 1 }, // a view that isn't there falls back to the overview
    { id: 'buy', name: 'Buy something', where: 'Shop › Web app', steps: 1 },
  ])
})
