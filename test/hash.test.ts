import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROOT } from '../src/core/model.ts'
import { readHash, toHash } from '../ui/src/hash.ts'

test('an address and what it names go both ways', () => {
  const cases: [string, string?][] = [[ROOT], ['shop'], ['shop', 'checkout'], [ROOT, 'tour']]
  for (const [view, flow] of cases) assert.deepEqual(readHash(toHash(view, flow)), flow ? { view, flow } : { view })
  assert.equal(toHash(ROOT), '')
  assert.equal(toHash('shop'), '#shop')
  assert.equal(toHash('shop', 'checkout'), '#shop/checkout')
  assert.equal(toHash(ROOT, 'tour'), '#root/tour')
})

test('an address that is not ids opens the overview, and a flow that is not an id is dropped', () => {
  for (const hash of ['', '#', '#Shop', '#a/b/c', '#../x', '#shop%20x']) assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.deepEqual(readHash('#shop/Bad'), { view: 'shop' })
  assert.deepEqual(readHash('#shop/'), { view: 'shop' })
})

test('an address can name a failure analysis and a mode, and goes both ways', () => {
  assert.equal(toHash('shop', undefined, undefined, { analysis: 'ordering' }), '#shop/failures/ordering')
  assert.equal(toHash('shop', undefined, undefined, { analysis: 'ordering', mode: 'db-down' }), '#shop/failures/ordering/db-down')
  assert.equal(toHash(ROOT, undefined, undefined, { analysis: 'ordering' }), '#root/failures/ordering')
  assert.deepEqual(readHash('#shop/failures/ordering'), { view: 'shop', failures: { analysis: 'ordering' } })
  assert.deepEqual(readHash('#shop/failures/ordering/db-down'), { view: 'shop', failures: { analysis: 'ordering', mode: 'db-down' } })
  for (const f of [{ analysis: 'a' }, { analysis: 'a', mode: 'b' }]) assert.deepEqual(readHash(toHash('shop', undefined, undefined, f)), { view: 'shop', failures: f })
  assert.deepEqual(readHash('#shop/failures/constructor'), { view: 'shop', failures: { analysis: 'constructor' } }) // an id, so a valid name
  assert.equal(toHash('shop', undefined, { run: 'ramp', level: 1 }, { analysis: 'ordering' }), '#shop/perf/ramp/1') // a run on show wins
})

test('an address that is not a failure address reads as the overview, or as a flow called failures', () => {
  for (const hash of ['#shop/failures/Ordering', '#shop/failures/ordering/Bad', '#shop/failures/ordering/x/y', '#shop/failure/ordering', '#Bad/failures/ordering', '#shop/failures/', '#shop/failures//x'])
    assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.deepEqual(readHash('#shop/failures'), { view: 'shop', flow: 'failures' })
})

test('an address can name a run and a tested level, and no other address reads as one', () => {
  assert.equal(toHash('shop', undefined, { run: 'ramp', level: 4 }), '#shop/perf/ramp/4')
  assert.equal(toHash(ROOT, undefined, { run: 'ramp', level: 0 }), '#root/perf/ramp/0')
  assert.deepEqual(readHash('#shop/perf/ramp/4'), { view: 'shop', perf: { run: 'ramp', level: 4 } })
  assert.deepEqual(readHash('#root/perf/slow-gateway/12'), { view: ROOT, perf: { run: 'slow-gateway', level: 12 } })
  assert.deepEqual(readHash(toHash('shop', undefined, { run: 'ramp', level: 4 })), { view: 'shop', perf: { run: 'ramp', level: 4 } })
  // the wrong word, a run or level that is not valid, a missing or extra part, and a view that is not an id
  for (const hash of ['#shop/runs/ramp/1', '#shop/perf/Ramp/1', '#shop/perf/ramp/x', '#shop/perf/ramp/-1', '#shop/perf/ramp', '#shop/perf/ramp/1/2', '#Bad/perf/ramp/1'])
    assert.deepEqual(readHash(hash), { view: ROOT }, hash)
  assert.deepEqual(readHash('#shop/perf'), { view: 'shop', flow: 'perf' }) // a flow can be called perf
})
