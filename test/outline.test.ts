import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expandTo, flowGroups, outline, outlineKey } from '../src/core/outline.ts'
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

test('flowGroups: the flows here, and every other flow under the view it plays in, with its path', () => {
  const m = shop()
  m.flows.tour = { name: 'A tour', view: ROOT, steps: [{ from: 'customer', to: 'shop', text: 'x' }] }
  m.flows.inner = { name: '', view: 'api', steps: [{ from: 'auth', to: 'orders', text: 'x' }] }
  const inShop = flowGroups(m, 'shop')
  assert.deepEqual(inShop.here.map(f => f.id), ['checkout'])
  assert.deepEqual(inShop.elsewhere.map(g => [g.view, g.name, g.path, g.flows.map(f => f.name)]), [
    [ROOT, 'Overview', [], ['A tour']],
    ['api', 'API', ['Shop', 'API'], ['inner']], // a flow with no name is shown by its id
  ])
  assert.equal(inShop.total, 3)
  const top = flowGroups(m, ROOT)
  assert.deepEqual(top.here.map(f => f.id), ['tour'])
  assert.deepEqual(top.elsewhere.map(g => g.view), ['shop', 'api'])
  assert.deepEqual(flowGroups(m, 'customer').here, [])
  assert.deepEqual(flowGroups({ ...shop(), flows: {} }, ROOT), { here: [], elsewhere: [], total: 0 })
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

test('flowGroups: a flow in a pair is linked, one that is tagged by nothing and tags nothing is not', () => {
  const { here } = flowGroups(paired(), 'shop')
  assert.deepEqual(here.map(f => [f.id, f.linked]), [['a', true], ['b', true], ['c', true], ['d', false], ['e', false]])
})

test('flowGroups: a newer flow is listed right after its older partner, and a chain lists oldest first', () => {
  const m = paired()
  m.flows.a.name = 'Z oldest'
  m.flows.d.name = 'A first'
  // By name alone: A first, B middle, C newest, E alone, Z oldest. The chain moves together, oldest first, to where its first member sorts.
  assert.deepEqual(flowGroups(m, 'shop').here.map(f => f.id), ['d', 'a', 'b', 'c', 'e'])
})

test('flowGroups: a flow tagged by many lists them after it in key order, and a mutual pair lists once each', () => {
  const m = paired()
  m.flows.c.compare = 'a' // b and c both tag a
  assert.deepEqual(flowGroups(m, 'shop').here.map(f => f.id), ['a', 'c', 'b', 'd', 'e'], 'c comes before b in the keys')
  m.flows.c.compare = 'b'
  m.flows.a.compare = 'b' // a and b tag each other
  assert.deepEqual(flowGroups(m, 'shop').here.map(f => f.id), ['a', 'b', 'c', 'd', 'e'])
})

test('flowGroups: flows with no links keep their order exactly', () => {
  const m = paired()
  delete m.flows.b.compare
  delete m.flows.c.compare
  assert.deepEqual(flowGroups(m, 'shop').here.map(f => f.id), ['a', 'b', 'c', 'd', 'e'])
  assert.ok(flowGroups(m, 'shop').here.every(f => !f.linked))
})

test('flowGroups: partners on different views stay in their own groups, each marked linked', () => {
  const m = paired()
  m.flows.c.view = 'api'
  const groups = flowGroups(m, 'shop')
  assert.deepEqual(groups.here.map(f => f.id), ['a', 'b', 'd', 'e'])
  assert.deepEqual(groups.elsewhere.map(g => [g.view, g.flows.map(f => [f.id, f.linked])]), [['api', [['c', true]]]])
  assert.equal(groups.here.find(f => f.id === 'b')!.linked, true)
})

test('flowGroups: a tag to itself or to a flow that is not there links nothing', () => {
  const m = paired()
  m.flows.d.compare = 'd'
  m.flows.e.compare = 'gone'
  const here = flowGroups(m, 'shop').here
  assert.deepEqual(here.map(f => [f.id, f.linked]), [['a', true], ['b', true], ['c', true], ['d', false], ['e', false]])
})

test('outline: a flow row says whether it is linked, a shape row does not', () => {
  const rows = outline(paired(), { expanded: open('shop') }).rows
  assert.deepEqual(rows.filter(r => r.kind === 'flow').map(r => [r.id, r.linked]), [['a', true], ['b', true], ['c', true], ['d', false], ['e', false]])
  assert.ok(rows.filter(r => r.kind === 'shape').every(r => r.linked === undefined))
})

const R = (key: string, depth: number, extra: Partial<OutlineRow> = {}): OutlineRow => ({
  key, kind: key.startsWith('flow') ? 'flow' : 'shape', id: key.split(':')[1], depth, name: key, external: false, shapes: 0, flows: 0,
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
