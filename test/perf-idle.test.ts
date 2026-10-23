import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadOfPosition, dialsOf } from '../src/core/perf/dials.ts'
import { idleOf } from '../src/core/perf/idle.ts'
import { interpolate, levelAt } from '../src/core/perf/levels.ts'
import { parseRun } from '../src/core/perf/parse.ts'
import { trafficAt } from '../src/core/perf/traffic.ts'
import { shop } from './fixtures.ts'

const RUN = `name: Orders
unit: orders/min
entry: web
levels:
  - load: 100
    overall: { rate: 90, p50: 40, p95: 90, errors: 0.01 }
    objects:
      api: { util: 0.4, queue: 3, errors: 0.02 }
    connections:
      - { from: web, to: api, rate: 90, bytes: 300, p50: 20, p95: 40, errors: 0.01, failure: lost }
  - load: 200
    overall: { rate: 180, p50: 60, p95: 150, errors: 0.05 }
    objects:
      api: { util: 0.8, queue: 20, errors: 0.1 }
    connections:
      - { from: web, to: api, rate: 180, bytes: 300, p50: 30, p95: 70, errors: 0.05, failure: lost }
`
const runs = () => ({ orders: parseRun('orders', RUN).run, ghost: parseRun('ghost', 'name: Ghost\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n').run })

test('a load run has an idle level: nothing used, queued, called or failing, and a call as heavy and as slow as at the first level', () => {
  const idle = idleOf(runs().orders)!
  assert.equal(idle.load, 0)
  assert.deepEqual(idle.objects.api, { util: 0, queue: 0, errors: 0 })
  assert.deepEqual(idle.connections[0], { from: 'web', to: 'api', rate: 0, bytes: 300, p50: 20, p95: 40, errors: 0, failure: 'lost' })
  assert.deepEqual(idle.overall, { rate: 0, p50: 40, p95: 90, errors: 0 })
})

test('a run over time has none, and neither has a run whose first level is at no load', () => {
  assert.equal(idleOf(runs().ghost), undefined)
  assert.equal(idleOf(parseRun('zero', 'name: Z\nunit: u\nlevels:\n  - load: 0\n  - load: 10\n').run), undefined)
})

test('between no load and the first level a run is worked out as it is between two tested ones', () => {
  const half = interpolate(runs().orders, 50)
  assert.equal(half.load, 50)
  assert.equal(half.objects.api.util, 0.2)
  assert.equal(half.objects.api.queue, 1.5)
  assert.equal(half.connections[0].rate, 45)
  assert.equal(half.connections[0].p50, 20)
  assert.equal(interpolate(runs().orders, 0).connections[0].rate, 0)
  assert.equal(interpolate(runs().orders, -40).load, 0, 'below no load is no load')
  assert.equal(interpolate(runs().orders, 100).connections[0].rate, 90, 'a tested level is exactly what was measured')
})

test('a dial that can be idle goes down to no load, and a position of -1 is no load', () => {
  const found = dialsOf(runs(), 'orders')!
  assert.equal(found.dials[0].idle, true)
  assert.deepEqual(found.dials[0].values, [100, 200])
  assert.equal(loadOfPosition([100, 200], -1), 0)
  assert.equal(loadOfPosition([100, 200], -0.25), 75)
  assert.equal(loadOfPosition([100, 200], -9), 0)
  assert.equal(loadOfPosition([100, 200], 0), 100)
  assert.equal(levelAt(runs(), 'orders', { '': 0 }).load, 0)
  assert.equal(levelAt(runs(), 'orders', { '': -5 }).load, 0)
  assert.equal(levelAt(runs(), 'orders', { '': Number.NaN }).load, 100, 'a load that is not a number is the lowest tested')
})

test('at no load nothing runs on the lines and nothing is strained', () => {
  const t = trafficAt(shop(), runs(), 'orders', { '': 0 }, 'shop')
  assert.ok(t.lines.every(l => l.perSecond === 0))
  assert.ok(Object.values(t.boxes).every(b => b.queue === 0 && (b.strain ?? 0) === 0))
})
