import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { loadState } from '../src/node/files.ts'

/** flowy/ documents Flowy itself, so it has to know about the failures feature and say how Flowy fails, with nothing wrong in it. */
const state = await loadState(join(import.meta.dirname, '../flowy'))
assert.ok('model' in state, 'the folder should load')

test("Flowy's own folder loads with no problems, in its model or in its analysis", () => {
  assert.deepEqual(state.problems, [])
  assert.deepEqual(state.failureProblems ?? [], [])
})

test('the model has a part for the analyses and one for the tab, joined to the checker and the shell', () => {
  assert.equal(state.model.objects['failures']?.in, 'core')
  assert.equal(state.model.objects['failures-tab']?.in, 'canvas')
  const joined = (from: string, to: string) => state.model.connections.some(c => c.from === from && c.to === to)
  assert.ok(joined('check', 'failures'), 'the checker asks if an analysis is right')
  assert.ok(joined('shell', 'failures-tab'), 'the shell opens the tab')
  assert.ok(joined('failures-tab', 'failures'), 'the tab ranks the rows')
})

test('the analysis says how Flowy fails, in at least six rows that name a part each', () => {
  const modes = Object.values(state.failures?.flowy.modes ?? {})
  assert.ok(modes.length >= 6, `${modes.length} rows`)
  for (const m of modes) assert.ok((m.on ?? m.from) !== undefined, `${m.mode} names a part`)
})
