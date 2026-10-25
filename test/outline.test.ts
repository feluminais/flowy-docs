import { test } from 'node:test'
import assert from 'node:assert/strict'
import { comparedWith, expandTo, flowList, outline, outlineKey, rowCount, rowCountWords } from '../src/core/outline.ts'
import type { OutlineRow } from '../src/core/outline.ts'
import { ROOT } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { shop } from './fixtures.ts'

const open = (...ids: string[]) => new Set([ROOT, ...ids])
/** A row as a line of text: indent, name, then what the row says about itself. */
const line = (r: OutlineRow) => `${'  '.repeat(r.depth)}${r.name}${r.kind === 'flow' ? ' (flow)' : ''}${r.expandable ? (r.expanded ? ' -' : ' +') : ''}${r.problem ? ' !' : ''}`
const lines = (model: Model, expanded: Set<string>, more: { filter?: string; editing?: boolean } = {}) => outline(model, { expanded, ...more }).rows.map(line)

test('collapsed, only the project shows, with the totals of everything in it', () => {
  const { rows, totals } = outline(shop(), { expanded: new Set() })
  assert.deepEqual(rows.map(line), ['Overview +'])
  assert.deepEqual(totals, { shapes: 8, flows: 1, problems: 0 })
  assert.equal(rows[0].shapes, 8)
  assert.equal(rows[0].flows, 1)
  assert.equal(rows[0].key, 'shape:root')
  assert.equal(rows[0].parent, undefined)
})

test('open, a shape shows what is in it, shapes that hold others first and then by name, and then its flows', () => {
  assert.deepEqual(lines(shop(), open()), ['Overview -', '  Shop +', '  Customer', '  Mail service'])
  assert.deepEqual(lines(shop(), open('shop')), [
    'Overview -', '  Shop -', '    API +', '    Orders DB', '    Web app', '    Customer checks out (flow)', '  Customer', '  Mail service',
  ])
  assert.deepEqual(lines(shop(), open('shop', 'api')).slice(2, 5), ['    API -', '      Auth', '      Orders'])
})

test('a row counts the shapes right inside it, the number the canvas shows, and all of them at every level', () => {
  const rows = outline(shop(), { expanded: open('shop', 'api') }).rows
  const by = (key: string) => rows.find(r => r.key === key)!
  assert.deepEqual([by('shape:shop').inside, by('shape:shop').shapes], [3, 5]) // API, Orders DB and Web app; two more inside API
  assert.deepEqual([by('shape:api').inside, by('shape:api').shapes], [2, 2])
  assert.deepEqual([by('shape:customer').inside, by('shape:customer').shapes], [0, 0])
  assert.equal(by('shape:root').inside, 3) // Shop, Customer and Mail service
  assert.equal(by('shape:root').shapes, 8)
  assert.equal(rows.find(r => r.kind === 'flow')!.inside, 0)
})

test('a row counts the shapes and flows inside it at every level, and says what it is', () => {
  const rows = outline(shop(), { expanded: open('shop', 'api') }).rows
  const by = (key: string) => rows.find(r => r.key === key)!
  assert.deepEqual([by('shape:shop').shapes, by('shape:shop').flows], [5, 1])
  assert.deepEqual([by('shape:api').shapes, by('shape:api').flows], [2, 0])
  assert.deepEqual([by('shape:customer').shapes, by('shape:customer').flows], [0, 0])
  assert.equal(by('shape:web').type, 'app')
  assert.equal(by('shape:web').parent, 'shop')
  assert.equal(by('shape:web').depth, 2)
  const flow = by('flow:checkout')
  assert.deepEqual([flow.kind, flow.steps, flow.parent, flow.depth, flow.expandable], ['flow', 3, 'shop', 2, false])
})

test('an outside service is marked', () => {
  const m = shop()
  m.objects.mail.external = 'true'
  assert.equal(outline(m, { expanded: open() }).rows.find(r => r.id === 'mail')!.external, true)
})

test('a flow with no steps is listed only while editing, and one whose view cannot open is never listed', () => {
  const m = shop()
  m.flows.empty = { name: 'Not written yet', view: 'shop', steps: [] }
  m.flows.lost = { name: 'Nowhere', view: 'nope', steps: [{ from: 'customer', to: 'web', text: 'x' }] }
  m.flows.leaf = { name: 'In a shape with nothing in it', view: 'customer', steps: [{ from: 'customer', text: 'x' }] }
  assert.equal(outline(m, { expanded: open('shop') }).totals.flows, 1)
  assert.equal(outline(m, { expanded: open('shop'), editing: true }).totals.flows, 2)
  assert.ok(lines(m, open('shop'), { editing: true }).includes('    Not written yet (flow)'))
  assert.ok(!lines(m, open('shop')).includes('    Not written yet (flow)'))
})

