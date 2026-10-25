import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getObject } from '../src/core/model.ts'
import { parseFlowFile } from '../src/core/modelfiles.ts'
import type { Flow, Step } from '../src/core/model.ts'
import { isStateName, marksOf, readStates, STATE_LABELS, STATE_NAMES, stateProblems, statesAt, usesStates } from '../src/core/states.ts'
import { stopBefore, stopsOf } from '../src/core/structure.ts'
import { shop } from './fixtures.ts'

const step = (extra: Partial<Step> = {}): Step => ({ from: 'web', to: 'api', text: 't', ...extra })
const flowOf = (steps: Step[], extra: Partial<Flow> = {}): Flow => ({ name: 'F', view: 'shop', ...extra, steps })
const group = (kind: string) => ({ kind })
const at = (flow: Flow, k: number) => statesAt(flow, stopsOf(flow), k)
const model = shop()
const problems = (flow: Flow) => stateProblems(flow, stopsOf(flow), id => getObject(model, id) !== undefined)

test('the six states, in order, with the words a person says', () => {
  assert.deepEqual([...STATE_NAMES], ['running', 'starting', 'stopping', 'stopped', 'restarting', 'degraded'])
  assert.deepEqual(STATE_NAMES.map(n => STATE_LABELS[n]), ['Running', 'Starting', 'Stopping', 'Stopped', 'Restarting', 'Degraded'])
  assert.ok(isStateName('stopped'))
  for (const v of ['Stopped', 'stop', '', undefined, null, 3, ['stopped']]) assert.equal(isStateName(v), false, String(v))
})

test('stopBefore: the stop the before chain points at, and nothing for the first stop or a stale index', () => {
  const stops = stopsOf(flowOf([step(), step(), step()]))
  assert.equal(stopBefore(stops, 0), undefined)
  assert.equal(stopBefore(stops, 1), 0)
  assert.equal(stopBefore(stops, 2), 1)
  for (const k of [-1, 3, 1.5, Number.NaN]) assert.equal(stopBefore(stops, k), undefined, String(k))
  assert.equal(stopBefore([], 0), undefined)
})

test('fold: a step\'s change holds until another step changes it', () => {
  const flow = flowOf([step(), step({ states: { api: 'stopped' } }), step(), step({ states: { api: 'running', web: 'degraded' } }), step()])
  assert.deepEqual(at(flow, 0), {})
  assert.deepEqual(at(flow, 1), { api: 'stopped' })
  assert.deepEqual(at(flow, 2), { api: 'stopped' })
  assert.deepEqual(at(flow, 3), { api: 'running', web: 'degraded' })
  assert.deepEqual(at(flow, 4), { api: 'running', web: 'degraded' })
})

test('start: the flow\'s states apply before step 1', () => {
  const flow = flowOf([step(), step({ states: { api: 'running' } })], { states: { api: 'starting', db: 'stopped' } })
  assert.deepEqual(at(flow, 0), { api: 'starting', db: 'stopped' })
  assert.deepEqual(at(flow, 1), { api: 'running', db: 'stopped' })
})

test('parallel stop: every lane applies, two lanes disagreeing is a problem, agreeing is not', () => {
  const lanes = (a: Step['states'], b: Step['states']) => flowOf([
    step(),
    step({ group: 'p', lane: 'a', states: a }), step({ group: 'p', lane: 'b', states: b }),
    step(),
  ], { groups: { p: group('parallel') } })

  const apart = lanes({ api: 'stopped' }, { web: 'degraded' })
  assert.deepEqual(at(apart, 1), { api: 'stopped', web: 'degraded' })
  assert.deepEqual(at(apart, 2), { api: 'stopped', web: 'degraded' })
  assert.deepEqual(problems(apart), [])

  const same = lanes({ api: 'stopped' }, { api: 'stopped' })
  assert.deepEqual(problems(same), [])

  const clash = lanes({ api: 'stopped' }, { api: 'degraded' })
  assert.deepEqual(problems(clash), [{ step: 2, message: 'shape "api" is set to both stopped and degraded in one stop' }])
  assert.deepEqual(at(clash, 1), { api: 'degraded' }) // the later lane wins, so the picture is still total
})

