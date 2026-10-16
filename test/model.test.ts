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

test('empty files and empty sections read as empty', () => {
  assert.deepEqual(parseModelFile(''), { objects: {}, connections: [], meta: {} })
  assert.deepEqual(parseModelFile('objects:\nconnections:\n'), { objects: {}, connections: [], meta: {} })
  assert.deepEqual(parseFlowFile('x', ''), { steps: [] })
  assert.deepEqual(parseFlowFile('x', '# just a comment\n'), { steps: [] })
  assert.deepEqual(parseLayoutFile(''), {})
  assert.deepEqual(parseLayoutFile('root:\n'), { root: {} })
  assert.deepEqual(parseModelFile('objects: ~\nconnections: null\n'), { objects: {}, connections: [], meta: {} })
  assert.deepEqual(parseLayoutFile('root: ~\n'), { root: {} })
})

test('a save gives back hand-written values exactly as typed', () => {
  const text = 'title: Shop\nobjects:\n  api:\n    type: app\n    name: API\n    legacy: true\n    order: 5\n    owner: null\n    tech: 3.10\nconnections: []\n'
  assert.equal(serializeModelFile({ ...emptyModel(), ...parseModelFile(text) }), text)
})

test('only real git conflict markers count as merge conflicts', () => {
  assert.throws(() => parseModelFile('objects: {}\r\n=======\r\n'), /unresolved merge conflict/)
  assert.throws(() => parseModelFile('objects: {}\n>>>>>>> other'), /unresolved merge conflict/)
  assert.deepEqual(Object.keys(parseModelFile('==========: x\n<<<<<<<x: 1\n').meta), ['==========', '<<<<<<<x'])
})

// U+2028 and U+2029, built in code so no copy or paste step can turn them into spaces
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)

test('line separators inside values are not mistaken for conflict markers', () => {
  const m = { ...emptyModel(), objects: { o: { type: 'actor' as const, name: 'N', description: `a${LS}=======${PS}<<<<<<< x` } } }
  assert.deepEqual(parseModelFile(serializeModelFile(m)).objects, m.objects)
})

test('values that look like numbers, booleans or null stay text through a save', () => {
  const m = { ...emptyModel(), ...parseModelFile('objects:\n  007: { type: actor, name: 2024, tech: 3.10, legacy: true, owner: null }\n') }
  assert.deepEqual(m.objects['007'], { type: 'actor', name: '2024', tech: '3.10', legacy: 'true', owner: 'null' })
  assert.deepEqual(parseModelFile(serializeModelFile(m)).objects, m.objects)
})

test('duplicate ids are a parse error with a line number, even when quoted differently', () => {
  assert.throws(
    () => parseModelFile('objects:\n  a: { type: actor, name: A }\n  a: { type: actor, name: B }\n'),
    (e: unknown) => e instanceof ParseError && e.file === 'model.yaml' && e.line === 3,
  )
  assert.throws(() => parseModelFile("objects:\n  1: { type: actor, name: A }\n  '1': { type: actor, name: B }\n"), ParseError)
})

test('special keys stay plain own properties', () => {
  const m = parseModelFile('objects:\n  __proto__: { type: actor, name: P }\n  constructor: { type: actor, name: C }\n')
  assert.deepEqual(Object.keys(m.objects), ['__proto__', 'constructor'])
  assert.equal(Object.getPrototypeOf(m.objects), Object.prototype)
  assert.equal(getObject({ ...emptyModel(), ...m }, 'constructor')?.name, 'C')
})

test('wrong shapes are parse errors that name the culprit', () => {
  assert.throws(() => parseModelFile('- just\n- a list\n'), ParseError)
  assert.throws(() => parseModelFile('connections: nope\n'), ParseError)
  assert.throws(() => parseModelFile('objects:\n  a: not-a-mapping\n'), /object "a" must be a mapping/)
  assert.throws(() => parseModelFile('connections:\n  - { from: a, to: b }\n  - oops\n'), /connection 2 must be a mapping/)
})

test('merge conflicts and alias bombs are parse errors', () => {
  assert.throws(
    () => parseModelFile('objects:\n<<<<<<< HEAD\n  a: { type: actor, name: A }\n=======\n  a: { type: actor, name: B }\n>>>>>>> other\n'),
    (e: unknown) => e instanceof ParseError && e.line === 2 && /unresolved merge conflict/.test(e.message),
  )
  const bomb = ['a: &a [x, x, x, x, x, x, x, x, x, x]', 'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
    'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]', 'd: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]'].join('\n')
  assert.throws(() => parseModelFile(bomb), ParseError)
})

test('shared objects are written out in full, not as YAML aliases', () => {
  const point: [number, number] = [1, 2]
  assert.doesNotMatch(serializeLayout({ root: { a: point, b: point } }), /[&*]/)
  const step = { from: 'a', to: 'b', text: 'Go' }
  assert.doesNotMatch(serializeFlow({ name: 'F', view: 'root', steps: [step, step] }), /[&*]/)
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
  assert.deepEqual(changedFiles(before, shop()), [])
  const renamed = { ...before, objects: { ...before.objects, api: { ...before.objects.api, name: 'Orders API' } } }
  assert.deepEqual(changedFiles(before, renamed).map(([path]) => path), ['model.yaml'])
  const flows = { ...before.flows }
  delete flows.checkout
  assert.deepEqual(changedFiles(before, { ...before, flows }), [['flows/checkout.yaml', null]])
})