test('a flow at the top level hangs from the project', () => {
  const m = shop()
  m.flows.tour = { name: 'A tour', view: ROOT, steps: [{ from: 'customer', to: 'shop', text: 'x' }] }
  assert.deepEqual(lines(m, open()), ['Overview -', '  Shop +', '  Customer', '  Mail service', '  A tour (flow)'])
})

test('a flow that shares a shape\'s id still has its own row', () => {
  const m = shop()
  m.flows.shop = m.flows.checkout
  const keys = outline(m, { expanded: open('shop') }).rows.map(r => r.key)
  assert.ok(keys.includes('shape:shop') && keys.includes('flow:shop'))
})

test('a problem marks its shape and everything above it, and a problem in a flow file marks that flow and its view', () => {
  const m = shop()
  const problems = [
    { file: 'model.yaml', id: 'auth', message: 'x' },
    { file: 'flows/checkout.yaml', step: 1, message: 'y' },
    { file: 'model.yaml', connection: 2, message: 'z' },
  ]
  const rows = outline(m, { expanded: open('shop', 'api'), problems }).rows
  assert.deepEqual(rows.filter(r => r.problem).map(r => r.key), ['shape:root', 'shape:shop', 'shape:api', 'shape:auth', 'flow:checkout'])
  assert.equal(outline(m, { expanded: open(), problems }).totals.problems, 3)
  assert.equal(outline(m, { expanded: open(), problems: [{ file: 'model.yaml', message: 'q' }] }).rows[0].problem, true)
})

test('a filter shows matches with the shapes that hold them, all open, and says which row matched', () => {
  const { rows } = outline(shop(), { expanded: new Set(), filter: 'ORD' })
  assert.deepEqual(rows.map(line), ['Overview -', '  Shop -', '    API -', '      Orders', '    Orders DB'])
  assert.deepEqual(rows.map(r => r.match), [false, false, false, true, true])
  assert.deepEqual(lines(shop(), new Set(), { filter: 'checks' }), ['Overview -', '  Shop -', '    Customer checks out (flow)'])
  assert.deepEqual(lines(shop(), new Set(), { filter: 'zzz' }), [])
  assert.deepEqual(lines(shop(), open(), { filter: '  ' }), ['Overview -', '  Shop +', '  Customer', '  Mail service'])
  assert.equal(outline(shop(), { expanded: new Set(), filter: 'web' }).totals.shapes, 8) // the totals are of the whole model
})

test('a filter also matches ids', () => {
  assert.deepEqual(lines(shop(), new Set(), { filter: 'auth' }), ['Overview -', '  Shop -', '    API -', '      Auth'])
})

test('shapes that sit inside each other in a loop are left out rather than looping', () => {
  const m = shop()
  m.objects.a = { type: 'system', name: 'A', in: 'b' }
  m.objects.b = { type: 'system', name: 'B', in: 'a' }
  assert.equal(outline(m, { expanded: open('a', 'b') }).totals.shapes, 8)
})

test('a very deep chain does not overflow the stack', () => {
  const m = shop()
  m.objects.n0 = { type: 'system', name: 'N0' }
  for (let i = 1; i < 20000; i++) m.objects[`n${i}`] = { type: 'system', name: `N${i}`, in: `n${i - 1}` }
  const expanded = new Set([ROOT, ...Object.keys(m.objects)])
  const { rows, totals } = outline(m, { expanded })
  assert.equal(rows.length, 1 + 8 + 20000 + 1) // the project, the shop's eight shapes, the chain, the flow
  assert.equal(totals.shapes, 8 + 20000)
  assert.ok(rows.some(r => r.depth === 20000))
})

