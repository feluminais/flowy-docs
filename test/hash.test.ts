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
