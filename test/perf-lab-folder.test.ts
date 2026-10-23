import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { modelFiles } from '../src/core/modelfiles.ts'
import { modelOf } from '../src/core/state.ts'
import { knee, kneeOf } from '../src/core/perf/analyse.ts'
import { dialsOf } from '../src/core/perf/dials.ts'
import { interpolate, levelAt } from '../src/core/perf/levels.ts'
import { callSize } from '../src/core/perf/measure.ts'
import { kneeTextOf, scaleText } from '../src/core/perf/text.ts'
import { trafficAt } from './dots.ts'
import { loadState } from '../src/node/files.ts'
import { nameOf } from '../src/core/views.ts'

test('the lab documents itself, and its two committed runs fit its model', async () => {
  const state = await loadState(join(import.meta.dirname, '../perf-lab/flowy'))
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, [])
  assert.equal('runProblems' in state, false)
  assert.deepEqual(Object.keys(state.runs ?? {}), ['ramp', 'slow-gateway'])
  for (const run of Object.values(state.runs ?? {})) assert.ok(run.levels.length >= 5, `${run.name} has ${run.levels.length} levels`)
})

test('the demo, Plum, has seven made-up runs that fit its model: where Delivery gives way, the same test after a fix, customer orders alone, courier pings with a dot scale, Stripe going down over time, and the orders and pings added and tested together', async () => {
  const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, [])
  assert.equal('runProblems' in state, false)
  assert.deepEqual(Object.keys(state.runs ?? {}), ['dinner-rush', 'eta-batched', 'orders-only', 'pings-climbing', 'stripe-outage', 'together-measured', 'together']) // the file names sort so that the demo opens on the dinner rush
  const { 'dinner-rush': rush, 'eta-batched': batched, 'pings-climbing': pings, 'stripe-outage': outage } = state.runs ?? {}
  assert.deepEqual(rush.levels.map(l => l.load), [100, 300, 600, 900, 1200])
  assert.deepEqual(batched.levels.map(l => l.load), [100, 300, 600, 900, 1200])
  assert.deepEqual(knee(rush), { index: 3, load: 900, by: { id: 'eta', kind: 'util', share: 0.9 } })
  assert.equal(knee(batched), undefined)
  assert.match(rush.about ?? '', /made-up/i) // the demo says its numbers are invented
  assert.match(batched.about ?? '', /made-up/i)
  assert.match(pings.about ?? '', /made-up/i)
  assert.deepEqual(pings.levels.map(l => l.load), [50, 100, 200, 400, 800])
  assert.equal(pings.unit, 'pings/s')
  assert.equal(pings.source?.color, 'green')
  assert.equal(pings.source?.dot?.text, 'rate / 20')
  assert.equal(scaleText(pings), '1 dot = 20 calls/s')
  assert.deepEqual(knee(pings), { index: 4, load: 800, by: { id: 'fleet-db', kind: 'util', share: 0.93 } })
  // the outage is a run over time: Stripe is killed at 40 s, restarts at 70 s and answers at 85 s, and every event names a shape the demo has
  assert.match(outage.about ?? '', /made-up/i)
  assert.equal(outage.axis, 'time')
  assert.equal(outage.unit, 's')
  assert.deepEqual(outage.levels.map(l => l.load), [0, 30, 45, 60, 90, 120, 150])
  assert.deepEqual(outage.events?.map(e => [e.at, e.on, e.state, e.text]), [
    [40, 'stripe', 'stopped', 'Payments killed'], [70, 'stripe', 'starting', 'Restart begins'], [85, 'stripe', 'running', 'Answers again'],
  ])
  assert.deepEqual(knee(outage), { index: 2, load: 45, by: { id: 'checkout', kind: 'errors', share: 0.3 } })
})

test('the folders the repo ships can be edited in the canvas: their files can all be written out again', async () => {
  for (const dir of ['../perf-lab/flowy', '../flowy', '../example', '../docs/demo/flowy']) {
    const state = await loadState(join(import.meta.dirname, dir))
    assert.ok('model' in state, dir)
    // a flow-style line with an unquoted comma in a label reads as a stray key with no value, which the writer refuses
    assert.doesNotThrow(() => modelFiles(modelOf(state)), dir)
  }
})

const plum = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
assert.ok('model' in plum, 'the demo folder should load')
const plumModel = modelOf(plum)
const plumRuns = plum.runs ?? {}
const plumName = (id: string) => nameOf(plumModel, id)

