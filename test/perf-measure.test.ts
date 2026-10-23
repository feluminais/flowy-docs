import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callSize } from '../src/core/perf/measure.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import { scaleText, sourceKeyAt } from '../src/core/perf/text.ts'
import { trafficAt, traffic } from '../src/core/perf/traffic.ts'
import { shop } from './fixtures.ts'

/** The same two lines at two loads: web to api carries small calls (200 B) and api to db large ones (2000 B), at the same rate. */
const RUN = `name: Sizes
unit: req/s
entry: web
source: { color: blue, dot: rate / 10, size: bytes / 1000 }
levels:
  - load: 100
    overall: { rate: 100, p50: 20, p95: 40, errors: 0 }
    objects:
      api: { util: 0.4 }
    connections:
      - { from: web, to: api, rate: 100, bytes: 200, p50: 10, p95: 20, errors: 0 }
      - { from: orders, to: db, rate: 100, bytes: 2000, p50: 10, p95: 20, errors: 0 }
  - load: 200
    overall: { rate: 200, p50: 30, p95: 60, errors: 0 }
    objects:
      api: { util: 0.6 }
    connections:
      - { from: web, to: api, rate: 200, bytes: 200, p50: 10, p95: 20, errors: 0 }
      - { from: orders, to: db, rate: 200, bytes: 2000, p50: 10, p95: 20, errors: 0 }
`
const runs = () => ({ sizes: parseRun('sizes', RUN).run })

test('the size of a call to count against is the run\'s mean, rounded to 1, 2 or 5 times a power of ten', () => {
  assert.equal(callSize(runs(), 'sizes'), 1000)
  assert.equal(callSize(runs(), 'ghost'), undefined)
})

test('a run that gives no size of a call has no data', () => {
  const bare = parseRun('bare', RUN.replace(/, bytes: \d+/g, '').replace('size: bytes / 1000', 'size: p50 / 10')).run
  assert.equal(callSize({ bare }, 'bare'), undefined)
  assert.deepEqual(trafficAt(shop(), { bare }, 'bare', { '': 100 }, 'shop', 'data').lines, [])
})

test('calls is what traffic always was, and data counts the size of a call in', () => {
  const r = runs()
  assert.deepEqual(trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop'), trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'calls'))
  assert.deepEqual(trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'calls'), traffic(shop(), r.sizes, 100, 'shop'))
  const calls = trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'calls').lines
  const data = trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'data').lines
  assert.equal(calls.length, 2)
  assert.equal(data.length, 2)
  // The same calls a second on both lines: the same dots and thickness under calls; under data the line with the larger calls has more of both.
  assert.equal(calls[0].dots, calls[1].dots)
  assert.equal(calls[0].width, calls[1].width)
  assert.ok(data[1].dots! > data[0].dots! && data[1].width > data[0].width)
  // A call of the mean size (1000 B) is what a call is under calls: 100 calls a second of it is the dots 100 calls a second gives.
  assert.equal(data[0].dots, 2)
  assert.equal(data[1].dots, 20)
})

test('the size of a dot says nothing under data: the size is already in the count', () => {
  const r = runs()
  assert.ok(trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'calls').lines.every(l => l.radius !== undefined))
  assert.ok(trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'data').lines.every(l => l.radius === undefined))
})

test('under data, more data on a line is more dots, at every load', () => {
  const r = runs()
  const low = trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'data').lines
  const high = trafficAt(shop(), r, 'sizes', { '': 200 }, 'shop', 'data').lines
  low.forEach((l, i) => assert.ok(high[i].dots! >= l.dots!))
})

test('the scale in words names the data under data', () => {
  const r = runs()
  assert.equal(scaleText(r.sizes), '1 dot = 10 calls/s')
  assert.equal(scaleText(r.sizes, 'data', callSize(r, 'sizes')), '1 dot = 10 KB/s')
  assert.equal(scaleText(r.sizes, 'data'), undefined)
  const lines = trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', 'data').lines
  assert.equal(sourceKeyAt(r, 'sizes', lines, 'data').sources[0].scale, '1 dot = 10 KB/s')
})
