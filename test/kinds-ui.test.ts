import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headScale } from '../src/core/heads.ts'
import { KINDS, PLAIN_LOOK } from '../src/core/kinds.ts'
import type { Model } from '../src/core/model.ts'
import { toGraph } from '../ui/src/graph.ts'
import { kindsOnScreen, LANE_MARK_SCALE, marksOf, markScale } from '../ui/src/kindkey.ts'
import { shop } from './fixtures.ts'

/** The shop with the given connections between the web app and the API. */
const pair = (...connections: Record<string, unknown>[]): Model => ({
  ...shop(),
  connections: connections.map(c => ({ from: 'web', to: 'api', ...c })) as Model['connections'],
})

const line = (model: Model) => toGraph(model, 'shop').edges.find(e => e.source === 'web' && e.target === 'api')!

test('a model with no kinds hands the canvas the same lines as before: no look in their data', () => {
  for (const e of toGraph(shop(), 'shop').edges) assert.equal(e.data?.look, undefined, e.id)
})

test('a line takes the look of its connections, and its accessible name ends with the kind', () => {
  const stream = line(pair({ label: 'Start scan', kind: 'stream' }))
  assert.deepEqual(stream.data?.look, KINDS.stream.look)
  assert.equal(stream.ariaLabel, 'Web app to API, Start scan, Request then stream')
  const plain = line(pair({ label: 'Start scan' }))
  assert.equal(plain.data?.look, undefined)
  assert.equal(plain.ariaLabel, 'Web app to API, Start scan')
})

test('a mixed line is drawn plain and names no kind; connections of one kind both ways keep the look', () => {
  const mixed = line(pair({ kind: 'request' }, { kind: 'publish' }))
  assert.equal(mixed.data?.look, undefined)
  assert.equal(mixed.ariaLabel, 'Web app to API, 2 connections')
  const bothWays = toGraph(pair({ kind: 'extension' }, { kind: 'extension', from: 'api', to: 'web' }), 'shop').edges.find(e => e.source === 'web')!
  assert.equal(bothWays.data?.both, true)
  assert.deepEqual(bothWays.data?.look, KINDS.extension.look)
})

test('the key lists the kinds drawn now, in the order of the list, and the plain line only when one is drawn too', () => {
  const alone = toGraph(pair({ kind: 'cached' }), 'shop').edges
  assert.deepEqual(kindsOnScreen(alone), { kinds: ['cached'], plain: false, stacked: false, inUse: false })
  const beside = toGraph(pair({ kind: 'cached' }, { from: 'api', to: 'db' }), 'shop').edges
  assert.deepEqual(kindsOnScreen(beside), { kinds: ['cached'], plain: true, stacked: false, inUse: false })
  const everyKind = {
    ...shop(),
    connections: [
      { from: 'web', to: 'api', kind: 'extension' }, { from: 'api', to: 'db', kind: 'object' }, { from: 'customer', to: 'web', kind: 'request' },
      { from: 'api', to: 'mail', kind: 'publish' },
    ],
  } as Model
  assert.deepEqual(kindsOnScreen(toGraph(everyKind, 'shop').edges), { kinds: ['request', 'publish', 'object', 'extension'], plain: false, stacked: false, inUse: false })
  assert.deepEqual(kindsOnScreen(toGraph(shop(), 'shop').edges), { kinds: [], plain: true, stacked: false, inUse: false })
})

test('a step line is not a connection: it does not put the plain line in the key', () => {
  assert.deepEqual(kindsOnScreen([{ id: 'step' }, { id: 'lane-2' }, { id: 'a|b', data: { look: KINDS.stream.look } }]), { kinds: ['stream'], plain: false, stacked: false, inUse: false })
})

test('the marks of a line: the kind head on the end, the tail on the start, and no tail when the line runs both ways', () => {
  assert.deepEqual(marksOf(undefined, false), { head: 'filled', headAtStart: false, tail: undefined })
  assert.deepEqual(marksOf(undefined, true), { head: 'filled', headAtStart: true, tail: undefined })
  assert.deepEqual(marksOf(PLAIN_LOOK, false), { head: 'filled', headAtStart: false, tail: undefined })
  assert.deepEqual(marksOf(KINDS.request.look, false), { head: 'filled', headAtStart: false, tail: 'open' })
  assert.deepEqual(marksOf(KINDS.cached.look, false), { head: 'open', headAtStart: false, tail: 'ring' })
  assert.deepEqual(marksOf(KINDS.object.look, true), { head: 'open', headAtStart: true, tail: undefined })
})

test('one of several lines side by side wears marks no bigger than 1.2, a lone line the scale of its width', () => {
  assert.equal(LANE_MARK_SCALE, 1.2)
  assert.equal(markScale(1.55, 1), 1.55)
  assert.equal(markScale(1.55, 3), 1.2)
  assert.equal(markScale(1, 3), 1)
})

test('traffic that widens a line past the cap is held to 1.2 only on one of several lines, as the desktop holds it', () => {
  const full = headScale(6) // the thickest a load makes a line
  assert.ok(full > LANE_MARK_SCALE)
  assert.equal(markScale(full, 3), LANE_MARK_SCALE)
  assert.equal(markScale(full, 1), full)
  assert.equal(markScale(headScale(1.5), 3), 1) // no load: the usual head, under the cap
})