test('names sort as in VS Code: any case, and numbers as numbers', () => {
  const m = shop()
  for (const name of ['step 10', 'Step 2', 'step 1', 'Step 02', 'alpha']) m.objects[name] = { type: 'system', name, in: 'api' }
  m.objects.zeta = { type: 'system', name: 'Zeta', in: 'api' }
  m.objects.zeta2 = { type: 'system', name: 'Zeta', in: 'api' }
  const rows = outline(m, { expanded: open('shop', 'api') }).rows.filter(r => r.parent === 'api')
  assert.deepEqual(rows.map(r => r.name), ['alpha', 'Auth', 'Orders', 'step 1', 'Step 02', 'Step 2', 'step 10', 'Zeta', 'Zeta'])
  assert.deepEqual(rows.filter(r => r.name === 'Zeta').map(r => r.id), ['zeta', 'zeta2'], 'the same name falls back to the id')
})

test('expandTo opens what holds a shape, and itself when asked', () => {
  assert.deepEqual([...expandTo(shop(), 'auth', new Set())].sort(), ['api', 'root', 'shop'])
  assert.deepEqual([...expandTo(shop(), 'auth', new Set(), true)].sort(), ['api', 'auth', 'root', 'shop'])
  assert.deepEqual([...expandTo(shop(), ROOT, new Set(['x']), true)].sort(), ['root', 'x'])
  const before = new Set(['shop'])
  expandTo(shop(), 'auth', before)
  assert.deepEqual([...before], ['shop'])
})

/** A model with flows tagged to each other, all on the shop view, named so that plain name order is a, b, c, d, e. */
function paired(): Model {
  const m = shop()
  const steps = [{ from: 'customer', to: 'web', text: 'x' }]
  m.flows = {
    e: { name: 'E alone', view: 'shop', steps },
    c: { name: 'C newest', view: 'shop', steps, compare: 'b' },
    a: { name: 'A oldest', view: 'shop', steps },
    d: { name: 'D other', view: 'shop', steps },
    b: { name: 'B middle', view: 'shop', steps, compare: { with: 'a', note: 'n' } },
  }
  return m
}

