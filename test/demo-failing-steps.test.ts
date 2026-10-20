import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { animationOf } from '../src/core/animation.ts'
import { stopsOf } from '../src/core/structure.ts'
import { loadState } from '../src/node/files.ts'

/** Plum's capture-payment tells its timeout and its decline as steps that fail, so the canvas shows what the text says. */
const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
assert.ok('flows' in state, 'the demo folder should load')
const flow = state.flows['capture-payment']

test('the demo still loads with nothing wrong in it', () => {
  assert.deepEqual(state.problems, [])
})

test('capture-payment keeps its six steps and the six stops they make', () => {
  assert.equal(flow.steps.length, 6)
  assert.deepEqual(stopsOf(flow).map(s => s.steps), [[0], [1], [2], [3], [4], [5]])
})

test('the first step is a call that times out, and the second is the API giving up on its own', () => {
  const [call, gives] = flow.steps
  assert.deepEqual(call.animation, { kind: 'call', outcome: 'timeout' })
  assert.equal(call.text, 'Captures the amount it held')
  assert.deepEqual(animationOf(call), { kind: 'call', trigger: 'inside', outcome: 'timeout' })
  assert.equal(gives.from, 'order-api')
  assert.equal(gives.to, undefined)
  assert.equal(gives.text, 'Gives up after five seconds and tries again')
  assert.equal(animationOf(gives), undefined)
})

test('the decline is a send that fails', () => {
  const decline = flow.steps[4]
  assert.equal(decline.text, 'Declines the card')
  assert.deepEqual(decline.animation, { kind: 'send', outcome: 'fail' })
  assert.deepEqual(animationOf(decline), { kind: 'send', trigger: 'inside', outcome: 'fail' })
})

test('a step that fails says so in its text, so it reads the same with the motion off', () => {
  const failing = flow.steps.filter(s => animationOf(s)?.outcome !== undefined)
  assert.equal(failing.length, 2)
  for (const s of failing) assert.ok(s.text.trim() !== '', s.text)
})
