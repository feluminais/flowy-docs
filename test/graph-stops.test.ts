import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStepLine, toGraph } from '../ui/src/graph.ts'
import { shop } from './fixtures.ts'

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(i => [i.id, i]))

test('a shape that takes a request off the line is lit with the step', () => {
  const { nodes } = toGraph(shop(), 'shop', { ends: [['web', 'api']], steps: [0], also: ['db'] })
  const box = byId(nodes)
  assert.equal(box.db.className, 'lit')
  assert.equal(box.mail.className, 'outsider dim')
})

test('a stop of several steps lights every step\'s boxes and lines, and dims the rest', () => {
  const { nodes, edges } = toGraph(shop(), 'shop', { ends: [['web', 'api'], ['api', 'db'], ['api', 'mail']], steps: [0, 1] })
  const box = byId(nodes)
  assert.equal(box.web.className, 'lit')
  assert.equal(box.api.className, 'lit')
  assert.equal(box.db.className, 'lit')
  assert.equal(box.mail.className, 'outsider dim')
  const line = byId(edges)
  assert.equal(line['api web'].className, 'active')
  assert.equal(line['api db'].className, 'active')
  assert.equal(line['api mail'].className, 'dim')
})

test('a lit step with no line of its own gets a dashed one, and each gets an id the click handler can tell from a connection', () => {
  const { edges } = toGraph(shop(), 'shop', { ends: [['web', 'db'], ['mail', 'db']], steps: [0, 1] })
  const drawn = edges.filter(e => isStepLine(e.id))
  assert.deepEqual(drawn.map(e => [e.id, e.source, e.target, e.className]), [['step', 'web', 'db', 'step'], ['step-1', 'mail', 'db', 'step']])
  assert.equal(isStepLine('web api'), false)
  assert.equal(isStepLine('step api'), false)
  assert.equal(isStepLine('step-12'), true)
})

test('the steps of the other lanes are drawn faint and dashed, and their boxes stay dim', () => {
  const { nodes, edges } = toGraph(shop(), 'shop', { ends: [['web', 'api'], ['api', 'mail'], ['web', 'db']], steps: [0], faint: [1, 2] })
  const line = byId(edges)
  assert.equal(line['api web'].className, 'active')
  assert.equal(line['api mail'].className, 'lane')
  const extra = edges.find(e => e.id === 'lane-2')!
  assert.deepEqual([extra.source, extra.target, extra.className], ['web', 'db', 'lane'])
  assert.equal(byId(nodes).mail.className, 'outsider dim')
})

test('a step the view cannot show is skipped, and a single step behaves as it always did', () => {
  const { nodes } = toGraph(shop(), 'shop', { ends: [null, ['web', 'api']], steps: [0, 1] })
  assert.equal(byId(nodes).web.className, 'lit')
  const one = toGraph(shop(), 'shop', { ends: [['web', 'api']], step: 0 })
  const same = toGraph(shop(), 'shop', { ends: [['web', 'api']], steps: [0] })
  assert.deepEqual(same, one)
})
