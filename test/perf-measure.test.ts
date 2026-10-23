import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callSize } from '../src/core/perf/measure.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import { scaleText, sourceKeyAt } from '../src/core/perf/text.ts'
import { BARE_STRIPES, trafficAt, traffic } from '../src/core/perf/traffic.ts'
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
/** The same run with no formula for its dots: the number of blobs follows the data a second. */
const plain = () => ({ sizes: parseRun('sizes', RUN.replace('source: { color: blue, dot: rate / 10, size: bytes / 1000 }', 'source: { color: blue }')).run })
const at = (measure: 'calls' | 'data' | 'mixed', load = 100) => trafficAt(shop(), plain(), 'sizes', { '': load }, 'shop', measure).lines.filter(l => l.bare !== true)

test('the size of a call to count against is the run\'s mean, rounded to 1, 2 or 5 times a power of ten', () => {
  assert.equal(callSize(runs(), 'sizes'), 1000)
  assert.equal(callSize(runs(), 'ghost'), undefined)
})

test('calls are stripes along the line and nothing else: busier with more calls, no blobs', () => {
  const low = at('calls', 100)
  const high = at('calls', 200)
  assert.equal(low.length, 2)
  for (const l of low) {
    assert.ok(l.stripes! > 0 && l.stripes! < 1)
    assert.equal(l.dots, undefined)
    assert.equal(l.perSecond, 0)
    assert.equal(l.radius, undefined)
    assert.equal(l.bare, undefined)
  }
  assert.equal(low[0].stripes, low[1].stripes, 'the same calls a second, however big they are')
  assert.ok(high[0].stripes! > low[0].stripes!)
  assert.ok(high[0].width > low[0].width)
})

test('data is blobs and nothing else: the more bytes a second, the more of them', () => {
  const lines = at('data')
  assert.equal(lines.length, 2)
  for (const l of lines) assert.equal(l.stripes, undefined)
  // 200 B and 2000 B calls at 100 a second: ten times the data on the second line, so it is thicker and has more blobs a second.
  assert.ok(lines[1].perSecond > lines[0].perSecond)
  assert.ok(lines[1].width > lines[0].width)
  assert.equal(lines[0].dots, undefined, 'with no formula for them the blobs follow the curve, not a count')
  // A source's `dot` formula says how many blobs there are, and reads the calls a second and the size of a call as it always did.
  const counted = trafficAt(shop(), runs(), 'sizes', { '': 100 }, 'shop', 'data').lines.filter(l => l.bare !== true)
  assert.deepEqual(counted.map(l => l.dots), [10, 10])
  assert.deepEqual(counted.map(l => l.radius), [0.5, 1.41])
})

test('mixed draws both on one line: stripes for the calls and blobs for the data', () => {
  const calls = at('calls')
  const data = at('data')
  const mixed = at('mixed')
  assert.equal(mixed.length, 2)
  mixed.forEach((l, i) => {
    assert.equal(l.stripes, calls[i].stripes)
    assert.equal(l.perSecond, data[i].perSecond)
    assert.equal(l.width, calls[i].width, 'the line is as thick as its calls say')
  })
})

test('a line the run gives nothing to show is drawn with plain stripes, and one that has numbers is not', () => {
  const t = traffic(shop(), runs().sizes, 100, 'shop')
  assert.deepEqual(t.lines.filter(l => l.bare !== true).map(l => [l.from, l.to]), [['web', 'api'], ['api', 'db']])
  const none = parseRun('none', 'name: None\nunit: u\nlevels:\n  - load: 1\n    objects:\n      api: { util: 0.2 }\n  - load: 2\n    objects:\n      api: { util: 0.4 }\n').run
  const bare = traffic(shop(), none, 1, 'shop').lines
  assert.ok(bare.length > 0)
  for (const l of bare) {
    assert.equal(l.bare, true)
    assert.equal(l.stripes, BARE_STRIPES)
    assert.equal(l.perSecond, 0)
  }
  // The same lines under Data, when the run gives rates but no sizes: no blobs to draw, so they are plain stripes too.
  const rated = parseRun('rated', RUN.replace(/, bytes: \d+/g, '')).run
  assert.ok(trafficAt(shop(), { rated }, 'rated', { '': 100 }, 'shop', 'data').lines.every(l => l.bare === true))
  assert.equal(trafficAt(shop(), { rated }, 'rated', { '': 100 }, 'shop', 'mixed').lines.filter(l => l.bare !== true).length, 2, 'mixed still has the calls to show')
})

test('the scale in words names the data a blob stands for', () => {
  const r = runs()
  assert.equal(scaleText(r.sizes, 'data', callSize(r, 'sizes')), '1 dot = 10 KB/s')
  assert.equal(scaleText(r.sizes, 'mixed', callSize(r, 'sizes')), '1 dot = 10 KB/s')
  assert.equal(scaleText(r.sizes, 'data'), undefined)
  const lines = (measure: 'calls' | 'data') => trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', measure).lines
  assert.equal(sourceKeyAt(r, 'sizes', lines('data'), 'data').sources[0].scale, '1 dot = 10 KB/s')
  assert.equal(sourceKeyAt(r, 'sizes', lines('calls'), 'calls').sources[0].scale, undefined, 'there are no blobs to count')
})
