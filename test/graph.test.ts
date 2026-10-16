import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { BOX, fitOptions, focusEdges, lineEnds, panIntoView, PANEL, toGraph } from '../ui/src/graph.ts'
import { shop } from './fixtures.ts'

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(i => [i.id, i]))

test('a view becomes boxes and lines, with outsiders marked', () => {
  const { nodes, edges } = toGraph(shop(), 'shop')
  assert.deepEqual(nodes.map(n => [n.id, n.className]), [
    ['web', undefined], ['api', undefined], ['db', undefined], ['customer', 'outsider'], ['mail', 'outsider'],
  ])
  assert.deepEqual(edges.map(e => [e.source, e.target, e.label]), [
    ['customer', 'web', 'browses'], ['web', 'api', 'REST'], ['api', 'db', '2 connections'], ['api', 'mail', 'sends receipts'],
  ])
  assert.equal(byId(nodes).api.data.zoomable, true)
  assert.equal(byId(nodes).db.data.zoomable, false)
})

test('dagre places boxes without overlaps, and a layout.yaml position wins', () => {
  const placed = toGraph(shop(), 'shop').nodes
  for (const a of placed) for (const b of placed) if (a !== b)
    assert.ok(Math.abs(a.position.x - b.position.x) >= BOX.width || Math.abs(a.position.y - b.position.y) >= BOX.height, `${a.id} overlaps ${b.id}`)
  const model = { ...shop(), layout: { shop: { web: [5, 7] as [number, number] } } }
  assert.deepEqual(byId(toGraph(model, 'shop').nodes).web.position, { x: 5, y: 7 })
})

test('a playing step lights its two boxes and its line, and dims the rest', () => {
  const { nodes, edges } = toGraph(shop(), 'shop', { ends: [['web', 'api']], step: 0 })
  assert.deepEqual(nodes.filter(n => !n.className?.includes('dim')).map(n => n.id), ['web', 'api'])
  assert.equal(byId(nodes).customer.className, 'outsider dim')
  assert.deepEqual(edges.map(e => [e.id, e.className]), [
    ['customer web', 'dim'], ['web api', 'active'], ['api db', 'dim'], ['api mail', 'dim'],
  ])
})

test('a step with no line of its own gets a dashed one, and an unshowable step dims everything', () => {
  const back = toGraph(shop(), 'shop', { ends: [['api', 'web']], step: 0 }).edges.at(-1)
  assert.deepEqual([back?.id, back?.source, back?.target, back?.className], ['step', 'api', 'web', 'step'])
  const { nodes, edges } = toGraph(shop(), 'shop', { ends: [null], step: 0 })
  assert.ok([...nodes, ...edges].every(item => item.className?.includes('dim')))
})

test('a box only the flow uses joins as an outsider for the whole flow', () => {
  const ends: [string, string][] = [['web', 'auth'], ['auth', 'db']]
  assert.equal(byId(toGraph(shop(), 'api').nodes).web, undefined)
  const first = toGraph(shop(), 'api', { ends, step: 0 })
  assert.equal(byId(first.nodes).web.className, 'outsider')
  assert.deepEqual(first.edges.at(-1)?.id, 'step')
  const second = toGraph(shop(), 'api', { ends, step: 1 })
  assert.equal(byId(second.nodes).web.className, 'outsider dim')
  assert.deepEqual(byId(second.nodes).web.position, byId(first.nodes).web.position)
})

test('a flow without a current step brings its boxes but dims nothing', () => {
  const { nodes, edges } = toGraph(shop(), 'api', { ends: [['web', 'auth']] })
  assert.equal(byId(nodes).web.className, 'outsider')
  assert.ok([...nodes, ...edges].every(item => !item.className?.includes('dim')))
  assert.equal(edges.some(e => e.id === 'step'), false)
})

test('a box dagre places never covers a saved one', () => {
  const free = byId(toGraph(shop(), 'shop').nodes)
  const model = { ...shop(), layout: { shop: { web: [free.api.position.x, free.api.position.y] as [number, number] } } }
  const placed = toGraph(model, 'shop').nodes
  for (const a of placed) for (const b of placed) if (a !== b)
    assert.ok(Math.abs(a.position.x - b.position.x) >= BOX.width || Math.abs(a.position.y - b.position.y) >= BOX.height, `${a.id} overlaps ${b.id}`)
})

test('boxes and lines with problems are marked', () => {
  const m = shop()
  m.objects.db.name = ''
  m.connections.push({ from: 'auth', to: 'db', label: 'checks users' })
  const problems = check(m)
  const { nodes, edges } = toGraph(m, 'shop', undefined, problems)
  assert.deepEqual(nodes.filter(n => n.className?.includes('problem')).map(n => n.id), ['db'])
  assert.deepEqual(edges.filter(e => e.className?.includes('problem')).map(e => e.id), ['api db'])
})

/** An app with two boxes inside, one person using it and `n` systems it calls: one hub with many neighbours. */
function hub(n: number): Model {
  const m = emptyModel()
  m.objects = {
    app: { type: 'system', name: 'App' },
    hub: { type: 'app', in: 'app', name: 'Hub' },
    store: { type: 'store', in: 'app', name: 'Store' },
    user: { type: 'actor', name: 'User' },
  }
  m.connections = [{ from: 'user', to: 'hub' }, { from: 'hub', to: 'store' }]
  for (let i = 0; i < n; i++) {
    m.objects[`ext${i}`] = { type: 'system', name: `Ext ${i}` }
    m.connections.push({ from: 'hub', to: `ext${i}`, label: `calls ${i}` })
  }
  return m
}

