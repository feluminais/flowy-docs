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
