import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOX, toGraph } from '../ui/src/graph.ts'
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
