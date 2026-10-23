import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kneeOf } from '../src/core/perf/analyse.ts'
import { dialsOf } from '../src/core/perf/dials.ts'
import { levelAt } from '../src/core/perf/levels.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import type { Run } from '../src/core/perf/types.ts'
import {
  activeSeries, bracketOf, boxSeriesIn, dialTicks, dialTop, edgeActive, heldText, lineSeriesIn, modeLabel, openingPositions, overText, placeActive, positionOf, positionsOf, rampActive, rampFromActive,
  RAMP_MS, settingOf, stepActive, stepFrom,
} from '../ui/src/perfview.ts'
import { shop } from './fixtures.ts'

/** Two runs added, orders with 3 loads and pings with 5, against the shop fixture: both reach db, and orders → db and auth → db share a line in the shop view. */
const part = (name: string, unit: string, loads: number[], from: string) =>
  `name: ${name}\nunit: ${unit}\nlevels:\n${loads.map((load, i) => `  - load: ${load}\n    overall: { p50: ${10 * (i + 1)}, p95: ${20 * (i + 1)} }\n    objects: { db: { util: ${0.1 * (i + 1)} } }\n    connections: [{ from: ${from}, to: db, rate: ${5 * (i + 1)}, p50: 3 }]\n`).join('')}`
const runs: Record<string, Run> = {
  orders: parseRun('orders', part('Customer orders', 'orders/min', [100, 200, 300], 'orders')).run,
  pings: parseRun('pings', part('Courier pings', 'pings/s', [10, 20, 30, 40, 50], 'auth')).run,
  together: parseRun('together', 'name: Together\nadds: [orders, pings]\n').run,
}
const { dials } = dialsOf(runs, 'together')!

const near = (actual: number | undefined, expected: number, within = 1e-9) => assert.ok(actual !== undefined && Math.abs(actual - expected) <= within, `expected ${expected}, got ${actual}`)

test('a position along a dial is a load and a load is a position, one way round or the other', () => {
  assert.deepEqual(dials.map(dialTop), [2, 4])
  assert.deepEqual(settingOf(dials, [1.5, 3]), { orders: 250, pings: 40 })
  assert.deepEqual(settingOf(dials, [9, -2]), { orders: 300, pings: 0 }, 'past the top is the top, and past no load is no load')
  assert.deepEqual(settingOf(dials, [Number.NaN, Number.POSITIVE_INFINITY]), { orders: 100, pings: 10 }, 'a position that is not a number is the lowest')
  assert.deepEqual(positionsOf(dials, { orders: 250, pings: 40 }), [1.5, 3])
  assert.deepEqual(positionsOf(dials, { orders: 999, pings: 1 }), [2, -0.9], 'a load under the first is on the way down to no load')
  assert.deepEqual(positionsOf(dials, {}), [0, 0], 'a dial the setting does not name is at its lowest')
  assert.deepEqual(positionsOf(dials, { orders: Number.NaN, pings: Number.NaN }), [0, 0])
  for (const pos of [0, 0.25, 1, 1.75, 2]) near(positionOf(dials[0], settingOf(dials, [pos, 0]).orders), pos)
})

test('the tab opens at the first struggle when everything rises together, else with every dial at its top', () => {
  assert.deepEqual(openingPositions(dials, { index: 2 }), [1, 2])
  assert.deepEqual(openingPositions(dials, { index: 0 }), [0, 0])
  assert.deepEqual(openingPositions(dials, { index: 4 }), [2, 4])
  assert.deepEqual(openingPositions(dials), [2, 4])
  assert.deepEqual(openingPositions(dials, kneeOf(runs, 'together')), openingPositions(dials, kneeOf(runs, 'together')!))
})

test('the arrow keys step the active dial to the next tested load and leave the others where they stand', () => {
  assert.equal(stepFrom(1, 1), 2)
  assert.equal(stepFrom(1, -1), 0)
  assert.equal(stepFrom(1.5, 1), 2)
  assert.equal(stepFrom(1.5, -1), 1)
  assert.equal(stepFrom(1 + 1e-9, -1), 0, 'a position a hair past a load is on it')
  assert.deepEqual(stepActive(dials, [1, 2], 0, 1), [2, 2])
  assert.deepEqual(stepActive(dials, [1, 2], 1, -1), [1, 1])
  assert.deepEqual(stepActive(dials, [1.5, 2.5], 1, 1), [1.5, 3])
  assert.deepEqual(stepActive(dials, [2, 4], 0, 1), [2, 4], 'it stops at the top')
  assert.deepEqual(stepActive(dials, [0, 0], 1, -1), [0, -1], 'from the first load it goes down to no load')
  assert.deepEqual(stepActive(dials, [0, -1], 1, -1), [0, -1], 'and stops there')
  assert.deepEqual(edgeActive(dials, [1, 2], 1, 'end'), [1, 4])
  assert.deepEqual(edgeActive(dials, [1, 2], 0, 'start'), [0, 2])
  assert.deepEqual(placeActive(dials, [1, 2], 0, 7), [2, 2])
  assert.deepEqual(placeActive(dials, [1, 2], 1, Number.NaN), [1, 0])
})

