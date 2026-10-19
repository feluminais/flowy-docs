import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Busy, Edge, percentile, Ratio, Stats } from '../perf-lab/src/stats.ts'

test('percentile takes the nearest rank of sorted numbers', () => {
  const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  assert.equal(percentile([], 50), undefined)
  assert.equal(percentile(ten, 50), 5)
  assert.equal(percentile(ten, 95), 10)
  assert.equal(percentile(ten, 0), 1)
  assert.equal(percentile([7], 95), 7)
})

test('Busy is the time-weighted share of a resource that was in use, and take starts over', () => {
  let now = 0
  const busy = new Busy(() => now)
  busy.enter()
  now = 50
  busy.leave()
  now = 100
  assert.equal(busy.take(1), 0.5)
  // Two at once for the whole of the next 100 ms, of room for four.
  busy.enter()
  busy.enter()
  now = 200
  assert.equal(busy.take(4), 0.5)
  assert.equal(busy.take(4), 0) // nothing has passed since
  busy.leave()
  busy.leave()
  now = 300
  assert.equal(busy.take(1), 0)
})

test('Busy never reports more than all of the capacity', () => {
  let now = 0
  const busy = new Busy(() => now)
  busy.enter()
  busy.enter()
  now = 100
  assert.equal(busy.take(1), 1)
})

test('Edge turns what was recorded into run-file numbers, once', () => {
  const edge = new Edge()
  for (let ms = 1; ms <= 10; ms++) edge.record(ms, ms > 2)
  assert.deepEqual(edge.take(2), { rate: 5, p50: 5, p95: 10, errors: 0.2 })
  assert.equal(edge.take(2), undefined)
})

test('Edge.track times a call, and a call that throws counts as failed and still throws', async () => {
  const edge = new Edge()
  assert.equal(await edge.track(async () => 'fine'), 'fine')
  await assert.rejects(edge.track(async () => { throw new Error('no') }), /no/)
  assert.equal(edge.take(1)?.errors, 0.5)
})

test('Ratio is the share that failed, once', () => {
  const ratio = new Ratio()
  assert.equal(ratio.take(), undefined)
  ratio.hit(true)
  ratio.hit(false)
  ratio.hit(true)
  ratio.hit(true)
  assert.equal(ratio.take(), 0.25)
  assert.equal(ratio.take(), undefined)
})

test('Stats gathers its probes and edges into one level, and leaves out what was not measured', () => {
  const stats = new Stats()
  assert.equal(stats.edge('a', 'b'), stats.edge('a', 'b'))
  stats.edge('a', 'b').record(4)
  stats.edge('a', 'c') // never called
  stats.probe('a', 'util', () => 0.5)
  stats.probe('a', 'errors', () => undefined)
  stats.probe('b', 'queue', () => 3)
  const { objects, connections } = stats.snapshot()
  assert.deepEqual(objects, { a: { util: 0.5 }, b: { queue: 3 } })
  assert.equal(connections.length, 1)
  assert.equal(connections[0].from, 'a')
  assert.equal(connections[0].to, 'b')
  assert.ok(connections[0].rate! > 0 && connections[0].p50 === 4 && connections[0].errors === 0)
  assert.deepEqual(stats.snapshot().connections, []) // the interval began again
})