test('parallel stop: three lanes that disagree give one problem for the shape, not one per lane', () => {
  const flow = flowOf([
    step({ group: 'p', lane: 'a', states: { api: 'stopped' } }),
    step({ group: 'p', lane: 'b', states: { api: 'degraded' } }),
    step({ group: 'p', lane: 'c', states: { api: 'starting' } }),
  ], { groups: { p: group('parallel') } })
  assert.equal(problems(flow).length, 1)
})

test('branch: each lane starts from the state before the branch and the last lane carries on', () => {
  const flow = flowOf([
    step({ states: { api: 'degraded' } }),
    step({ group: 'b', lane: 'Retry', states: { api: 'restarting' } }),
    step({ group: 'b', lane: 'Give up', states: { db: 'stopped' } }),
    step(),
  ], { groups: { b: group('branch') } })
  assert.deepEqual(at(flow, 0), { api: 'degraded' })
  assert.deepEqual(at(flow, 1), { api: 'restarting' })
  assert.deepEqual(at(flow, 2), { api: 'degraded', db: 'stopped' }) // the first lane's restart is not here
  assert.deepEqual(at(flow, 3), { api: 'degraded', db: 'stopped' }) // after the branch, the last lane's changes carry on
})

test('unknown shape and unknown state are problems with the step number', () => {
  const flow = flowOf([
    step({ states: { nope: 'stopped', api: 'asleep' } }),
    step(),
    step({ states: { web: 'Stopped' } }),
  ], { states: { ghost: 'running', db: 'sleepy' } })
  const use = 'use running, starting, stopping, stopped, restarting, degraded'
  assert.deepEqual(problems(flow), [
    { message: 'states: unknown shape "ghost"' },
    { message: `states: unknown state "sleepy" for "db" (${use})` },
    { step: 0, message: 'states: unknown shape "nope"' },
    { step: 0, message: `states: unknown state "asleep" for "api" (${use})` },
    { step: 2, message: `states: unknown state "Stopped" for "web" (${use})` },
  ])
})

test('a state that is not text is a problem too, never a crash', () => {
  const flow = flowOf([step({ states: { api: ['stopped'] as never, web: { x: 'y' } as never } })])
  assert.deepEqual(problems(flow).map(p => p.message), [
    'states: "api" needs a state word (use running, starting, stopping, stopped, restarting, degraded)',
    'states: "web" needs a state word (use running, starting, stopping, stopped, restarting, degraded)',
  ])
  assert.deepEqual(at(flow, 0), {})
})

test('__proto__ as a shape id is an unknown shape and pollutes nothing', () => {
  // As the YAML reader makes it: an own property named __proto__.
  const flow = parseFlowFile('x', 'name: X\nview: shop\nstates: { __proto__: stopped, constructor: stopped, toString: degraded }\nsteps:\n  - { from: web, to: api, text: t, states: { __proto__: degraded } }\n')
  assert.deepEqual(problems(flow).map(p => p.message), [
    'states: unknown shape "__proto__"',
    'states: unknown shape "constructor"',
    'states: unknown shape "toString"',
    'states: unknown shape "__proto__"',
  ])
  const states = at(flow, 0)
  assert.deepEqual(Object.keys(states), ['__proto__', 'constructor', 'toString'])
  assert.equal(Object.getPrototypeOf(states), Object.prototype)
  assert.equal(Object.getOwnPropertyDescriptor(states, '__proto__')?.value, 'degraded') // the step's value, read as data
  assert.equal(({} as Record<string, unknown>).stopped, undefined)
  assert.equal(Object.hasOwn(Object.prototype, 'stopped'), false)
  assert.deepEqual(marksOf(model, states), {}) // none of them is a shape
  const read = readStates({ ['__proto__']: 'stopped' })
  assert.deepEqual(Object.keys(read), ['__proto__']) // kept as data, not as a prototype
  assert.equal(Object.getPrototypeOf(read), Object.prototype)
})