test('flowList: folders come first, the folders by name, and the flows of a folder by file name', () => {
  const m = shop()
  const steps = [{ from: 'customer', to: 'web', text: 'x' }]
  m.flows = {
    'b-pay': { name: 'Zeta', view: 'shop', steps },
    'a-pay': { name: 'Alpha', view: 'shop', steps },
    'step-10': { name: 'Ten', view: 'shop', steps },
    'step-2': { name: 'Two', view: 'shop', steps },
    top: { name: 'At the top', view: 'shop', steps },
    deep: { name: 'Deep', view: 'shop', steps },
  }
  m.folders = { 'b-pay': 'payments', 'a-pay': 'payments', 'step-10': 'steps', 'step-2': 'steps', deep: 'payments/refunds/stripe' }
  const { rows, total, shown } = flowList(m, {})
  assert.deepEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.kind === 'folder' ? `${r.name}/ ${r.flows}` : r.flow.id}`), [
    'payments/ 3',
    '  refunds/ 1',
    '    stripe/ 1',
    '      deep',
    '  a-pay',
    '  b-pay',
    'steps/ 2',
    '  step-2', // a run of digits counts as a number
    '  step-10',
    'top',
  ])
  assert.deepEqual([total, shown], [6, 6])
  assert.deepEqual(rows.filter(r => r.kind === 'folder').map(r => r.kind === 'folder' && r.path), ['payments', 'payments/refunds', 'payments/refunds/stripe', 'steps'])
})

test('flowList: a closed folder shows no rows below it but still counts what is in it', () => {
  const m = shop()
  m.flows = { a: { name: 'A', view: 'shop', steps: [{ from: 'customer', to: 'web', text: 'x' }] }, b: { name: 'B', view: 'shop', steps: [{ from: 'customer', to: 'web', text: 'x' }] } }
  m.folders = { a: 'one/two', b: 'one' }
  const closed = flowList(m, { closed: new Set(['one']) })
  assert.deepEqual(closed.rows.map(r => r.key), ['folder:one'])
  assert.deepEqual(closed.rows.map(r => r.kind === 'folder' && [r.open, r.flows]), [[false, 2]])
  const inner = flowList(m, { closed: new Set(['one/two']) })
  assert.deepEqual(inner.rows.map(r => r.key), ['folder:one', 'folder:one/two', 'flow:b'])
  assert.deepEqual(inner.rows.map(r => r.kind === 'folder' && r.open), [true, false, false])
})

test('flowList: a query keeps the flows whose name, file name, folder or tag has it, opens every folder, and drops the folders with nothing', () => {
  const m = shop()
  const steps = [{ from: 'customer', to: 'web', text: 'x' }]
  m.flows = {
    pay: { name: 'Customer pays', view: 'shop', steps, tags: ['happy path'] },
    refund: { name: 'Money back', view: 'shop', steps, tags: ['Error path'] },
    other: { name: 'Something else', view: 'shop', steps },
  }
  m.folders = { pay: 'billing', refund: 'billing', other: 'misc' }
  const keys = (query: string) => flowList(m, { query, closed: new Set(['billing']) }).rows.map(r => r.key)
  assert.deepEqual(keys('CUSTOMER'), ['folder:billing', 'flow:pay']) // the closed folder opens while a filter is on
  assert.deepEqual(keys('refund'), ['folder:billing', 'flow:refund']) // the file name
  assert.deepEqual(keys('error'), ['folder:billing', 'flow:refund']) // a tag, whatever its case
  assert.deepEqual(keys('misc'), ['folder:misc', 'flow:other']) // the folder
  assert.deepEqual(keys('nothing like it'), [])
  assert.deepEqual(keys('  '), ['folder:billing', 'folder:misc', 'flow:other']) // a blank query is no query, so the closed folder stays closed
  assert.deepEqual([flowList(m, { query: 'customer' }).total, flowList(m, { query: 'customer' }).shown], [3, 1])
})

test('flowList: the tag filter keeps a flow that has any of the tags, whatever their case, and the tags on offer ignore it', () => {
  const m = shop()
  const steps = [{ from: 'customer', to: 'web', text: 'x' }]
  m.flows = {
    a: { name: 'A', view: 'shop', steps, tags: ['happy path', 'recovery'] },
    b: { name: 'B', view: 'shop', steps, tags: ['Error path'] },
    c: { name: 'C', view: 'shop', steps, tags: ['error path', 'happy path'] },
    d: { name: 'D', view: 'shop', steps },
  }
  assert.deepEqual(flowList(m, {}).tags, [{ tag: 'Error path', count: 2 }, { tag: 'happy path', count: 2 }, { tag: 'recovery', count: 1 }]) // most used first, then by name; the first spelling wins
  const picked = flowList(m, { tags: ['ERROR PATH'] })
  assert.deepEqual(picked.rows.map(r => r.key), ['flow:b', 'flow:c'])
  assert.deepEqual(flowList(m, { tags: ['recovery', 'error path'] }).rows.map(r => r.key), ['flow:a', 'flow:b', 'flow:c'])
  assert.deepEqual(picked.tags, flowList(m, {}).tags)
  assert.deepEqual([picked.total, picked.shown], [4, 2])
})

test('flowList: a flow with no steps is listed only while editing, and one whose view cannot open is left out', () => {
  const m = shop()
  m.flows = { empty: { name: 'Empty', view: 'shop', steps: [] }, lost: { name: 'Lost', view: 'nowhere', steps: [{ from: 'customer', to: 'web', text: 'x' }] } }
  assert.deepEqual(flowList(m, {}).rows, [])
  assert.deepEqual(flowList(m, { editing: true }).rows.map(r => r.key), ['flow:empty'])
})

test('flowList: a flow in a pair is linked, one that is tagged by nothing and tags nothing is not', () => {
  const flows = flowList(paired(), {}).rows.flatMap(r => (r.kind === 'flow' ? [[r.flow.id, r.flow.linked]] : []))
  assert.deepEqual(flows, [['a', true], ['b', true], ['c', true], ['d', false], ['e', false]])
})

test('a flow in a pair names the flows it is paired with, one that is in no pair names none', () => {
  const rows = outline(paired(), { expanded: open('shop') }).rows.filter(r => r.kind === 'flow')
  const names = Object.fromEntries(rows.map(r => [r.id, r.partners]))
  assert.deepEqual(names.d, undefined)
  assert.deepEqual(names.a, ['B middle'])
  assert.deepEqual(names.b, ['A oldest', 'C newest']) // the older one it tags first, then the newer one that tags it
  assert.deepEqual(names.c, ['B middle'])
  const list = flowList(paired()).rows.flatMap(r => (r.kind === 'flow' ? [r.flow] : []))
  for (const f of list) assert.equal(f.partners.length > 0, f.linked)
})

test('outline: a flow row says whether it is linked, a shape row does not', () => {
  const rows = outline(paired(), { expanded: open('shop') }).rows
  assert.deepEqual(rows.filter(r => r.kind === 'flow').map(r => [r.id, r.linked]), [['a', true], ['b', true], ['c', true], ['d', false], ['e', false]])
  assert.ok(rows.filter(r => r.kind === 'shape').every(r => r.linked === undefined))
})

const R = (key: string, depth: number, extra: Partial<OutlineRow> = {}): OutlineRow => ({
  key, kind: key.startsWith('flow') ? 'flow' : 'shape', id: key.split(':')[1], depth, name: key, external: false, inside: 0, shapes: 0, flows: 0,
  problem: false, expandable: false, expanded: false, match: true, ...extra,
})
const rows = [
  R('shape:root', 0, { expandable: true, expanded: true }),
  R('shape:a', 1, { expandable: true }),
  R('shape:b', 1, { expandable: true, expanded: true }),
  R('shape:c', 2),
  R('flow:f', 2),
  R('shape:d', 1),
]

test('keys: arrows and Home and End move, and stop at the ends', () => {
  const at = (focus: string | undefined, key: Parameters<typeof outlineKey>[2]) => outlineKey(rows, focus, key).focus
  assert.equal(at('shape:b', 'ArrowDown'), 'shape:c')
  assert.equal(at('shape:d', 'ArrowDown'), 'shape:d')
  assert.equal(at('shape:b', 'ArrowUp'), 'shape:a')
  assert.equal(at('shape:root', 'ArrowUp'), 'shape:root')
  assert.equal(at('shape:c', 'Home'), 'shape:root')
  assert.equal(at('shape:c', 'End'), 'shape:d')
  assert.equal(at(undefined, 'ArrowDown'), 'shape:root')
  assert.equal(at('shape:gone', 'ArrowUp'), 'shape:root')
  assert.equal(at(undefined, 'End'), 'shape:d')
  assert.deepEqual(outlineKey([], undefined, 'ArrowDown'), {})
})

test('keys: right opens a closed shape, then steps in; left closes an open one, then steps out', () => {
  assert.deepEqual(outlineKey(rows, 'shape:a', 'ArrowRight'), { focus: 'shape:a', toggle: { id: 'a', expand: true } })
  assert.deepEqual(outlineKey(rows, 'shape:b', 'ArrowRight'), { focus: 'shape:c' })
  assert.deepEqual(outlineKey(rows, 'shape:d', 'ArrowRight'), { focus: 'shape:d' })
  assert.deepEqual(outlineKey(rows, 'shape:b', 'ArrowLeft'), { focus: 'shape:b', toggle: { id: 'b', expand: false } })
  assert.deepEqual(outlineKey(rows, 'shape:c', 'ArrowLeft'), { focus: 'shape:b' })
  assert.deepEqual(outlineKey(rows, 'flow:f', 'ArrowLeft'), { focus: 'shape:b' })
  assert.deepEqual(outlineKey(rows, 'shape:a', 'ArrowLeft'), { focus: 'shape:root' })
  assert.deepEqual(outlineKey([R('shape:solo', 0)], 'shape:solo', 'ArrowLeft'), { focus: 'shape:solo' })
})

test('keys: Enter asks for the row to be opened', () => {
  assert.deepEqual(outlineKey(rows, 'flow:f', 'Enter'), { focus: 'flow:f', open: rows[4] })
})

test('a shape row says how many shapes are right inside it, as the canvas does, and the tooltip gives the rest', () => {
  const rows = outline(shop(), { expanded: open('shop', 'api') }).rows
  const by = (key: string) => rows.find(r => r.key === key)!
  assert.equal(rowCount(by('shape:shop')), '3 inside · 1 flow')
  assert.equal(rowCountWords(by('shape:shop')), '3 inside, 5 in all, 1 flow')
  assert.equal(rowCount(by('shape:api')), '2 inside')
  assert.equal(rowCountWords(by('shape:api')), '2 inside') // every shape in it is right inside: nothing more to say
  assert.equal(rowCount(by('shape:customer')), '')
  assert.equal(rowCount(rows.find(r => r.kind === 'flow')!), '')
})

test('comparedWith names the partners, or says Compare pair when it has none to name', () => {
  assert.equal(comparedWith(['The refund is not recorded']), 'Compared with The refund is not recorded')
  assert.equal(comparedWith(['A', 'B']), 'Compared with A, B')
  assert.equal(comparedWith([]), 'Compare pair')
})
