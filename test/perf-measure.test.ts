import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callSize, loadPace } from '../src/core/perf/measure.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import { scaleText, sourceKeyAt } from '../src/core/perf/text.ts'
import { BARE_STRIPES, trafficAt, traffic } from '../src/core/perf/traffic.ts'
import { shop } from './fixtures.ts'

/** The same two lines at two loads: web to api carries small calls (200 B) and api to db large ones (2000 B), at the same rate. */
const RUN = `name: Sizes
unit: req/s
entry: web
source: { color: blue }
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
const runs = (text = RUN) => ({ sizes: parseRun('sizes', text).run })
const at = (measure: 'calls' | 'data' | 'mixed', load = 100, r = runs()) => trafficAt(shop(), r, 'sizes', { '': load }, 'shop', measure).lines.filter(l => l.bare !== true)

test('the size of a call to count against is the run\'s mean, rounded to 1, 2 or 5 times a power of ten', () => {
  assert.equal(callSize(runs(), 'sizes'), 1000)
  assert.equal(callSize(runs(), 'ghost'), undefined)
})

test('calls are dots counted by the calls a second, all the usual size, and the sizes of the calls change nothing', () => {
  const lines = at('calls')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].perSecond, lines[1].perSecond, 'the same calls a second, however big they are')
  assert.equal(lines[0].width, lines[1].width)
  for (const l of lines) assert.equal(l.radius, undefined)
  assert.ok(at('calls', 200)[0].perSecond > lines[0].perSecond)
})

test('data counts the bytes a second: the same calls, ten times the size, is more dots and a thicker line', () => {
  const lines = at('data')
  assert.ok(lines[1].perSecond > lines[0].perSecond)
  assert.ok(lines[1].width > lines[0].width)
  for (const l of lines) assert.equal(l.radius, undefined, 'the size is in the count, so dots are the usual size')
})

test('mixed counts the calls and sizes each dot by its call: twice the bytes is twice the area', () => {
  const mixed = at('mixed')
  const calls = at('calls')
  mixed.forEach((l, i) => {
    assert.equal(l.perSecond, calls[i].perSecond)
    assert.equal(l.width, calls[i].width)
  })
  // 200 B and 2000 B against a typical call of 1000 B: the radius is the square root of the share, between a small dot and a big one.
  assert.deepEqual(mixed.map(l => l.radius), [0.5, 1.41])
  // A source's own `size` formula still says how big the dots are.
  const sized = at('mixed', 100, runs(RUN.replace('source: { color: blue }', 'source: { color: blue, size: bytes / 400 }')))
  assert.deepEqual(sized.map(l => l.radius), [0.71, 2.24])
  // A line with no size of a call has the usual dots.
  const noBytes = at('mixed', 100, runs(RUN.replace('bytes: 200, ', '')))
  assert.equal(noBytes[0].radius, undefined)
})

test('a line the run gives nothing to show is drawn with plain stripes, and one that has numbers is not', () => {
  const t = traffic(shop(), runs().sizes, 100, 'shop')
  assert.deepEqual(t.lines.filter(l => l.bare !== true).map(l => [l.from, l.to]), [['web', 'api'], ['api', 'db']])
  const none = parseRun('none', 'name: None\nunit: u\nlevels:\n  - load: 1\n    objects:\n      api: { util: 0.2 }\n  - load: 2\n    objects:\n      api: { util: 0.4 }\n').run
  const bare = traffic(shop(), none, 1, 'shop').lines
  assert.ok(bare.length > 0)
  for (const l of bare) {
    assert.equal(l.bare, true)
    assert.equal(l.stripes, BARE_STRIPES, 'with nothing saying how loaded the run is, a middling pace')
    assert.equal(l.perSecond, 0)
  }
  // Under Data a line with a rate and no sizes has nothing to count either.
  const rated = parseRun('rated', RUN.replace(/, bytes: \d+/g, '')).run
  assert.ok(trafficAt(shop(), { rated }, 'rated', { '': 100 }, 'shop', 'data').lines.every(l => l.bare === true))
  assert.equal(trafficAt(shop(), { rated }, 'rated', { '': 100 }, 'shop', 'mixed').lines.filter(l => l.bare !== true).length, 2)
})

test('plain stripes speed up as the run is loaded, even on a line it gives no numbers', () => {
  const r = runs()
  assert.equal(loadPace(r, 'sizes', { '': 200 }), 1)
  assert.equal(loadPace(r, 'sizes', { '': 100 }), 0.5)
  assert.equal(loadPace(r, 'sizes', { '': 0 }), 0)
  assert.equal(loadPace(r, 'ghost', { '': 1 }), undefined)
  const stripes = (load: number) => trafficAt(shop(), r, 'sizes', { '': load }, 'shop').lines.filter(l => l.bare === true).map(l => l.stripes!)
  const [low, mid, high] = [stripes(0), stripes(100), stripes(200)]
  assert.ok(low.length > 0 && low[0] < mid[0] && mid[0] < high[0])
  assert.equal(low[0], 0.1)
  assert.equal(high[0], 1)
  const time = parseRun('time', 'name: T\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n').run
  assert.equal(loadPace({ time }, 'time', { '': 2 }), undefined, 'a run over time has no load to follow')
})

test('the scale in words names what a dot stands for: calls under Calls and Mixed, data under Data', () => {
  const r = runs(RUN.replace('source: { color: blue }', 'source: { color: blue, dot: rate / 10 }'))
  assert.equal(scaleText(r.sizes), '1 dot = 10 calls/s')
  assert.equal(scaleText(r.sizes, 'mixed', callSize(r, 'sizes')), '1 dot = 10 calls/s')
  assert.equal(scaleText(r.sizes, 'data', callSize(r, 'sizes')), '1 dot = 10 KB/s')
  assert.equal(scaleText(r.sizes, 'data'), undefined)
  const lines = (measure: 'calls' | 'data' | 'mixed') => trafficAt(shop(), r, 'sizes', { '': 100 }, 'shop', measure).lines
  assert.equal(sourceKeyAt(r, 'sizes', lines('data'), 'data').sources[0].scale, '1 dot = 10 KB/s')
  assert.equal(sourceKeyAt(r, 'sizes', lines('mixed'), 'mixed').sources[0].scale, '1 dot = 10 calls/s')
})
