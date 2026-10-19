import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeFlow, followBack, openFlow } from '../ui/src/trail.ts'
import type { Spot } from '../ui/src/trail.ts'

test('opening a flow leaves the place you were at, and closing it gives that place back, last first', () => {
  const one = openFlow([], { flow: 'a', step: 3 })
  const two = openFlow(one, { flow: 'b', step: 0 })
  assert.deepEqual(two, [{ flow: 'a', step: 3 }, { flow: 'b', step: 0 }])
  const first = closeFlow(two)!
  assert.deepEqual(first.back, { flow: 'b', step: 0 })
  assert.deepEqual(closeFlow(first.trail)!.back, { flow: 'a', step: 3 })
  assert.equal(closeFlow([]), undefined)
  assert.deepEqual(one, [{ flow: 'a', step: 3 }]) // nothing is changed in place
})

test('a cycle three deep just grows the trail, and unwinds the same way', () => {
  let trail: Spot[] = []
  for (const [flow, step] of [['a', 1], ['b', 2], ['a', 0]] as const) trail = openFlow(trail, { flow, step })
  const seen: string[] = []
  for (let closed = closeFlow(trail); closed; closed = closeFlow(closed.trail)) seen.push(`${closed.back.flow}${closed.back.step}`)
  assert.deepEqual(seen, ['a0', 'b2', 'a1'])
})

test('Back in the browser returns to the stop the trail remembers when it is the flow the address names, else to the first stop', () => {
  const trail: Spot[] = [{ flow: 'a', step: 4 }, { flow: 'b', step: 2 }]
  assert.deepEqual(followBack(trail, 'b'), { step: 2, trail: [{ flow: 'a', step: 4 }] })
  assert.deepEqual(followBack(trail, 'a'), { step: 0, trail: [] })
  assert.deepEqual(followBack([], 'a'), { step: 0, trail: [] })
})
