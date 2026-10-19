import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pushedState, stateMessage } from '../src/core/state.ts'
import type { State } from '../src/core/state.ts'

const state: State = { model: { objects: {}, connections: [], meta: {} }, layout: {}, flows: {}, problems: [], versions: {} }

test('a host pushes a state as a message and the page reads it back', () => {
  assert.deepEqual(pushedState(stateMessage(state)), state)
})

test('a state that stops the model loading is pushed the same way', () => {
  const broken: State = { parseError: { file: 'model.yaml', line: 3, message: 'bad indent' } }
  assert.deepEqual(pushedState(stateMessage(broken)), broken)
})

test('anything else the page is sent is not a state', () => {
  for (const data of [undefined, null, 'flowy-state', 7, [], {}, { type: 'other', state }, { type: 'flowy-state' }, { type: 'flowy-state', state: null }, { type: 'flowy-state', state: 'x' }, { type: 'flowy-state', state: {} }])
    assert.equal(pushedState(data), undefined, JSON.stringify(data))
})
