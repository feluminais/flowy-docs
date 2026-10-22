import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import type { Flow } from '../src/core/model.ts'
import type { Run } from '../src/core/perf/types.ts'
import { choicesFor, orderPair } from '../ui/src/compare.ts'

const flow = (name: string, compare?: unknown): Flow => ({ name, view: 'root', steps: [], ...(compare === undefined ? {} : { compare }) })
const run = (name: string, compare?: Run['compare']): Run => ({ name, unit: 'req/s', levels: [], ...(compare === undefined ? {} : { compare }) })
const modelOf = (flows: Record<string, Flow>) => ({ ...emptyModel(), flows })

test('choices for a flow list what it tags first, then what tags it, then the rest by name', () => {
  const model = modelOf({
    old: flow('Refund, old'),
    now: flow('Refund, now', 'old'),
    later: flow('Refund, later', { with: 'now', note: 'x' }),
    beta: flow('beta'),
    Alpha: flow('Alpha'),
    zed: flow('Zed'),
  })
  const { linked, others } = choicesFor(model, {}, 'flow', 'now')
  assert.deepEqual(linked, [{ id: 'old', name: 'Refund, old', side: 'before' }, { id: 'later', name: 'Refund, later', side: 'after' }])
  assert.deepEqual(others.map(c => c.id), ['Alpha', 'beta', 'zed'], 'by name, ignoring case')
  assert.ok(others.every(c => c.side === undefined && c.missing === undefined))
})

test('the id itself is never listed, even when it tags itself', () => {
  const model = modelOf({ a: flow('A', 'a'), b: flow('B') })
  const { linked, others } = choicesFor(model, {}, 'flow', 'a')
  assert.deepEqual(linked, [])
  assert.deepEqual(others, [{ id: 'b', name: 'B' }])
})

test('a tag to a flow that is not there stays, marked missing, with the id as its name', () => {
  const model = modelOf({ a: flow('A', 'gone'), b: flow('B') })
  const { linked, others } = choicesFor(model, {}, 'flow', 'a')
  assert.deepEqual(linked, [{ id: 'gone', name: 'gone', side: 'before', missing: true }])
  assert.deepEqual(others.map(c => c.id), ['b'])
})

test('a pair that tag each other lists once, and a flow tagged by many lists them all', () => {
  const mutual = modelOf({ a: flow('A', 'b'), b: flow('B', 'a') })
  assert.deepEqual(choicesFor(mutual, {}, 'flow', 'a').linked, [{ id: 'b', name: 'B', side: 'before' }])
  const many = modelOf({ base: flow('Base'), x: flow('X', 'base'), y: flow('Y', 'base'), z: flow('Z', 'base') })
  assert.deepEqual(choicesFor(many, {}, 'flow', 'base').linked.map(c => c.id), ['x', 'y', 'z'])
  assert.deepEqual(choicesFor(many, {}, 'flow', 'base').others, [])
})

test('choices for a run read the runs, not the flows, and fall back to the id for a name', () => {
  const model = modelOf({ f: flow('F') })
  const runs = { slow: run('Slow gateway'), fast: run('Fast gateway', { with: 'slow' }), plain: run('Plain'), nameless: { ...run(''), name: undefined as unknown as string } }
  const { linked, others } = choicesFor(model, runs, 'run', 'slow')
  assert.deepEqual(linked, [{ id: 'fast', name: 'Fast gateway', side: 'after' }])
  assert.deepEqual(others, [{ id: 'nameless', name: 'nameless' }, { id: 'plain', name: 'Plain' }])
  assert.deepEqual(choicesFor(model, runs, 'flow', 'f'), { linked: [], others: [] })
})

test('the pair is ordered so the holder of the tag is second', () => {
  const flows = { old: flow('Old'), now: flow('Now', 'old'), other: flow('Other') }
  assert.deepEqual(orderPair('flow', flows, 'now', 'old'), ['old', 'now'])
  assert.deepEqual(orderPair('flow', flows, 'old', 'now'), ['old', 'now'])
  assert.deepEqual(orderPair('flow', flows, 'other', 'old'), ['other', 'old'], 'no tag between them: as given')
  assert.deepEqual(orderPair('flow', flows, 'old', 'other'), ['old', 'other'])
  const mutual = { a: flow('A', 'b'), b: flow('B', 'a') }
  assert.deepEqual(orderPair('flow', mutual, 'a', 'b'), ['b', 'a'], 'a tags b: a is second')
  assert.deepEqual(orderPair('run', { r1: run('R1'), r2: run('R2', { with: 'r1' }) }, 'r2', 'r1'), ['r1', 'r2'])
  assert.deepEqual(orderPair('flow', flows, 'now', 'now'), ['now', 'now'])
})
