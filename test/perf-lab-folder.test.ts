import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { modelFiles } from '../src/core/model.ts'
import { modelOf } from '../src/core/state.ts'
import { knee, scaleText } from '../src/core/perf.ts'
import { loadState } from '../src/node/files.ts'

test('the lab documents itself, and its two committed runs fit its model', async () => {
  const state = await loadState(join(import.meta.dirname, '../perf-lab/flowy'))
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, [])
  assert.equal('runProblems' in state, false)
  assert.deepEqual(Object.keys(state.runs ?? {}), ['ramp', 'slow-gateway'])
  for (const run of Object.values(state.runs ?? {})) assert.ok(run.levels.length >= 5, `${run.name} has ${run.levels.length} levels`)
})

test('the demo, Plum, has four made-up runs that fit its model: the first is where Delivery gives way, the second the same test after a fix, the third courier pings with a dot scale, the fourth Stripe going down over time', async () => {
  const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, [])
  assert.equal('runProblems' in state, false)
  assert.deepEqual(Object.keys(state.runs ?? {}), ['dinner-rush', 'eta-batched', 'pings-climbing', 'stripe-outage']) // the file names sort so that the demo opens on the dinner rush
  const [rush, batched, pings, outage] = Object.values(state.runs ?? {})
  assert.deepEqual(rush.levels.map(l => l.load), [100, 300, 600, 900, 1200])
  assert.deepEqual(batched.levels.map(l => l.load), [100, 300, 600, 900, 1200])
  assert.deepEqual(knee(rush), { index: 3, load: 900, by: { id: 'eta', kind: 'util', share: 0.9 } })
  assert.equal(knee(batched), undefined)
  assert.match(rush.about ?? '', /made-up/i) // the demo says its numbers are invented
  assert.match(batched.about ?? '', /made-up/i)
  assert.match(pings.about ?? '', /made-up/i)
  assert.deepEqual(pings.levels.map(l => l.load), [50, 100, 200, 400, 800])
  assert.equal(pings.unit, 'pings/s')
  assert.equal(pings.source?.color, 'green')
  assert.equal(pings.source?.dot?.text, 'rate / 20')
  assert.equal(scaleText(pings), '1 dot = 20 calls/s')
  assert.deepEqual(knee(pings), { index: 4, load: 800, by: { id: 'fleet-db', kind: 'util', share: 0.93 } })
  // the outage is a run over time: Stripe is killed at 40 s, restarts at 70 s and answers at 85 s, and every event names a shape the demo has
  assert.match(outage.about ?? '', /made-up/i)
  assert.equal(outage.axis, 'time')
  assert.equal(outage.unit, 's')
  assert.deepEqual(outage.levels.map(l => l.load), [0, 30, 45, 60, 90, 120, 150])
  assert.deepEqual(outage.events?.map(e => [e.at, e.on, e.state, e.text]), [
    [40, 'stripe', 'stopped', 'Payments killed'], [70, 'stripe', 'starting', 'Restart begins'], [85, 'stripe', 'running', 'Answers again'],
  ])
  assert.deepEqual(knee(outage), { index: 2, load: 45, by: { id: 'checkout', kind: 'errors', share: 0.3 } })
})

test('the folders the repo ships can be edited in the canvas: their files can all be written out again', async () => {
  for (const dir of ['../perf-lab/flowy', '../flowy', '../example', '../docs/demo/flowy']) {
    const state = await loadState(join(import.meta.dirname, dir))
    assert.ok('model' in state, dir)
    // a flow-style line with an unquoted comma in a label reads as a stray key with no value, which the writer refuses
    assert.doesNotThrow(() => modelFiles(modelOf(state)), dir)
  }
})