test('inside a box the members sit together, people wait above, and the rest split to the two sides', () => {
  const nodes = byId(toGraph(hub(8), 'app').nodes)
  const members = [nodes.hub, nodes.store].map(n => n.position)
  const left = Math.min(...members.map(p => p.x))
  const right = Math.max(...members.map(p => p.x)) + BOX.width
  assert.ok(nodes.user.position.y + BOX.height <= Math.min(...members.map(p => p.y)), 'the user is above the members')
  const systems = Object.values(nodes).filter(n => n.id.startsWith('ext')).map(n => n.position)
  assert.equal(systems.filter(p => p.x + BOX.width <= left).length, 4)
  assert.equal(systems.filter(p => p.x >= right).length, 4)
  const all = Object.values(nodes).map(n => n.position)
  assert.ok(Math.max(...all.map(p => p.x)) + BOX.width - Math.min(...all.map(p => p.x)) < 5 * BOX.width, 'not one wide row')
})

test('boxes arranged around the members never overlap', () => {
  for (const [model, view] of [[hub(8), 'app'], [hub(1), 'app'], [shop(), 'shop'], [shop(), 'api']] as const) {
    const placed = toGraph(model, view).nodes
    for (const a of placed) for (const b of placed) if (a !== b)
      assert.ok(Math.abs(a.position.x - b.position.x) >= BOX.width || Math.abs(a.position.y - b.position.y) >= BOX.height, `${view}: ${a.id} overlaps ${b.id}`)
  }
})

test('lines show a label only for the selected box, the selected or pointed-at line, and a lit step', () => {
  const { edges } = toGraph(shop(), 'shop', { ends: [['web', 'api']], step: 0 })
  const labels = (focus: Parameters<typeof focusEdges>[1]) => focusEdges(edges, focus).filter(e => e.label).map(e => e.id)
  assert.deepEqual(labels({}), ['web api'], 'only the lit line')
  assert.deepEqual(focusEdges(toGraph(shop(), 'shop').edges, {}).filter(e => e.label), [], 'a quiet view has no labels')
  const quiet = toGraph(shop(), 'shop').edges
  const shown = (focus: Parameters<typeof focusEdges>[1]) => focusEdges(quiet, focus).filter(e => e.label).map(e => e.id)
  assert.deepEqual(shown({ box: 'api' }), ['web api', 'api db', 'api mail'])
  assert.deepEqual(shown({ line: 'customer web' }), ['customer web'])
  assert.deepEqual(shown({ hover: 'api db' }), ['api db'])
  assert.equal(focusEdges(quiet, { line: 'api db' }).find(e => e.selected)?.id, 'api db')
})

test('selecting a box fades the lines that do not touch it', () => {
  const quiet = toGraph(shop(), 'shop').edges
  assert.deepEqual(focusEdges(quiet, { box: 'api' }).filter(e => e.className === 'faint').map(e => e.id), ['customer web'])
  assert.ok(focusEdges(quiet, {}).every(e => e.className === undefined))
})

test('a line runs between the borders of two boxes that face each other', () => {
  const a = { x: 0, y: 0, width: 180, height: 72 }
  assert.deepEqual(lineEnds(a, { ...a, x: 400 }), [{ x: 180, y: 36 }, { x: 400, y: 36 }])
  assert.deepEqual(lineEnds(a, { ...a, y: 200 }), [{ x: 90, y: 72 }, { x: 90, y: 200 }])
  const [from, to] = lineEnds(a, { ...a, x: 100, y: 200 })
  assert.ok(from.y === 72 && to.y === 200, 'leaves the bottom, enters the top')
  assert.deepEqual(lineEnds(a, a), [{ x: 90, y: 36 }, { x: 90, y: 36 }])
})

test('the view pans only as far as it takes to show a box beside the side panel', () => {
  const size = { width: 1280, height: 800 }
  const view = { x: 0, y: 0, zoom: 1 }
  const box = { x: 100, y: 100, width: 180, height: 72 }
  assert.equal(panIntoView(box, view, size), undefined, 'already in the open part')
  const hidden = panIntoView({ ...box, x: 1000 }, view, size)
  assert.deepEqual(hidden && [hidden.x, hidden.zoom], [size.width - PANEL - 24 - 1180, 1], 'its right edge ends 24px left of the panel')
  assert.deepEqual(panIntoView({ ...box, x: -50 }, view, size), { x: 74, y: 0, zoom: 1 })
  assert.deepEqual(panIntoView({ ...box, y: 780 }, view, size), { x: 0, y: -(780 + 72 + 24 - 800), zoom: 1 })
  assert.equal(panIntoView({ ...box, width: 2000 }, view, size)?.x, 24 - 100, 'a box wider than the room keeps its left edge in sight')
})

test('the fit leaves room for the side panel and the flow player only when they are open', () => {
  assert.deepEqual(fitOptions(false, false).padding, { top: '40px', left: '40px', right: '40px', bottom: '40px' })
  assert.deepEqual(fitOptions(true, true).padding, { top: '40px', left: '40px', right: `${PANEL + 40}px`, bottom: '200px' })
})
