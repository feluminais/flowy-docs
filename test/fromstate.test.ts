import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRun } from '../src/core/perf.ts'
import type { State } from '../src/core/state.ts'
import { fromState } from '../ui/src/save.ts'

const base: Extract<State, { model: unknown }> = { model: { objects: {}, connections: [], meta: {} }, layout: {}, flows: {}, problems: [], versions: {} }

test('fromState hands the canvas the runs and what is wrong with them, and none when a folder has none', () => {
  const { run } = parseRun('ramp', 'name: Ramp\nlevels:\n  - load: 1\n  - load: 2\n')
  const problem = { file: 'perf/bad.yaml', message: 'line 1: unresolved merge conflict' }
  const loaded = fromState({ ...base, runs: { ramp: run }, runProblems: [problem] })
  assert.deepEqual(loaded.runs, { ramp: run })
  assert.deepEqual(loaded.runProblems, [problem])
  const none = fromState(base)
  assert.deepEqual(none.runs, {})
  assert.deepEqual(none.runProblems, [])
})
