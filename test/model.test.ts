import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changedFiles, emptyModel, getObject, ParseError, parseFlowFile, parseLayoutFile, parseModelFile,
  serializeFlow, serializeLayout, serializeModelFile,
} from '../src/core/model.ts'
import type { Layout } from '../src/core/model.ts'
import { shop } from './fixtures.ts'

const MODEL_YAML = `title: Demo
objects:
  customer: { type: actor, name: Customer, owner: sales }
  shop:
    type: system
    name: Shop
connections:
  - { from: customer, to: shop, label: browses }
`

test('parses objects and connections, and keeps extra keys', () => {
  const m = parseModelFile(MODEL_YAML)
  assert.deepEqual(Object.keys(m.objects), ['customer', 'shop'])
  assert.equal(m.objects.customer.owner, 'sales')
  assert.deepEqual(m.connections, [{ from: 'customer', to: 'shop', label: 'browses' }])
  assert.deepEqual(m.meta, { title: 'Demo' })
})

test('round trip keeps order, extra fields and multi-line descriptions', () => {
  const m = { ...emptyModel(), ...parseModelFile(MODEL_YAML) }
  m.objects.shop.description = 'Sells things.\n\nMore notes.'
  const again = parseModelFile(serializeModelFile(m))
  assert.deepEqual(again, { objects: m.objects, connections: m.connections, meta: m.meta })
  assert.deepEqual(Object.keys(again.objects), ['customer', 'shop'])
})

test('an empty file is an empty model', () => {
  assert.deepEqual(parseModelFile(''), { objects: {}, connections: [], meta: {} })
  assert.deepEqual(parseModelFile('objects:\nconnections:\n'), { objects: {}, connections: [], meta: {} })
})

test('duplicate ids are a parse error with a line number', () => {
  assert.throws(
    () => parseModelFile('objects:\n  a: { type: actor, name: A }\n  a: { type: actor, name: B }\n'),
    (e: unknown) => e instanceof ParseError && e.file === 'model.yaml' && e.line === 3,
  )
})

test('wrong shapes and merge conflicts are parse errors', () => {
  assert.throws(() => parseModelFile('- just\n- a list\n'), ParseError)
  assert.throws(() => parseModelFile('connections: nope\n'), ParseError)
  assert.throws(() => parseModelFile('objects:\n  a: not-a-mapping\n'), ParseError)
  assert.throws(
    () => parseModelFile('objects:\n<<<<<<< HEAD\n  a: { type: actor, name: A }\n=======\n  a: { type: actor, name: B }\n>>>>>>> other\n'),
    ParseError,
  )
})

test('flow files', () => {
  const flow = parseFlowFile('checkout', 'name: Checkout\nview: shop\nsteps:\n  - { from: a, to: b, text: Go }\n')
  assert.deepEqual(flow, { name: 'Checkout', view: 'shop', steps: [{ from: 'a', to: 'b', text: 'Go' }] })
  assert.deepEqual(parseFlowFile('checkout', serializeFlow(flow)), flow)
  assert.throws(() => parseFlowFile('x', 'name: X\nsteps: nope\n'), (e: unknown) => e instanceof ParseError && e.file === 'flows/x.yaml')
})

test('layout points are written inline and read back', () => {
  const layout: Layout = { root: { customer: [0, 0], shop: [320, 40] } }
  const text = serializeLayout(layout)
  assert.match(text, /customer: \[0, 0\]/)
  assert.deepEqual(parseLayoutFile(text), layout)
  assert.throws(() => parseLayoutFile('root:\n  a: [1]\n'), ParseError)
})

test('getObject ignores prototype keys, "root" and non-strings', () => {
  const m = shop()
  assert.equal(getObject(m, 'constructor'), undefined)
  assert.equal(getObject(m, 'root'), undefined)
  assert.equal(getObject(m, 42), undefined)
  assert.equal(getObject(m, 'api')?.name, 'API')
})

test('changedFiles lists only files whose content changed', () => {
  const before = shop()
  const renamed = { ...before, objects: { ...before.objects, api: { ...before.objects.api, name: 'Orders API' } } }
  assert.deepEqual(changedFiles(before, renamed).map(([path]) => path), ['model.yaml'])
  const flows = { ...before.flows }
  delete flows.checkout
  assert.deepEqual(changedFiles(before, { ...before, flows }), [['flows/checkout.yaml', null]])
})