test('a ramp moves the active dial from its bottom to its top in the same time whatever its levels, and holds the others', () => {
  assert.deepEqual(rampActive(dials, [0, 1], 0, RAMP_MS / 2), [1, 1])
  assert.deepEqual(rampActive(dials, [0, 1], 1, RAMP_MS / 2), [0, 3])
  assert.deepEqual(rampActive(dials, [0, 1], 1, RAMP_MS * 10), [0, 4], 'it stops at the top')
  assert.deepEqual(rampFromActive(dials, [2, 1], 0), [-1, 1], 'at the top a ramp starts again from no load')
  assert.deepEqual(rampFromActive(dials, [1, 1], 0), [1, 1])
  assert.deepEqual(rampFromActive(dials, [2, 4], 1), [2, -1])
})

test('the series along the active dial are the levels at its loads with the others held, and a single run along its only dial is its own levels', () => {
  const along = activeSeries(runs, 'together', dials, [1, 2], 1)
  assert.equal(along.length, 5)
  assert.deepEqual(along.map(l => l.loads), [10, 20, 30, 40, 50].map(pings => ({ orders: 200, pings })))
  const model = shop()
  // db adds orders (0.2 at 200) to pings (0.1 to 0.5)
  const util = boxSeriesIn(model, along, 'shop', 'db', 'util')
  util.forEach((v, i) => near(v, 0.2 + 0.1 * (i + 1)))
  const rates = lineSeriesIn(model, along, 'shop', 'api', 'db', 'rate')
  rates.forEach((v, i) => near(v, 10 + 5 * (i + 1)))
  const alone = dialsOf(runs, 'orders')!.dials
  assert.deepEqual(activeSeries(runs, 'orders', alone, [1.5], 0), runs.orders.levels.map(l => levelAt(runs, 'orders', { '': l.load })))
  assert.deepEqual(activeSeries(runs, 'orders', alone, [1.5], 0).map(l => l.objects), runs.orders.levels.map(l => l.objects))
  // an active dial that is not one is the nearest that is
  assert.equal(activeSeries(runs, 'together', dials, [1, 2], 9).length, 5)
  assert.equal(activeSeries(runs, 'together', dials, [1, 2], -1).length, 3)
})

test('the held dials are named with where they stand', () => {
  assert.deepEqual(heldText(dials, [1, 2], 0), ['Courier pings held at 30 pings/s'])
  assert.deepEqual(heldText(dials, [1, 2], 1), ['Customer orders held at 200 orders/min'])
  assert.deepEqual(heldText(dials, [1.5, 3], 1), ['Customer orders held at 250 orders/min'])
  assert.deepEqual(heldText(dialsOf(runs, 'orders')!.dials, [1], 0), [], 'a single run holds nothing')
})

test('the labels under a dial are its loads at their places along it, thinned when there are many', () => {
  assert.deepEqual(dialTicks(dials[0]), [{ fraction: 0, label: '0' }, { fraction: 1 / 3, label: '100' }, { fraction: 2 / 3, label: '200' }, { fraction: 1, label: '300' }])
  assert.deepEqual(dialTicks(dials[1], 2).map(t => t.label), ['0', '10', '40', '50'])
  const many = { id: '', name: 'Many', unit: 'x', color: 'blue', values: Array.from({ length: 20 }, (_, i) => i) }
  assert.deepEqual(dialTicks(many).map(t => t.label), ['0', '3', '6', '9', '12', '15', '18', '19'])
})

test('a position is tested or between two loads, and the loads either side say which', () => {
  assert.deepEqual(bracketOf(dials[0], 1), { lower: 200, upper: 300, tested: true })
  assert.deepEqual(bracketOf(dials[0], 2), { lower: 200, upper: 300, tested: true })
  assert.deepEqual(bracketOf(dials[0], 0), { lower: 100, upper: 200, tested: true })
  assert.deepEqual(bracketOf(dials[0], 1.5), { lower: 200, upper: 300, tested: false })
  assert.deepEqual(bracketOf(dials[0], -0.5), { lower: 0, upper: 100, tested: false }, 'under the first load it is on the way down to none')
  assert.deepEqual(bracketOf(dials[0], -1), { lower: 0, upper: 100, tested: false })
  assert.deepEqual(bracketOf(dials[1], 0.25), { lower: 10, upper: 20, tested: false })
  assert.deepEqual(bracketOf(dials[1], 99), { lower: 40, upper: 50, tested: true })
})

test('the panel says once how the sources were measured, and when a shape is added past its capacity', () => {
  assert.equal(modeLabel('added'), 'Added from separate runs')
  assert.equal(modeLabel('tested'), 'Tested together')
  assert.equal(modeLabel('single'), undefined)
  assert.equal(overText('added', 1.3), 'Added use is over 100%')
  assert.equal(overText('added', 1), undefined)
  assert.equal(overText('added', 0.7), undefined)
  assert.equal(overText('added', undefined), undefined)
  assert.equal(overText('tested', 1.3), undefined)
  assert.equal(overText('single', 1.3), undefined)
})
