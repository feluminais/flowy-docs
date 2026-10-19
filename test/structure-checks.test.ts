import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import type { Flow, Step } from '../src/core/model.ts'
import { structureProblems } from '../src/core/structure.ts'
import { shop } from './fixtures.ts'

const step = (extra: Partial<Step> = {}): Step => ({ from: 'a', to: 'b', text: 't', ...extra })
const flowOf = (groups: Flow['groups'] | undefined, steps: Step[]): Flow => ({ name: 'F', view: 'root', ...(groups ? { groups } : {}), steps })
const problems = (flow: Flow, flows: string[] = []) => structureProblems(flow, id => flows.includes(id))
const rule = (kind: string, more: Record<string, string> = {}) => ({ kind, ...more })

test('a valid flow with a repeat, a branch, a parallel group and a flow link has no problems', () => {
  const flow = flowOf({ charge: rule('repeat', { times: '3', text: 'Backs off' }), outcome: rule('branch'), tell: rule('parallel') }, [
    step({ group: 'charge' }), step({ group: 'charge' }),
    step({ group: 'outcome', lane: 'Accepted' }), step({ group: 'outcome' }), step({ group: 'outcome', lane: 'Declined' }),
    step({ group: 'tell', lane: 'Billing', flow: 'capture' }), step({ group: 'tell', lane: 'Dispatch' }),
  ])
  assert.deepEqual(problems(flow, ['capture']), [])
})

test('a branch may have one lane, a repeat may have only an until, and times may be 2 to 99', () => {
  assert.deepEqual(problems(flowOf({ b: rule('branch') }, [step({ group: 'b', lane: 'If valid' })])), [])
  assert.deepEqual(problems(flowOf({ r: rule('repeat', { until: 'it works' }) }, [step({ group: 'r' })])), [])
  for (const times of ['2', '99', '03']) assert.deepEqual(problems(flowOf({ r: rule('repeat', { times }) }, [step({ group: 'r' })])), [], times)
})

test('G1 to G4: a declaration needs a valid id, a known kind and known options', () => {
  const one = (id: string, g: Record<string, unknown>) => problems(flowOf({ [id]: g } as Flow['groups'], [step({ group: id })]))
  assert.deepEqual(one('Bad Id', rule('repeat', { times: '2' })), [{ message: 'group "Bad Id": ids use lowercase letters, digits and dashes, not starting with a dash ("root" is reserved)' }])
  assert.deepEqual(one('g', {}), [{ message: 'group "g": kind is missing (use repeat, branch, parallel)' }])
  assert.deepEqual(one('g', { kind: ' ' }), [{ message: 'group "g": kind is missing (use repeat, branch, parallel)' }])
  assert.deepEqual(one('g', rule('loop')), [{ message: 'group "g": unknown kind "loop" (use repeat, branch, parallel)' }])
  assert.deepEqual(one('g', rule('repeat', { times: '2', in: 'x', speed: 'y' })), [{ message: 'group "g": unknown option "in" (use kind, text, times, until)' }])
})

test('G5 to G7: times and until belong to a repeat, and a repeat needs one of them', () => {
  const branch = flowOf({ g: rule('branch', { times: '3', until: 'x' }) }, [step({ group: 'g', lane: 'A' })])
  assert.deepEqual(problems(branch), [{ message: 'group "g": times only applies to repeat' }, { message: 'group "g": until only applies to repeat' }])
  const repeat = (g: Record<string, string>) => problems(flowOf({ g: rule('repeat', g) }, [step({ group: 'g' })]))
  for (const times of ['x', '1', '100', '3.5', '0x3', '-3', ' 3x']) assert.deepEqual(repeat({ times }), [{ message: 'group "g": times must be a whole number from 2 to 99' }], times)
  assert.deepEqual(repeat({}), [{ message: 'group "g": a repeat needs times or until' }])
  assert.deepEqual(repeat({ times: ' ', until: '' }), [{ message: 'group "g": a repeat needs times or until' }])
})

test('S1 to S3: a step\'s group must be declared, and a lane needs a group that has lanes', () => {
  assert.deepEqual(problems(flowOf(undefined, [step(), step({ group: 'x' })])), [{ step: 1, message: 'group "x" is not declared under groups' }])
  assert.deepEqual(problems(flowOf(undefined, [step({ lane: 'A' })])), [{ step: 0, message: 'lane needs a group' }])
  assert.deepEqual(problems(flowOf(undefined, [step({ group: 'x', lane: 'A' })])), [{ step: 0, message: 'group "x" is not declared under groups' }])
  assert.deepEqual(problems(flowOf({ r: rule('repeat', { times: '2' }) }, [step({ group: 'r', lane: 'A' })])), [{ step: 0, message: 'lane only applies to branch and parallel' }])
  assert.deepEqual(problems(flowOf(undefined, [step({ group: 'constructor' })])), [{ step: 0, message: 'group "constructor" is not declared under groups' }])
})