test('Plum has customer orders alone: blue dots, one for every 4 calls a second, reaching Fleet DB through Matcher', () => {
  const orders = plumRuns['orders-only']
  assert.equal(orders.name, 'Customer orders')
  assert.equal(orders.unit, 'orders/min')
  assert.equal(orders.entry, 'customer-app')
  assert.equal(orders.source?.color, 'blue')
  assert.equal(orders.source?.dot?.text, 'rate / 4')
  assert.equal(orders.source?.size, undefined, 'Calls draws every dot the same size; the size of a call is what Data counts')
  assert.equal(scaleText(orders), '1 dot = 4 calls/s')
  assert.equal(scaleText(orders, 'data', callSize(plumRuns, 'orders-only')), '1 dot = 2 KB/s')
  assert.match(orders.about ?? '', /made-up/i)
  assert.ok(orders.levels.every(l => l.connections.some(c => c.from === 'matcher' && c.to === 'fleet-db')), 'every level reaches Fleet DB through Matcher')
  assert.ok(orders.levels.length >= 5)
})

test('Plum adds customer orders and courier pings, and the two meet at Fleet DB in blue and green', () => {
  const added = plumRuns.together
  assert.deepEqual(added.adds, ['orders-only', 'pings-climbing'])
  assert.match(added.about ?? '', /made-up/i)
  const found = dialsOf(plumRuns, 'together')!
  assert.equal(found.mode, 'added')
  assert.deepEqual(found.dials.map(d => [d.id, d.color]), [['orders-only', 'blue'], ['pings-climbing', 'green']])
  // Fleet DB is the one shape both fill, and added they pass full at the top.
  const top = { 'orders-only': 1200, 'pings-climbing': 800 }
  assert.ok(levelAt(plumRuns, 'together', top).objects['fleet-db'].util! > 1)
  const knee = kneeOf(plumRuns, 'together')!
  assert.ok('by' in knee && knee.by.id === 'fleet-db', 'Fleet DB is where the two first struggle')
  assert.match(kneeTextOf(plumRuns, 'together', knee, plumName), /^First struggles with Customer orders at \d+ orders\/min and Courier pings at \d+ pings\/s: Fleet DB at \d+% of capacity$/)
  // The line from Tracking to Fleet DB is carried by both, and draws a stream for each.
  const lines = trafficAt(plumModel, plumRuns, 'together', top, 'delivery').lines.filter(l => l.from === 'tracking' && l.to === 'fleet-db')
  assert.deepEqual(lines.map(l => [l.source, l.color]), [['orders-only', 'blue'], ['pings-climbing', 'green']])
})

test('Plum tests orders and pings together: nine combinations of two sources, fewer shapes and lines than the dinner rush, and where one is at its lowest the numbers agree with its own run', () => {
  const measured = plumRuns['together-measured']
  const rush = plumRuns['dinner-rush']
  assert.match(measured.about ?? '', /made-up/i)
  const found = dialsOf(plumRuns, 'together-measured')!
  assert.equal(found.mode, 'tested')
  assert.deepEqual(found.dials.map(d => [d.id, d.values.length, d.color]), [['orders', 3, 'blue'], ['pings', 3, 'green']])
  assert.equal(measured.levels.length, 9)
  const shapes = new Set(measured.levels.flatMap(l => Object.keys(l.objects)))
  assert.deepEqual([...shapes].sort(), ['eta', 'fleet-db', 'matcher', 'tracking'])
  assert.ok(measured.levels[0].connections.length < rush.levels[0].connections.length / 3)
  // Each source's share of a line is what its own run says at its own load.
  const orders = plumRuns['orders-only']
  const pings = plumRuns['pings-climbing']
  const rate = (level: ReturnType<typeof interpolate>, from: string, to: string) => level.connections.find(c => c.from === from && c.to === to)?.rate
  for (const level of measured.levels) {
    const [o, p] = [level.loads!.orders, level.loads!.pings]
    const line = level.connections.find(c => c.from === 'tracking' && c.to === 'fleet-db')!
    assert.ok(Math.abs(line.by!.orders.rate! - rate(interpolate(orders, o), 'tracking', 'fleet-db')!) < 0.6, `orders at ${o}`)
    assert.ok(Math.abs(line.by!.pings.rate! - rate(interpolate(pings, p), 'tracking', 'fleet-db')!) < 0.6, `pings at ${p}`)
    assert.ok(Math.abs(line.rate! - (line.by!.orders.rate! + line.by!.pings.rate!)) < 0.6, 'the line carries what both send')
  }
  // Together they fill Fleet DB faster than the two added: the two compete for it.
  const both = { orders: 600, pings: 400 }
  const apart = levelAt(plumRuns, 'together', { 'orders-only': 600, 'pings-climbing': 400 }).objects['fleet-db'].util!
  assert.ok(levelAt(plumRuns, 'together-measured', both).objects['fleet-db'].util! > apart)
})
