import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRun } from '../src/core/perf.ts'
import {
  activeRun, boxAt, boxSeries, clampPos, fmtBytes, fmtLoad, fmtMs, fmtPct, fmtRate, gridOf, isTested, levelLabels, lineAt, lineSeries, loadAt, METRICS, pathOf, RAMP_MS, rampFrom, rampPos, scaleOf, snap, top, xAt, yAt,
} from '../ui/src/perfview.ts'
import { shop } from './fixtures.ts'

/** Three levels against the shop fixture: api and db are measured, and orders inside api; orders → db and auth → db share a line in the shop view. */
const run = parseRun('ramp', `name: Ramp
unit: req/s
levels:
  - load: 100
    objects: { api: { util: 0.4, queue: 0 }, db: { util: 0.5 }, orders: { util: 0.2 } }
    connections: [{ from: orders, to: db, rate: 50, p50: 10, p95: 20 }, { from: auth, to: db, rate: 40, p50: 12, p95: 30 }]
  - load: 200
    objects: { api: { util: 0.7, queue: 2 }, db: { util: 0.8 }, orders: { util: 0.3 } }
    connections: [{ from: orders, to: db, rate: 100, p50: 14, p95: 28 }, { from: auth, to: db, rate: 80, p50: 16, p95: 44 }]
  - load: 400
    objects: { api: { util: 0.95, queue: 40 }, db: { util: 0.97 }, orders: { util: 0.6 } }
    connections: [{ from: orders, to: db, rate: 150, p50: 40, p95: 90 }, { from: auth, to: db, rate: 120, p50: 50, p95: 120 }]
`).run

const near = (actual: number | undefined, expected: number, within = 1e-9) => assert.ok(actual !== undefined && Math.abs(actual - expected) <= within, `expected ${expected}, got ${actual}`)

test('a position along the levels is a load: a tested level exactly, and a straight line between two', () => {
  assert.equal(top(run), 2)
  assert.equal(loadAt(run, 0), 100)
  assert.equal(loadAt(run, 1), 200)
  assert.equal(loadAt(run, 1.5), 300)
  assert.equal(loadAt(run, 2), 400)
  assert.equal(loadAt(run, -1), 100)
  assert.equal(loadAt(run, 9), 400)
  assert.equal(loadAt(run, NaN), 100)
  assert.equal(clampPos(run, 7), 2)
})

test('only a whole position is a tested level, and the slider snaps to one', () => {
  assert.equal(isTested(1), true)
  assert.equal(isTested(1.5), false)
  assert.equal(snap(run, 1.4), 1)
  assert.equal(snap(run, 1.6), 2)
  assert.equal(snap(run, 5), 2)
})

test('a ramp takes RAMP_MS to go from the first level to the last, whatever the levels, and stops at the top', () => {
  assert.equal(rampPos(run, 0, RAMP_MS), 2)
  near(rampPos(run, 0, RAMP_MS / 2), 1)
  assert.equal(rampPos(run, 1.9, RAMP_MS), 2)
  near(rampPos(run, 0, 0), 0)
})

test('a ramp from the top starts again from the bottom, and from anywhere else carries on from there', () => {
  assert.equal(rampFrom(run, 2), 0)
  assert.equal(rampFrom(run, 1.5), 1.5)
  assert.equal(rampFrom(run, 0), 0)
})

test('the run on show is the one asked for if there is such a run, else the first, else none', () => {
  const runs = { ramp: run, spike: run }
  assert.equal(activeRun(runs, 'spike'), 'spike')
  assert.equal(activeRun(runs, 'gone'), 'ramp') // a run that was renamed or deleted while the tab was open
  assert.equal(activeRun({}, 'ramp'), '')
  assert.equal(activeRun(runs, '__proto__'), 'ramp')
})

test('numbers are written the way a reader says them', () => {
  assert.equal(fmtMs(4.2), '4.2 ms')
  assert.equal(fmtMs(180), '180 ms')
  assert.equal(fmtMs(999), '999 ms')
  assert.equal(fmtMs(1000), '1 s')
  assert.equal(fmtMs(2400), '2.4 s')
  assert.equal(fmtPct(0.4), '40%')
  assert.equal(fmtPct(0.034), '3.4%')
  assert.equal(fmtPct(0.0004), '0%')
  assert.equal(fmtRate(98), '98 calls a second')
  assert.equal(fmtRate(4.25), '4.3 calls a second')
  assert.equal(fmtBytes(400), '400 B')
  assert.equal(fmtBytes(0), '0 B')
  assert.equal(fmtBytes(1000), '1 KB')
  assert.equal(fmtBytes(1536), '1.5 KB')
  assert.equal(fmtBytes(48_000), '48 KB')
  assert.equal(fmtBytes(2_400_000), '2.4 MB')
  assert.equal(METRICS.bytes.label, 'Size of a call')
  assert.equal(METRICS.bytes.show(1600), '1.6 KB')
  assert.equal(fmtLoad(200, 'req/s'), '200 req/s')
  assert.equal(fmtLoad(2.5, 'req/s'), '2.5 req/s')
  assert.equal(METRICS.util.show(0.93), '93%')
  assert.equal(METRICS.queue.show(40.4), '40')
  assert.equal(METRICS.p95.show(2500), '2.5 s')
})

