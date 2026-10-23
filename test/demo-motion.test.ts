import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { animationOf, ANIMATION_KINDS } from '../src/core/animation.ts'
import { loadState } from '../src/node/files.ts'

/** Plum is the sample people look at first, so every step that hands something from one shape to another moves. */
const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
assert.ok('flows' in state, 'the demo folder should load')
const flows = Object.entries(state.flows)

test('every step of Plum that goes from one shape to another is animated', () => {
  const still = flows.flatMap(([id, flow]) => flow.steps.flatMap((step, i) => (step.to !== undefined && animationOf(step) === undefined ? [`${id} step ${i + 1}`] : [])))
  assert.deepEqual(still, [])
})

test('Plum plays every kind of step, and uses states and every kind of group', () => {
  const kinds = new Set(flows.flatMap(([, flow]) => flow.steps.map(s => animationOf(s)?.kind)))
  for (const kind of ANIMATION_KINDS) assert.ok(kinds.has(kind), `no step plays as a ${kind}`)
  assert.ok(flows.some(([, flow]) => flow.steps.some(s => s.states !== undefined)), 'no step sets a state')
  const groups = new Set(flows.flatMap(([, flow]) => Object.values(flow.groups ?? {}).map(g => g.kind)))
  assert.deepEqual([...groups].sort(), ['branch', 'parallel', 'repeat'])
})

test('Plum keeps something open: the live map is a stream that a later step closes', () => {
  const live = flows.find(([id]) => id === 'follow-the-courier')![1].steps.map(s => animationOf(s))
  assert.equal(live[0]?.opens, 'stream')
  assert.equal(live.at(-1)?.closes, live[0]?.name)
})
