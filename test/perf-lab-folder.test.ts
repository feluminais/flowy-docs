import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { modelFiles } from '../src/core/model.ts'
import { loadState } from '../src/node/files.ts'

test('the lab documents itself, and its two committed runs fit its model', async () => {
  const state = await loadState(join(import.meta.dirname, '../perf-lab/flowy'))
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, [])
  assert.equal('runProblems' in state, false)
  assert.deepEqual(Object.keys(state.runs ?? {}), ['ramp', 'slow-gateway'])
  for (const run of Object.values(state.runs ?? {})) assert.ok(run.levels.length >= 5, `${run.name} has ${run.levels.length} levels`)
})

test('the folders the repo ships can be edited in the canvas: their files can all be written out again', async () => {
  for (const dir of ['../perf-lab/flowy', '../flowy', '../example']) {
    const state = await loadState(join(import.meta.dirname, dir))
    assert.ok('model' in state, dir)
    // a flow-style line with an unquoted comma in a label reads as a stray key with no value, which the writer refuses
    assert.doesNotThrow(() => modelFiles({ ...state.model, flows: state.flows, layout: state.layout }), dir)
  }
})