test('a scale holds every number: from zero up for most, and by powers of ten for latency', () => {
  assert.deepEqual(scaleOf([0.2, 0.8, undefined]), { lo: 0, hi: 0.8, log: false })
  assert.deepEqual(scaleOf([0.2, 0.8], { to: 1 }), { lo: 0, hi: 1, log: false })
  assert.deepEqual(scaleOf([undefined]), { lo: 0, hi: 1, log: false })
  assert.deepEqual(scaleOf([12, 450, undefined], { log: true }), { lo: 1, hi: 3, log: true })
  assert.deepEqual(scaleOf([100], { log: true }), { lo: 2, hi: 3, log: true })
  assert.deepEqual(scaleOf([0, -4], { log: true }), { lo: 0, hi: 1, log: true }) // nothing a log scale can hold
})

test('levels are spaced evenly across an area, and values sit on the scale from its bottom to its top', () => {
  const area = { x: 10, y: 0, width: 90, height: 50 }
  assert.deepEqual([0, 1, 2, 3].map(i => xAt(area, i, 4)), [10, 40, 70, 100])
  assert.equal(xAt(area, 0, 1), 10)
  const linear = { lo: 0, hi: 1, log: false }
  assert.deepEqual([1, 0.5, 0, 7, -1].map(v => yAt(area, linear, v)), [0, 25, 50, 0, 50])
  const log = { lo: 1, hi: 3, log: true }
  assert.deepEqual([10, 100, 1000, 3].map(v => yAt(area, log, v)), [50, 25, 0, 50]) // below the scale it sits on the floor
})

test('a curve goes through every level that has a number, and lifts the pen where one is missing', () => {
  const area = { x: 10, y: 0, width: 90, height: 50 }
  assert.equal(pathOf([0, 1, undefined, 0.5], { lo: 0, hi: 1, log: false }, area), 'M10 50L40 0M100 25')
  assert.equal(pathOf([undefined, undefined], { lo: 0, hi: 1, log: false }, area), '')
})

test('the latency grid has a line for each power of ten, and the level labels thin out when there are many', () => {
  assert.deepEqual(gridOf({ lo: 1, hi: 3, log: true }, { x: 0, y: 0, width: 10, height: 50 }), [{ y: 50, label: '10 ms' }, { y: 25, label: '100 ms' }, { y: 0, label: '1 s' }])
  const area = { x: 0, y: 0, width: 100, height: 10 }
  assert.deepEqual(levelLabels(run, area).map(l => l.label), ['100', '200', '400'])
  const many = parseRun('many', `name: Many\nlevels:\n${Array.from({ length: 20 }, (_, i) => `  - load: ${(i + 1) * 10}`).join('\n')}\n`).run
  const labels = levelLabels(many, area)
  assert.ok(labels.length <= 9)
  assert.equal(labels[0].label, '10')
  assert.equal(labels.at(-1)?.label, '200') // the last level is always named
})

test('what a shape or line measured, level by level and at a load, as the view draws it', () => {
  const model = shop()
  assert.deepEqual(boxSeries(model, run, 'shop', 'api', 'util'), [0.4, 0.7, 0.95])
  assert.deepEqual(boxSeries(model, run, 'root', 'shop', 'util'), [0.5, 0.8, 0.97]) // the system takes the worst of what is inside it
  assert.deepEqual(boxSeries(model, run, 'shop', 'web', 'util'), [undefined, undefined, undefined])
  assert.deepEqual(lineSeries(model, run, 'shop', 'api', 'db', 'rate'), [90, 180, 270]) // orders → db and auth → db are one line here
  assert.deepEqual(lineSeries(model, run, 'shop', 'api', 'db', 'p95'), [30, 44, 120])
  near(boxAt(model, run, 'shop', 'db', 150)?.util, 0.65)
  assert.equal(boxAt(model, run, 'shop', 'web', 150), undefined)
  near(lineAt(model, run, 'shop', 'api', 'db', 150)?.rate, 135)
  assert.equal(lineAt(model, run, 'shop', 'web', 'api', 150), undefined)
})
