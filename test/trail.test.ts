import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cameFrom, closeFlow, followBack, openFlow } from '../ui/src/trail.ts'
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

test('the Back button of the player names the flow left and the stop to return to, counted from 1', () => {
  const flows = {
    checkout: { name: 'Customer checks out', view: 'shop', steps: [{ from: 'a', to: 'b', text: 'One' }, { from: 'b', to: 'a', text: 'Two' }, { from: 'a', to: 'b', text: 'Three' }] },
  }
  assert.equal(cameFrom(flows, []), undefined)
  assert.deepEqual(cameFrom(flows, [{ flow: 'checkout', step: 1 }]), { name: 'Customer checks out', step: 2 })
  assert.deepEqual(cameFrom(flows, [{ flow: 'x', step: 0 }, { flow: 'checkout', step: 0 }]), { name: 'Customer checks out', step: 1 }, 'the last place left')
  assert.deepEqual(cameFrom(flows, [{ flow: 'checkout', step: 99 }]), { name: 'Customer checks out', step: 3 }, 'the flow got shorter under a live reload: the last stop')
  assert.deepEqual(cameFrom(flows, [{ flow: 'gone', step: 4 }]), { name: 'gone', step: 5 }, 'the flow is gone: its id and the stop it was at')
})
