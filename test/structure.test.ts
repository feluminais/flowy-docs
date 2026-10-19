import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Flow, Step } from '../src/core/model.ts'
import { runsOf, stopsOf } from '../src/core/structure.ts'

const step = (extra: Partial<Step> = {}): Step => ({ from: 'a', to: 'b', text: 't', ...extra })
const flowOf = (groups: Flow['groups'] | undefined, steps: Step[]): Flow => ({ name: 'F', view: 'root', ...(groups ? { groups } : {}), steps })
const stepsOf = (flow: Flow) => stopsOf(flow).map(s => s.steps)

test('a flow with no groups has one stop per step, each coming after the one before', () => {
  const flow = flowOf(undefined, [step(), step(), step()])
  assert.deepEqual(runsOf(flow), [])
  assert.deepEqual(stopsOf(flow), [{ steps: [0], before: [] }, { steps: [1], before: [0] }, { steps: [2], before: [1] }])
})

test('a repeat is a run of stops of their own, with no lanes', () => {
  const flow = flowOf({ r: { kind: 'repeat', times: '3' } }, [step(), step({ group: 'r' }), step({ group: 'r' }), step()])
  assert.deepEqual(runsOf(flow), [{ group: 'r', kind: 'repeat', start: 1, end: 2, lanes: [] }])
  assert.deepEqual(stopsOf(flow), [
    { steps: [0], before: [] },
    { steps: [1], group: 'r', kind: 'repeat', before: [0] },
    { steps: [2], group: 'r', kind: 'repeat', before: [1] },
    { steps: [3], before: [2] },
  ])
})

test('a branch walks every lane in turn, and a lane\'s first stop follows what came before the branch', () => {
  const flow = flowOf({ b: { kind: 'branch' } }, [
    step(), step({ group: 'b', lane: 'A' }), step({ group: 'b' }), step({ group: 'b', lane: ' B ' }), step(),
  ])
  assert.deepEqual(runsOf(flow), [{ group: 'b', kind: 'branch', start: 1, end: 3, lanes: [{ label: 'A', steps: [1, 2] }, { label: 'B', steps: [3] }] }])
  const stops = stopsOf(flow)
  assert.deepEqual(stops.map(s => s.steps), [[0], [1], [2], [3], [4]])
  assert.deepEqual(stops.slice(1, 4).map(s => ({ lanes: s.lanes, labels: s.laneLabels, before: s.before })), [
    { lanes: [0], labels: ['A', 'B'], before: [0] },
    { lanes: [0], labels: ['A', 'B'], before: [1] },
    { lanes: [1], labels: ['A', 'B'], before: [0] },
  ])
  assert.deepEqual(stops[4].before, [3])
})

test('parallel lanes are zipped: stop k holds the k-th step of every lane, and shorter lanes drop out', () => {
  const flow = flowOf({ p: { kind: 'parallel' } }, [
    step(),
    step({ group: 'p', lane: 'a' }), step({ group: 'p' }),
    step({ group: 'p', lane: 'b' }),
    step({ group: 'p', lane: 'c' }), step({ group: 'p' }), step({ group: 'p' }),
  ])
  assert.deepEqual(stepsOf(flow), [[0], [1, 3, 4], [2, 5], [6]])
  const [, first, second, third] = stopsOf(flow)
  assert.deepEqual({ lanes: first.lanes, before: first.before, labels: first.laneLabels }, { lanes: [0, 1, 2], before: [0], labels: ['a', 'b', 'c'] })
  assert.deepEqual({ lanes: second.lanes, before: second.before }, { lanes: [0, 2], before: [1, 3, 4] })
  assert.deepEqual({ lanes: third.lanes, before: third.before }, { lanes: [2], before: [2, 5] })
})

test('a fan-out of five one-step lanes is one stop', () => {
  const lanes = ['a', 'b', 'c', 'd', 'e'].map(l => step({ group: 'p', lane: l }))
  assert.deepEqual(stepsOf(flowOf({ p: { kind: 'parallel' } }, lanes)), [[0, 1, 2, 3, 4]])
})

test('groups side by side are separate runs, and a group may start or end a flow', () => {
  const flow = flowOf({ r: { kind: 'repeat', until: 'x' }, p: { kind: 'parallel' } }, [
    step({ group: 'r' }), step({ group: 'p', lane: 'a' }), step({ group: 'p', lane: 'b' }),
  ])
  assert.deepEqual(runsOf(flow).map(r => [r.group, r.start, r.end]), [['r', 0, 0], ['p', 1, 2]])
  assert.deepEqual(stopsOf(flow).map(s => [s.steps, s.before]), [[[0], []], [[1, 2], [0]]])
})

test('a flow with problems still has stops: every step is in exactly one', () => {
  const flows: Flow[] = [
    flowOf({}, [step({ group: 'nope' }), step({ lane: 'x' }), step()]), // undeclared group, lane without a group
    flowOf({ g: { kind: 'loop' } }, [step({ group: 'g' }), step({ group: 'g' })]), // unknown kind
    flowOf({}, [step({ group: 'constructor' }), step({ group: '__proto__' }), step({ group: 'toString' })]), // names Object has
    flowOf({ r: { kind: 'repeat', times: '2' } }, [step({ group: 'r' }), step(), step({ group: 'r' })]), // a group split in two
    flowOf({ b: { kind: 'branch' } }, [step({ group: 'b' }), step({ group: 'b', lane: 'x' })]), // the first member has no lane
    flowOf({ p: { kind: 'parallel' } }, [step({ group: ' p ', lane: ' ' }), step({ group: 'p', lane: 'a' }), step({ group: 'p', lane: 'a' })]),
    flowOf(undefined, []),
  ]
  for (const flow of flows) {
    const seen = stopsOf(flow).flatMap(s => s.steps).sort((a, b) => a - b)
    assert.deepEqual(seen, flow.steps.map((_, i) => i))
  }
  assert.deepEqual(runsOf(flowOf({ b: { kind: 'branch' } }, [step({ group: 'b' }), step({ group: 'b', lane: 'x' })]))[0].lanes, [{ label: '', steps: [0] }, { label: 'x', steps: [1] }])
  assert.deepEqual(runsOf(flowOf({ r: { kind: 'repeat', times: '2' } }, [step({ group: 'r' }), step(), step({ group: 'r' })])).map(r => [r.start, r.end]), [[0, 0], [2, 2]])
})

test('a blank group is no group, and an id that Object has is an ordinary undeclared one', () => {
  assert.deepEqual(runsOf(flowOf({ r: { kind: 'repeat', times: '2' } }, [step({ group: ' ' }), step({ group: '' })])), [])
  assert.deepEqual(runsOf(flowOf(undefined, [step({ group: 'constructor' })])), [])
})
