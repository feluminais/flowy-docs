import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dumpStops } from '../desktop/fixtures/structure.ts'
import { loadState } from '../src/node/files.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = (name: string) => join(root, 'desktop/fixtures/cases', name, 'flowy')

test('every flow of the groups case has stops, and every step is in exactly one', async () => {
  const dump = (await dumpStops()) as { flows: { id: string; stops: { steps: number[] }[] }[] }
  const state = await loadState(folder('groups'))
  assert.ok(!('parseError' in state))
  assert.deepEqual(dump.flows.map(f => f.id).sort(), ['bad', 'blankish', 'capture-payment', 'numbered', 'ok', 'shapes'])
  for (const f of dump.flows) {
    const seen = f.stops.flatMap(s => s.steps).sort((a, b) => a - b)
    assert.deepEqual(seen, state.flows[f.id].steps.map((_, i) => i), f.id)
  }
})

test('the good flows of the groups case have no problems, and the bad one has every message', async () => {
  const state = await loadState(folder('groups'))
  assert.ok(!('parseError' in state))
  const of = (id: string) => state.problems.filter(p => p.file === `flows/${id}.yaml`).map(p => p.message)
  for (const id of ['ok', 'capture-payment', 'shapes', 'blankish']) assert.deepEqual(of(id), [], id)
  assert.deepEqual(of('numbered'), [
    'group "2": unknown kind "loop" (use repeat, branch, parallel)',
    'group "10": unknown kind "loop" (use repeat, branch, parallel)',
    'group "b": unknown kind "loop" (use repeat, branch, parallel)',
    'group "a": no step belongs to it',
  ])
  assert.deepEqual(of('bad'), [
    'group "Bad Id": ids use lowercase letters, digits and dashes, not starting with a dash ("root" and Windows device names such as "con" are reserved)',
    'group "nokind": kind is missing (use repeat, branch, parallel)',
    'group "weird": unknown kind "loop" (use repeat, branch, parallel)',
    'group "extra": unknown option "in" (use kind, text, times, until)',
    'group "wrongkind": times only applies to repeat',
    'group "wrongkind": until only applies to repeat',
    'group "badtimes": times must be a whole number from 2 to 99',
    'group "needs": a repeat needs times or until',
    'step 9: lane only applies to branch and parallel',
    'step 10: the first step of group "br" needs a lane',
    'step 12: lane "A" is already used in group "br"',
    'step 14: sits inside the stretch of group "a" without belonging to it',
    'step 15: sits inside the stretch of group "b" without belonging to it',
    'step 17: group "nope" is not declared under groups',
    'step 18: lane needs a group',
    'step 19: unknown flow "nowhere"',
    'step 20: group "constructor" is not declared under groups',
    'group "unused": no step belongs to it',
    'group "solo": a parallel group needs at least two lanes',
  ])
})

test('a wrongly shaped groups section stops the folder with the parse error', async () => {
  const groups = await loadState(folder('shape-groups'))
  assert.ok('parseError' in groups && /"groups" must map ids to mappings/.test(groups.parseError.message))
  const group = await loadState(folder('shape-group'))
  assert.ok('parseError' in group && /group "g": "kind" must be plain text, not a list or a mapping/.test(group.parseError.message))
})
