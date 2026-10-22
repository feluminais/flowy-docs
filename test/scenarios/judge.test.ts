import { test } from 'node:test'
import assert from 'node:assert/strict'
import { OpError, putObject } from '../../src/core/ops.ts'
import { shop } from '../fixtures.ts'
import type { Maker } from './moves.ts'
import { play } from './play.ts'
import type { Fixture } from './play.ts'

/** A fuzzer that finds nothing is only worth something if it would find something. These plant one bug at a time in an op and expect the judge to name it. */
const fixture: Fixture = { name: 'Shop', model: shop(), runs: {} }

const rulesFound = (maker: Maker) => new Set(play(fixture, 1, 6, { planted: maker }).findings.map(f => `${f.rule}:${f.op}`))

test('an op that throws something other than a refusal is a crash', () => {
  const found = rulesFound(() => ({ op: 'bad', label: 'bad', run: () => { throw new TypeError('x is undefined') } }))
  assert.ok(found.has('crash:bad'))
})

test('a refusal with no words is named', () => {
  const found = rulesFound(() => ({ op: 'bad', label: 'bad', run: () => { throw new OpError('') } }))
  assert.ok(found.has('empty-refusal:bad'))
})

test('an op that changes the model it was given is named, accepted or refused', () => {
  const accepted = rulesFound(() => ({ op: 'bad', label: 'bad', run: model => { model.objects.mail.name = 'Changed'; return { ...model } } }))
  assert.ok(accepted.has('mutated-input:bad'))
  const refused = rulesFound(() => ({ op: 'bad', label: 'bad', run: model => { model.connections.pop(); throw new OpError('no') } }))
  assert.ok(refused.has('mutated-input:bad'))
})

test('an accepted op that did not do what it is for is named', () => {
  const found = rulesFound(() => ({ op: 'bad', label: 'bad', run: model => model, expect: () => 'nothing happened' }))
  assert.ok(found.has('postcondition:bad'))
})

test('an op that leaves a load-test run pointing at nothing is named', () => {
  const run = { levels: [{ load: 1, overall: {}, objects: { mail: {} }, connections: [] }] } as unknown as Fixture['runs'][string]
  const withRun: Fixture = { ...fixture, runs: { quiet: run } }
  const drop: Maker = () => ({ op: 'bad', label: 'bad', run: model => {
    const { mail: _, ...objects } = model.objects
    return { ...model, objects, connections: model.connections.filter(c => c.from !== 'mail' && c.to !== 'mail') }
  } })
  const found = new Set(play(withRun, 1, 6, { planted: drop }).findings.map(f => `${f.rule}:${f.op}`))
  assert.ok(found.has('run-dangling:bad'))
})

test('an op that is fine finds nothing', () => {
  const add: Maker = () => ({ op: 'putObject', label: 'add', run: model => putObject(model, { id: 'extra', type: 'system', name: 'Extra' }) })
  assert.deepEqual(play(fixture, 1, 6, { add }).findings, [])
})