test('states that is a list, a string or null is a problem; what is well formed still reads', () => {
  for (const bad of [['api'], 'stopped', '', null, 3]) {
    const flow = flowOf([step({ states: { api: 'stopped' } }), step()], { states: bad as never })
    assert.deepEqual(problems(flow), [{ message: 'states must map shape ids to states' }], JSON.stringify(bad))
    assert.deepEqual(at(flow, 1), { api: 'stopped' }, JSON.stringify(bad))
    const onStep = flowOf([step({ states: bad as never }), step()])
    assert.deepEqual(problems(onStep), [{ step: 0, message: 'states must map shape ids to states' }], JSON.stringify(bad))
    assert.deepEqual(at(onStep, 1), {}, JSON.stringify(bad))
  }
  assert.deepEqual(problems(flowOf([step({ states: {} })], { states: {} })), [])
})

test('statesAt is total: k out of range gives the flow\'s start, and a flow with no stops too', () => {
  const flow = flowOf([step({ states: { api: 'stopped' } })], { states: { web: 'starting' } })
  for (const k of [-1, 1, 99, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(at(flow, k), { web: 'starting' }, String(k))
  const empty = flowOf([], { states: { web: 'starting' } })
  assert.deepEqual(stopsOf(empty), [])
  assert.deepEqual(at(empty, 0), { web: 'starting' })
  assert.deepEqual(statesAt(flow, [], 0), { web: 'starting' })
  // Stops from another flow (a stale index) never throw.
  const longer = flowOf([step(), step(), step({ states: { db: 'stopped' } })])
  assert.doesNotThrow(() => statesAt(flow, stopsOf(longer), 2))
})

test('a flow with no states anywhere folds to nothing', () => {
  const flow = flowOf([step(), step(), step()])
  for (let k = 0; k < 3; k++) assert.deepEqual(at(flow, k), {})
})

test('marksOf: a stopped child marks its system inside, own state wins, running entries are dropped', () => {
  // orders and auth are components of api, an app of shop.
  const marks = marksOf(model, { orders: 'stopped', db: 'degraded', web: 'running' })
  assert.deepEqual(marks.orders, { state: 'stopped', inside: false })
  assert.deepEqual(marks.db, { state: 'degraded', inside: false })
  assert.deepEqual(marks.api, { state: 'stopped', inside: true, via: 'Orders' }) // the shape inside that is stopped, by name
  assert.deepEqual(marks.shop, { state: 'stopped', inside: true, via: 'Orders' }) // the worst below: stopped beats degraded, and it is Orders that is stopped
  assert.equal(Object.hasOwn(marks, 'web'), false) // running draws nothing
  assert.equal(Object.hasOwn(marks, 'customer'), false)
  assert.equal(Object.hasOwn(marks, 'root'), false)

  const own = marksOf(model, { orders: 'stopped', api: 'degraded' })
  assert.deepEqual(own.api, { state: 'degraded', inside: false }) // its own state, not the roll-up
  assert.deepEqual(own.shop, { state: 'stopped', inside: true, via: 'Orders' }) // the roll-up still climbs past it

  const explicit = marksOf(model, { orders: 'stopped', api: 'running' })
  assert.equal(Object.hasOwn(explicit, 'api'), false) // an own Running is its own state too
})

test('marksOf: the roll-up picks the worst state below, in the order stopped, restarting, degraded, stopping, starting', () => {
  const order = ['stopped', 'restarting', 'degraded', 'stopping', 'starting'] as const
  for (let i = 0; i < order.length; i++) {
    for (let j = i + 1; j < order.length; j++) {
      const marks = marksOf(model, { orders: order[j], auth: order[i] })
      assert.equal(marks.api.state, order[i], `${order[i]} over ${order[j]}`)
    }
  }
})

test('marksOf: a shape the model does not have is ignored', () => {
  assert.deepEqual(marksOf(model, { ghost: 'stopped' }), {})
  assert.deepEqual(marksOf(model, {}), {})
})

test('usesStates: a flow says something about states in its start or in any step', () => {
  assert.equal(usesStates(flowOf([step(), step()])), false)
  assert.equal(usesStates(flowOf([step()], { states: {} })), true)
  assert.equal(usesStates(flowOf([step(), step({ states: { api: 'stopped' } })])), true)
})
