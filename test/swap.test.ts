import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planSwap, SWAP_MS, swapDuration } from '../ui/src/swap.ts'

const at = (id: string, x = 0, y = 0) => ({ id, position: { x, y } })

test('a shape in both flows stays and glides, one only in the new flow enters, one only in the old one leaves', () => {
  const plan = planSwap([at('a', 0, 0), at('b', 10, 20)], [at('b', 100, 200), at('c', 5, 5)])
  assert.deepEqual(plan.stay, [{ id: 'b', from: { x: 10, y: 20 }, to: { x: 100, y: 200 } }])
  assert.deepEqual(plan.entering, ['c'])
  assert.deepEqual(plan.leaving, ['a'])
})

test('the same shapes in both flows: nothing enters or leaves', () => {
  const plan = planSwap([at('a', 1, 1), at('b', 2, 2)], [at('a', 1, 1), at('b', 2, 2)])
  assert.deepEqual(plan.entering, [])
  assert.deepEqual(plan.leaving, [])
  assert.equal(plan.stay.length, 2)
})

test('shapes at the same place are still listed as staying: the glide has nowhere to go', () => {
  const plan = planSwap([at('a', 7, 9)], [at('a', 7, 9)])
  assert.deepEqual(plan.stay, [{ id: 'a', from: { x: 7, y: 9 }, to: { x: 7, y: 9 } }])
})

test('no shape in common: all enter and all leave', () => {
  const plan = planSwap([at('a'), at('b')], [at('c'), at('d')])
  assert.deepEqual(plan.stay, [])
  assert.deepEqual(plan.entering, ['c', 'd'])
  assert.deepEqual(plan.leaving, ['a', 'b'])
})

test('either side can be empty', () => {
  assert.deepEqual(planSwap([], [at('a')]), { stay: [], entering: ['a'], leaving: [] })
  assert.deepEqual(planSwap([at('a')], []), { stay: [], entering: [], leaving: ['a'] })
  assert.deepEqual(planSwap([], []), { stay: [], entering: [], leaving: [] })
})

test('the output follows the order of the new flow for staying and entering shapes, and of the old one for leaving', () => {
  const plan = planSwap([at('z'), at('y'), at('x'), at('m')], [at('m'), at('n'), at('x'), at('o')])
  assert.deepEqual(plan.stay.map(s => s.id), ['m', 'x'])
  assert.deepEqual(plan.entering, ['n', 'o'])
  assert.deepEqual(plan.leaving, ['z', 'y'])
})

test('a big pair of flows keeps its order and is not planned in quadratic time', () => {
  const n = 20000
  const from = Array.from({ length: n }, (_, i) => at(`s${i}`, i, 0))
  const to = Array.from({ length: n }, (_, i) => at(`s${i + n / 2}`, 0, i))
  const t = performance.now()
  const plan = planSwap(from, to)
  assert.ok(performance.now() - t < 500)
  assert.equal(plan.stay.length, n / 2)
  assert.equal(plan.stay[0].id, `s${n / 2}`)
  assert.equal(plan.entering[0], `s${n}`)
  assert.equal(plan.leaving[n / 2 - 1], `s${n / 2 - 1}`)
})

test('reduced motion cuts: the swap takes no time', () => {
  assert.equal(swapDuration(true), 0)
  assert.equal(swapDuration(false), SWAP_MS)
})
