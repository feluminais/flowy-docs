import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRun } from '../src/core/perf.ts'
import {
  activeRun, boxAt, boxSeries, clampPos, cursorX, eventFractions, eventRows, failureMarks, fmtBytes, fmtLoad, fmtMs, fmtPct, fmtRate, gridOf, isTested, isTime, levelLabels, levelX, lineAt, lineSeries, LINE_KEYS, loadAt, METRICS, pathOf, posAt, RAMP_MS, rampFrom, rampPos, scaleOf, sliderFraction, slidePos, sliderRange, sliderValue, snap, sourceCss, tickLabels, top, xAt, xOfPos, yAt,
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
  assert.equal(fmtBytes(999.4), '999 B') // the unit changes where the value rounds up to the next one
  assert.equal(fmtBytes(999.5), '1 KB')
  assert.equal(fmtBytes(999_499), '999 KB')
  assert.equal(fmtBytes(999_500), '1 MB')
  assert.equal(fmtBytes(999_999), '1 MB')
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

test('the size of a call is a number of a line, listed after the calls and measured like them', () => {
  assert.deepEqual([...LINE_KEYS], ['rate', 'bytes', 'p50', 'p95', 'errors'])
  const sized = parseRun('s', 'name: S\nlevels:\n  - load: 1\n    connections: [{ from: web, to: api, rate: 5, bytes: 400 }]\n  - load: 2\n    connections: [{ from: web, to: api, rate: 9, bytes: 1600 }]\n').run
  assert.deepEqual(lineSeries(shop(), sized, 'shop', 'web', 'api', 'bytes'), [400, 1600])
  assert.equal(lineAt(shop(), sized, 'shop', 'web', 'api', 1.5)?.bytes, 1000)
  assert.deepEqual(lineSeries(shop(), run, 'shop', 'web', 'api', 'bytes'), [undefined, undefined, undefined]) // a run that has none shows none
})

test('a source colour is CSS for both themes, or a hex as written, or nothing', () => {
  assert.equal(sourceCss('blue'), 'light-dark(#378add, #85b7eb)')
  assert.equal(sourceCss('#1D9E75'), '#1d9e75')
  assert.equal(sourceCss('#abc'), '#aabbcc')
  assert.equal(sourceCss('chartreuse'), undefined)
  assert.equal(sourceCss(undefined), undefined)
})

test('the key draws the fade while no line fails and for a line that fails without saying how, and a lost or rejected call only when a line has one', () => {
  assert.deepEqual(failureMarks([]), { fade: true, lost: false, rejected: false })
  assert.deepEqual(failureMarks([{ failed: 0, failure: 'lost' }]), { fade: true, lost: false, rejected: false }) // nothing fails now, so nothing lost is on screen
  assert.deepEqual(failureMarks([{ failed: 0.1, failure: 'lost' }]), { fade: false, lost: true, rejected: false })
  assert.deepEqual(failureMarks([{ failed: 0.1, failure: 'rejected' }, { failed: 0.05 }]), { fade: true, lost: false, rejected: true })
  assert.deepEqual(failureMarks([{ failed: 0.1, failure: 'rejected' }, { failed: 0.2, failure: 'lost' }]), { fade: false, lost: true, rejected: true })
})

// ---- Runs over time

/** The spec's outage: levels at 0, 45 and 120 seconds, and events at 40, 70 and 85. The slider of such a run is linear in time. */
const outage = parseRun('outage', `name: Payments killed at 40 s
axis: time
unit: s
events:
  - { at: 40, on: api, state: stopped, text: Payments killed }
  - { at: 70, on: api, state: starting, text: Restart begins }
  - { at: 85, on: api, state: running, text: Answers again }
levels:
  - at: 0
    overall: { p50: 60, p95: 140 }
    objects: { api: { util: 0.4 } }
  - at: 45
    overall: { p50: 80, p95: 400 }
    objects: { api: { util: 0 } }
  - at: 120
    overall: { p50: 70, p95: 150 }
    objects: { api: { util: 0.5 } }
`).run

test('a time run is a time run, and a load run is not', () => {
  assert.equal(isTime(outage), true)
  assert.equal(isTime(run), false)
})

test('posAt is the position of a time, the other way round from loadAt', () => {
  assert.equal(posAt(outage, 0), 0)
  assert.equal(posAt(outage, 45), 1)
  assert.equal(posAt(outage, 82.5), 1.5)
  assert.equal(posAt(outage, 120), 2)
  near(posAt(outage, 22.5), 0.5)
  assert.equal(posAt(outage, -5), 0) // outside the run is the nearest end, as loadAt clamps
  assert.equal(posAt(outage, 500), 2)
  assert.equal(posAt(outage, Number.NaN), 0)
  assert.equal(posAt(outage, Number.POSITIVE_INFINITY), 0) // not finite is the start, as clampPos has it
  for (const pos of [0, 0.25, 1, 1.5, 1.9, 2]) near(posAt(outage, loadAt(outage, pos)), pos)
  assert.equal(xOfPos(outage, 1.5), 82.5)
  assert.equal(posAt(run, 300), 1.5) // the same for a load run
})

test('the slider of a time run is linear in time: a level sits where its time is, and an event on its own time', () => {
  assert.equal(sliderFraction(outage, 0), 0)
  assert.equal(sliderFraction(outage, 1), 0.375) // 45 of 120
  near(sliderFraction(outage, 1.5), 82.5 / 120)
  assert.equal(sliderFraction(outage, 2), 1)
  assert.equal(sliderFraction(outage, 9), 1)
  const events = eventFractions(outage)
  assert.deepEqual(events.map(e => e.event.at), [40, 70, 85])
  near(events[0].fraction, 1 / 3)
  near(events[1].fraction, 7 / 12)
  near(events[2].fraction, 17 / 24)
})

test('the events list marks the ones that have happened and the latest of them', () => {
  const flags = (x: number) => eventRows(outage, x).map(r => [r.event.at, r.passed, r.current])
  assert.deepEqual(flags(39), [[40, false, false], [70, false, false], [85, false, false]])
  assert.deepEqual(flags(40), [[40, true, true], [70, false, false], [85, false, false]])
  assert.deepEqual(flags(75), [[40, true, false], [70, true, true], [85, false, false]])
  assert.deepEqual(flags(120), [[40, true, false], [70, true, false], [85, true, true]])
  assert.deepEqual(flags(Number.NaN), [[40, false, false], [70, false, false], [85, false, false]])
  assert.deepEqual(eventRows(run, 200), [])
})

test('the slider of a load run is as it was: even steps, and no events to mark', () => {
  assert.equal(sliderFraction(run, 0), 0)
  assert.equal(sliderFraction(run, 1), 0.5)
  assert.equal(sliderFraction(run, 1.5), 0.75)
  assert.equal(sliderFraction(run, 7), 1)
  assert.deepEqual(eventFractions(run), [])
  assert.deepEqual(sliderRange(run), { min: 0, max: 2 })
  assert.equal(sliderValue(run, 1.5), 1.5)
  assert.equal(slidePos(run, 1.4), 1) // dragging a load run still snaps to a tested level
})

test('a time run is dragged freely in time, and the value of the slider is a time', () => {
  assert.deepEqual(sliderRange(outage), { min: 0, max: 120 })
  assert.equal(sliderValue(outage, 1), 45)
  assert.equal(sliderValue(outage, 1.5), 82.5)
  near(slidePos(outage, 40), 40 / 45) // an event's own time is a place the slider can stand on
  assert.equal(slidePos(outage, 45), 1)
  assert.equal(slidePos(outage, 999), 2)
})

test('Play sweeps a time run in RAMP_MS of wall time, evenly in time, and stops at the end', () => {
  assert.equal(rampPos(outage, 0, RAMP_MS), 2)
  near(rampPos(outage, 0, RAMP_MS / 4), posAt(outage, 30)) // a quarter of the time: 30 s of 120
  near(rampPos(outage, 1, RAMP_MS / 2), posAt(outage, 45 + 60)) // from the middle level, half the sweep further on
  assert.equal(rampPos(outage, 1.9, RAMP_MS), 2)
  assert.equal(rampFrom(outage, 2), 0)
  assert.equal(rampFrom(outage, 1.5), 1.5)
  near(rampPos(run, 0, RAMP_MS / 2), 1) // a load run goes level to level as before
})

test('the arrow keys still go from level to level in a time run: 0, 45, 120', () => {
  assert.deepEqual([0, 1, 2].map(i => xOfPos(outage, snap(outage, i))), [0, 45, 120])
  assert.equal(snap(outage, posAt(outage, 40)), 1)
  assert.equal(snap(outage, posAt(outage, 100)), 2)
})

test('the strip places a time run by time, and a load run evenly as before', () => {
  const area = { x: 0, y: 0, width: 120, height: 10 }
  assert.deepEqual([0, 1, 2].map(i => levelX(outage, area, i)), [0, 45, 120])
  assert.deepEqual([0, 1, 2].map(i => levelX(run, area, i)), [0, 60, 120])
  assert.equal(cursorX(outage, area, 1.5), 82.5)
  assert.equal(cursorX(run, area, 1.5), 90)
  assert.deepEqual(levelLabels(outage, area).map(l => [l.x, l.label]), [[0, '0'], [45, '45'], [120, '120']])
  const values = [10, 20, 30]
  const scale = { lo: 0, hi: 40, log: false }
  assert.equal(pathOf(values, scale, area), 'M0 7.5L60 5L120 2.5') // even
  assert.equal(pathOf(values, scale, area, outage), 'M0 7.5L45 5L120 2.5') // by time
  assert.equal(pathOf(values, scale, area, run), pathOf(values, scale, area))
})

test('levels close in time do not pile their labels up: the last is always named', () => {
  const crowded = parseRun('crowded', 'name: C\naxis: time\nlevels:\n  - at: 0\n  - at: 1\n  - at: 2\n  - at: 100\n  - at: 101\n  - at: 150\n').run
  const area = { x: 0, y: 0, width: 150, height: 10 }
  assert.deepEqual(levelLabels(crowded, area).map(l => l.label), ['0', '100', '150'])
  assert.deepEqual(tickLabels(crowded).map(t => t.label), ['0', '100', '150'])
  const close = parseRun('close', 'name: C\naxis: time\nlevels:\n  - at: 0\n  - at: 100\n  - at: 101\n').run
  assert.deepEqual(tickLabels(close).map(t => t.label), ['0', '101']) // the last level takes the place of the one it would cover
  assert.deepEqual(tickLabels(run).map(t => [t.fraction, t.label]), [[0, '100'], [0.5, '200'], [1, '400']])
  assert.deepEqual(tickLabels(outage).map(t => [t.fraction, t.label]), [[0, '0'], [0.375, '45'], [1, '120']])
})
