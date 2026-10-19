import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captionOf, progressOf } from '../src/core/captions.ts'
import type { Flow, Step } from '../src/core/model.ts'
import { stopIndexOf, stopsOf } from '../src/core/structure.ts'

const step = (extra: Partial<Step> = {}): Step => ({ from: 'a', to: 'b', text: 't', ...extra })
const flowOf = (groups: Flow['groups'] | undefined, steps: Step[]): Flow => ({ name: 'F', view: 'root', ...(groups ? { groups } : {}), steps })
const captions = (flow: Flow) => stopsOf(flow).map(s => captionOf(flow, s))

// The example of the design: a repeat of two steps, a branch of two lanes (two steps and one), and a parallel group of two lanes.
const example = flowOf({ charge: { kind: 'repeat', times: '3', text: 'Backs off' }, outcome: { kind: 'branch' }, tell: { kind: 'parallel' } }, [
  step({ group: 'charge' }), step({ group: 'charge' }),
  step({ group: 'outcome', lane: 'Card accepted' }), step({ group: 'outcome' }), step({ group: 'outcome', lane: 'Card declined' }),
  step({ group: 'tell', lane: 'Billing' }), step({ group: 'tell', lane: 'Dispatch' }),
])

test('a repeat says how often, and what it has: times, until, both or neither', () => {
  const chip = (g: Record<string, string>) => captions(flowOf({ r: { kind: 'repeat', ...g } }, [step({ group: 'r' })]))[0]
  assert.equal(chip({ times: '3' }).chip, 'Repeats up to 3 times')
  assert.equal(chip({ until: 'it works' }).chip, 'Repeats until it works')
  assert.equal(chip({ times: '3', until: 'it works' }).chip, 'Repeats up to 3 times, until it works')
  assert.equal(chip({ text: 'only words' }).chip, 'Repeats')
  assert.deepEqual(chip({ times: '3', text: ' Backs off ' }), { chip: 'Repeats up to 3 times', text: 'Backs off', tabs: [], tab: -1, lanes: [], marks: ['up to 3'] })
  assert.deepEqual(chip({ until: 'x' }).marks, ['until x'])
  assert.deepEqual(chip({}).marks, [''])
})

test('a branch says how many lanes it has and which one this stop is in', () => {
  const [a, b, c] = captions(example).slice(2, 5)
  assert.deepEqual(a, { chip: 'One of 2', text: '', tabs: ['Card accepted', 'Card declined'], tab: 0, lanes: [], marks: ['Card accepted'] })
  assert.equal(b.tab, 0)
  assert.deepEqual({ tab: c.tab, marks: c.marks }, { tab: 1, marks: ['Card declined'] })
  const one = captions(flowOf({ b: { kind: 'branch' } }, [step({ group: 'b', lane: 'A courier is wanted' })]))[0]
  assert.deepEqual({ chip: one.chip, tabs: one.tabs }, { chip: 'Only if', tabs: ['A courier is wanted'] })
})

test('parallel lanes are named by step, and a lane that has run out is left out', () => {
  const flow = flowOf({ p: { kind: 'parallel' } }, [step({ group: 'p', lane: 'a' }), step({ group: 'p' }), step({ group: 'p', lane: 'b' }), step({ group: 'p', lane: 'c' }), step({ group: 'p' })])
  const [first, second] = captions(flow)
  assert.deepEqual(first, { chip: 'At the same time, 3 lanes', text: '', tabs: [], tab: -1, lanes: ['a', 'b', 'c'], marks: ['a', 'b', 'c'] })
  assert.deepEqual({ lanes: second.lanes, marks: second.marks }, { lanes: ['a', 'c'], marks: ['a', 'c'] })
  assert.equal(captions(flowOf({ p: { kind: 'parallel' } }, [step({ group: 'p', lane: 'only' })]))[0].chip, 'At the same time')
})

test('a stop in no group says nothing', () => {
  assert.deepEqual(captionOf(example, stopsOf(flowOf(undefined, [step()]))[0]), { chip: '', text: '', tabs: [], tab: -1, lanes: [], marks: [''] })
})

test('the progress bar has a column for each stop, the branch\'s lanes on rows of their own, and a bracket for each group', () => {
  assert.deepEqual(progressOf(example, stopsOf(example)), {
    cols: 5,
    rows: 2,
    cells: [
      { stop: 0, col: 0, row: 0 }, { stop: 1, col: 1, row: 0 },
      { stop: 2, col: 2, row: 0 }, { stop: 3, col: 3, row: 0 }, { stop: 4, col: 2, row: 1 },
      { stop: 5, col: 4, row: 0 },
    ],
    brackets: [
      { kind: 'repeat', from: 0, to: 1, text: '×3' },
      { kind: 'branch', from: 2, to: 3, text: 'one of 2' },
      { kind: 'parallel', from: 4, to: 4, text: 'together' },
    ],
  })
  assert.deepEqual(progressOf(flowOf(undefined, [step(), step()]), stopsOf(flowOf(undefined, [step(), step()]))), { cols: 2, rows: 1, cells: [{ stop: 0, col: 0, row: 0 }, { stop: 1, col: 1, row: 0 }], brackets: [] })
  const lone = flowOf({ b: { kind: 'branch' } }, [step({ group: 'b', lane: 'x' })])
  assert.equal(progressOf(lone, stopsOf(lone)).brackets[0].text, 'only if')
})

test('stopIndexOf finds the stop that holds a step, and answers the first stop for a step that is nowhere', () => {
  const stops = stopsOf(example)
  assert.equal(stopIndexOf(stops, 6), 5)
  assert.equal(stopIndexOf(stops, 4), 4)
  assert.equal(stopIndexOf(stops, 99), 0)
})
