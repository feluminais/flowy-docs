import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  changedFiles, emptyModel, fileData, getObject, linksOf, modelFiles, ParseError, parseFile, parseFlowFile, parseLayoutFile,
  parseModelFile, serializeFile, serializeFlow, serializeLayout, serializeModelFile,
} from '../src/core/model.ts'
import type { FlowyObject, Layout } from '../src/core/model.ts'
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

test('a list or mapping in a text field is a parse error that names the field', () => {
  assert.throws(() => parseModelFile('objects:\n  a: { type: [app], name: A }\n'), /object "a": "type" must be plain text/)
  assert.throws(() => parseModelFile('objects:\n  a: { type: app, name: A, in: { x: y } }\n'), /object "a": "in" must be plain text/)
  assert.throws(() => parseModelFile('connections:\n  - { from: a, to: [b] }\n'), /connection 1: "to" must be plain text/)
  assert.throws(() => parseFlowFile('f', 'name: F\nview: [root]\nsteps: []\n'), /flow: "view" must be plain text/)
  assert.throws(() => parseFlowFile('f', 'name: F\nview: root\nsteps:\n  - { from: a, to: b, text: { t: x } }\n'), /step 1: "text" must be plain text/)
  assert.deepEqual(parseModelFile('objects:\n  a: { type: app, name: A, tags: [x, y] }\n').objects.a.tags, ['x', 'y'])
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

test('a parse error keeps its reason apart from the file:line prefix', () => {
  assert.throws(() => parseModelFile('objects:\n  a: {}\n  a: {}\n'), (e: unknown) =>
    e instanceof ParseError && e.line === 3 && e.message === `model.yaml:3: ${e.reason}` && !e.reason.includes('model.yaml'))
})

test('parseFile picks the parser by path, and reads back what serializeFile writes', () => {
  const model = { title: 'Demo', objects: { a: { type: 'actor', name: 'A' } }, connections: [{ from: 'a', to: 'b' }] }
  assert.deepEqual(parseFile('model.yaml', serializeFile('model.yaml', model)),
    { objects: model.objects, connections: model.connections, meta: { title: 'Demo' } })
  const flow = { name: 'Visit', view: 'root', steps: [{ from: 'a', to: 'b', text: 'Says hi' }] }
  assert.deepEqual(parseFile('flows/visit.yaml', serializeFile('flows/visit.yaml', flow)), flow)
  const layout = { root: { a: [10, 20.5] } }
  assert.equal(serializeFile('layout.yaml', layout), 'root:\n  a: [10, 20.5]\n')
  assert.deepEqual(parseFile('layout.yaml', serializeFile('layout.yaml', layout)), layout)
})

test('content that is not a valid file never gets past serializeFile and parseFile', () => {
  assert.throws(() => serializeFile('model.yaml', { objects: { a: { type: 'actor', name: 7 } } }))
  assert.throws(() => parseFile('flows/visit.yaml', serializeFile('flows/visit.yaml', ['a', 'list'])),
    (e: unknown) => e instanceof ParseError && e.file === 'flows/visit.yaml')
  assert.throws(() => parseFile('layout.yaml', serializeFile('layout.yaml', { root: { a: 'here' } })), ParseError)
})

test('fileData is what serializeFile turns into each file, with model.yaml extras at the top level', () => {
  const m = { ...shop(), meta: { title: 'Demo' }, layout: { root: { shop: [10, 20] as [number, number] } } }
  for (const [rel, text] of Object.entries(modelFiles(m))) assert.equal(serializeFile(rel, fileData(m, rel)), text, rel)
  assert.deepEqual(Object.keys(fileData(m, 'model.yaml') as object), ['title', 'objects', 'connections'])
  assert.equal(serializeFile('layout.yaml', fileData(m, 'layout.yaml')), serializeLayout(m.layout))
})

test('linksOf keeps the well-formed entries, with their extra keys, and ignores the rest', () => {
  const o = {
    type: 'app',
    name: 'A',
    links: [{ title: 'Doc', url: 'docs/a.md', note: 'x' }, { url: 'https://x.dev' }, { title: 'No url' }, 'text', { url: ['no'] }, { url: 'u', title: ['no'] }],
  } as unknown as FlowyObject
  assert.deepEqual(linksOf(o), [{ title: 'Doc', url: 'docs/a.md', note: 'x' }, { url: 'https://x.dev' }])
  assert.deepEqual(linksOf({ type: 'app', name: 'A', links: 'text' } as unknown as FlowyObject), [])
  assert.deepEqual(linksOf({ type: 'app', name: 'A' }), [])
})