test('S4 and S5: the first step of a branch or parallel group needs a lane, and a lane label is used once', () => {
  const b = (steps: Step[]) => problems(flowOf({ g: rule('branch') }, steps))
  assert.deepEqual(b([step({ group: 'g' }), step({ group: 'g', lane: 'A' })]), [{ step: 0, message: 'the first step of group "g" needs a lane' }])
  assert.deepEqual(b([step({ group: 'g', lane: 'A' }), step({ group: 'g' })]), [])
  assert.deepEqual(b([step({ group: 'g', lane: 'A' }), step({ group: 'g', lane: ' A ' }), step({ group: 'g', lane: 'B' })]), [{ step: 1, message: 'lane "A" is already used in group "g"' }])
})

test('S6: a step between the members of a group without being in it is named', () => {
  const flow = flowOf({ a: rule('repeat', { times: '2' }), b: rule('repeat', { times: '2' }) }, [
    step({ group: 'a' }), step({ group: 'b' }), step({ group: 'a' }), step({ group: 'b' }), step(),
  ])
  assert.deepEqual(problems(flow), [
    { step: 1, message: 'sits inside the stretch of group "a" without belonging to it' },
    { step: 2, message: 'sits inside the stretch of group "b" without belonging to it' },
  ])
})

test('S7: a flow link must name a flow that exists, and may name its own flow or a cycle', () => {
  assert.deepEqual(problems(flowOf(undefined, [step({ flow: 'nope' })])), [{ step: 0, message: 'unknown flow "nope"' }])
  assert.deepEqual(problems(flowOf(undefined, [step({ flow: 'me' }), step({ flow: ' other ' })]), ['me', 'other']), [])
})

test('G8 and G9: a declared group needs steps, and a parallel group needs two lanes', () => {
  assert.deepEqual(problems(flowOf({ g: rule('repeat', { times: '2' }) }, [step()])), [{ message: 'group "g": no step belongs to it' }])
  assert.deepEqual(problems(flowOf({ g: rule('parallel') }, [step({ group: 'g', lane: 'only' }), step({ group: 'g' })])), [{ message: 'group "g": a parallel group needs at least two lanes' }])
})

test('a blank group, lane or flow is none, and a group of unknown kind reports only its kind', () => {
  assert.deepEqual(problems(flowOf(undefined, [step({ group: ' ', lane: '', flow: ' ' })])), [])
  assert.deepEqual(problems(flowOf({ g: rule('loop') }, [step({ group: 'g', lane: 'a' }), step({ group: 'g', lane: 'a' })])), [{ message: 'group "g": unknown kind "loop" (use repeat, branch, parallel)' }])
})

test('problems come declarations first (in key order), then steps, then unused groups', () => {
  const flow = flowOf({ b: rule('loop'), a: rule('repeat', { times: '2' }) }, [step({ group: 'b' }), step({ group: 'x' })])
  assert.deepEqual(problems(flow), [
    { message: 'group "b": unknown kind "loop" (use repeat, branch, parallel)' },
    { step: 1, message: 'group "x" is not declared under groups' },
    { message: 'group "a": no step belongs to it' },
  ])
  const numbered = flowOf({ '10': rule('loop'), '2': rule('loop') }, [step()])
  assert.deepEqual(problems(numbered).map(p => p.message), [
    'group "2": unknown kind "loop" (use repeat, branch, parallel)',
    'group "10": unknown kind "loop" (use repeat, branch, parallel)',
    'group "2": no step belongs to it',
    'group "10": no step belongs to it',
  ])
})

test('check() reports them with the step number and the flow\'s file, and links between flows are fine', () => {
  const m = shop()
  m.flows.pays = {
    name: 'Pays', view: 'shop', groups: { g: rule('branch') },
    steps: [{ from: 'web', to: 'api', text: 'Posts', group: 'g' }, { from: 'api', to: 'db', text: 'Saves', lane: 'x' }, { from: 'api', to: 'db', text: 'Loops', flow: 'pays' }],
  }
  const got = check(m).map(p => ({ file: p.file, step: p.step, message: p.message }))
  assert.deepEqual(got, [
    { file: 'flows/pays.yaml', step: 0, message: 'step 1: the first step of group "g" needs a lane' },
    { file: 'flows/pays.yaml', step: 1, message: 'step 2: lane needs a group' },
  ])
  m.flows.pays.steps = [{ from: 'web', to: 'api', text: 'Posts', flow: 'checkout' }]
  m.flows.pays.groups = undefined
  m.flows.checkout.steps[0].flow = 'pays'
  assert.deepEqual(check(m), [])
})
