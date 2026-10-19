import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRun } from '../src/core/perf.ts'
import type { State } from '../src/core/state.ts'
import { fromEmbedded, fromState } from '../ui/src/save.ts'

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

test('an embedded state is read as the page shows it: the model, or what is wrong', () => {
  assert.deepEqual(fromEmbedded(JSON.stringify(base)).loaded?.model.objects, {})
  // a folder that is already broken when the VS Code panel opens: the page says which file, and that it updates
  const broken = fromEmbedded(JSON.stringify({ parseError: { file: 'model.yaml', line: 4, message: 'bad indent' } }))
  assert.equal('loaded' in broken, false)
  assert.match(broken.banner ?? '', /Can't read model\.yaml \(line 4\): bad indent\. Fix the file and this page updates\./)
  // anything that isn't a state at all is an export gone wrong
  for (const text of ['', 'not json', 'null', '7'])
    assert.equal(fromEmbedded(text).banner, "This page's model can't be read. Export it again.", text)
})
