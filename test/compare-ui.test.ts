import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import type { Flow } from '../src/core/model.ts'
import type { Run } from '../src/core/perf/types.ts'
import { choicesFor, compareOff, firstLinked, flipped, fromAddress, orderPair, pairOf, playable, samePick } from '../ui/src/compare.ts'
import type { Compare } from '../ui/src/compare.ts'

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

const plays = (name: string, compare?: unknown): Flow => ({ ...flow(name, compare), steps: [{ from: 'a', to: 'b', text: 'Go' }] })

test('a flow plays when it has steps and its view opens', () => {
  const model = modelOf({ ok: plays('Ok'), empty: flow('Empty'), lost: { ...plays('Lost'), view: 'nowhere' } })
  assert.equal(playable(model, 'ok'), true)
  assert.equal(playable(model, 'empty'), false)
  assert.equal(playable(model, 'lost'), false)
  assert.equal(playable(model, 'missing'), false)
  assert.equal(playable(model, '__proto__'), false, 'a key the object inherits is no flow')
})

test('Compare is blocked while editing and with no other flow, and the reason is the tooltip', () => {
  const two = modelOf({ a: plays('A'), b: plays('B') })
  assert.equal(compareOff(two, false), undefined)
  assert.equal(compareOff(two, true), 'Not while editing')
  assert.equal(compareOff(modelOf({ a: plays('A') }), false), 'No other flow')
  assert.equal(compareOff(modelOf({ a: plays('A') }), true), 'Not while editing', 'editing is the first reason')
})

test('C offers the first linked flow that is there, else nothing', () => {
  const model = modelOf({ old: plays('Old'), now: plays('Now', 'old'), later: plays('Later', 'now'), alone: plays('Alone') })
  assert.equal(firstLinked(model, 'now'), 'old')
  assert.equal(firstLinked(model, 'old'), 'now')
  assert.equal(firstLinked(model, 'alone'), undefined, 'not linked: the picker opens instead')
  assert.equal(firstLinked(modelOf({ a: plays('A', 'gone'), b: plays('B', 'a') }), 'a'), 'b', 'a missing tag is skipped')
  assert.equal(firstLinked(modelOf({ a: plays('A', 'gone') }), 'a'), undefined)
})

test('the pick is ordered so the holder of the tag is second', () => {
  const model = modelOf({ old: plays('Old'), now: plays('Now', 'old'), other: plays('Other') })
  assert.deepEqual(pairOf(model, 'now', 'old'), { kind: 'flow', a: 'old', b: 'now', mode: 'side' })
  assert.deepEqual(pairOf(model, 'other', 'old'), { kind: 'flow', a: 'other', b: 'old', mode: 'side' })
  assert.deepEqual(pairOf(model, 'now', 'now'), { kind: 'flow', a: 'now', b: 'now', mode: 'side' }, 'a flow with itself still draws both panes')
})

test('an address opens a comparison of two flows that play, side by side', () => {
  const model = modelOf({ a: plays('A'), b: plays('B'), empty: flow('Empty') })
  const named = (a: string, b: string, mode: Compare['mode'] = 'side', kind: Compare['kind'] = 'flow'): Compare => ({ kind, a, b, mode })
  assert.deepEqual(fromAddress(model, named('a', 'b')), { compare: named('a', 'b') })
  assert.deepEqual(fromAddress(model, named('a', 'b', 'swap')), { compare: named('a', 'b') }, 'Swap is not built yet')
  assert.deepEqual(fromAddress(model, named('a', 'a')), { compare: named('a', 'a') })
  assert.deepEqual(fromAddress(model, named('a', 'empty')), { unplayable: true })
  assert.deepEqual(fromAddress(model, named('a', 'gone')), { unplayable: true })
  assert.deepEqual(fromAddress(model, named('a', 'b', 'side', 'run')), {}, 'runs are not flows')
  assert.deepEqual(fromAddress(model, undefined), {})
})

test('the two sides swap places and nothing else changes', () => {
  assert.deepEqual(flipped({ kind: 'flow', a: 'x', b: 'y', mode: 'side' }), { kind: 'flow', a: 'y', b: 'x', mode: 'side' })
})

test('a click on what the panel already shows is the same pick', () => {
  assert.equal(samePick({ kind: 'object', id: 'db' }, { kind: 'object', id: 'db' }), true)
  assert.equal(samePick({ kind: 'object', id: 'db' }, { kind: 'object', id: 'api' }), false)
  assert.equal(samePick({ kind: 'line', from: 'a', to: 'b', view: 'root' }, { kind: 'line', from: 'a', to: 'b', view: 'root' }), true)
  assert.equal(samePick({ kind: 'line', from: 'a', to: 'b', view: 'root' }, { kind: 'line', from: 'a', to: 'b', view: 'shop' }), false, 'the same ends in another view are another line')
  assert.equal(samePick({ kind: 'line', from: 'a', to: 'b' }, { kind: 'line', from: 'a', to: 'b', view: 'root' }), false)
  assert.equal(samePick({ kind: 'add' }, { kind: 'object', id: 'db' }), false)
  assert.equal(samePick(undefined, { kind: 'object', id: 'db' }), false)
})
