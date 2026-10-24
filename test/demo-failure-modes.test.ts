import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { bandOf, coverage, rank, rollUp } from '../src/core/failures.ts'
import { modelOf } from '../src/core/state.ts'
import { loadState } from '../src/node/files.ts'

/** Plum's analysis is the worked example the guide, the README and the screenshots use, so it has to show every feature once and point only at things that exist. */
const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
assert.ok('model' in state && 'flows' in state && state.failures, 'the demo folder should load, with its analysis')
const analysis = state.failures['ordering']
const modes = Object.entries(analysis.modes)

test('the demo loads with no problems in its model, its flows or its analysis', () => {
  assert.deepEqual(state.problems, [])
  assert.deepEqual(state.failureProblems ?? [], [])
})

test('Plum has fourteen modes, and every band is on show', () => {
  assert.equal(modes.length, 14)
  assert.deepEqual([...new Set(modes.map(([, m]) => bandOf(m)))].sort(), ['high', 'low', 'medium', 'unrated'])
})

test('it has a line mode, a mode that is done and has an After, one left Not rated on purpose, and one seen in a run', () => {
  assert.ok(modes.some(([, m]) => m.from !== undefined && m.to !== undefined), 'a line mode')
  assert.ok(modes.some(([, m]) => m.status === 'done' && m.after !== undefined), 'a done mode with an after')
  assert.deepEqual(modes.filter(([, m]) => bandOf(m) === 'unrated').map(([id]) => id), ['fleet-position-writes'])
  assert.ok(modes.some(([, m]) => m.run !== undefined && state.runs?.[m.run]), 'a run link that resolves')
})

test('the two new flows exist, and a mode tells each of them at a step that is there', () => {
  for (const id of ['refund-not-recorded', 'no-courier-answers']) assert.ok(id in state.flows, `${id} is a flow`)
  assert.deepEqual(analysis.modes['refund-not-recorded'].flow, 'refund-not-recorded')
  assert.deepEqual(analysis.modes['offers-no-answer'].flow, 'no-courier-answers')
})

test('every flow and step a mode names is there, counting steps from 1', () => {
  const linked = modes.filter(([, m]) => m.flow !== undefined)
  assert.ok(linked.length >= 6, 'six modes tell a flow')
  for (const [id, m] of linked) {
    assert.ok(m.flow! in state.flows, `${id}: flow ${m.flow} exists`)
    if (m.step !== undefined) {
      const step = Number(m.step)
      assert.ok(Number.isInteger(step) && step >= 1 && step <= state.flows[m.flow!].steps.length, `${id}: step ${m.step} of ${m.flow}`)
    }
  }
})

test('the numbers the README, the guide and docs/maintaining.md quote come out of the analysis', () => {
  const counts = { high: 0, medium: 0, low: 0, unrated: 0 }
  for (const [, m] of modes) counts[bandOf(m)]++
  assert.deepEqual(counts, { high: 2, medium: 5, low: 6, unrated: 1 })
  const whole = modelOf(state)
  const covered = coverage(whole, analysis)
  assert.equal(covered.analysed.length, 15)
  assert.equal(covered.left.length, 11)
  const marks = rollUp(whole, analysis, 'root')
  assert.deepEqual(marks.boxes.ordering, { band: 'high', count: 6 })
  assert.deepEqual(marks.lines['ordering stripe'], { band: 'medium', count: 2 })
  assert.deepEqual(rank(analysis).slice(0, 4).map(r => r.id), ['refund-not-recorded', 'orders-db-down', 'sms-not-delivered', 'eta-mapbox-fails'])
})
