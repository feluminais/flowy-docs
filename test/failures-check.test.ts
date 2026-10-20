import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, newProblems } from '../src/core/check.ts'
import { runLinkProblems } from '../src/core/failures.ts'
import { ID_RULE } from '../src/core/model.ts'
import type { Mode, Model } from '../src/core/model.ts'
import { shopWithFailures } from './fixtures.ts'

/** The failure problems of a model as "file | id | message" lines. */
const found = (m: Model) => check(m).filter(p => p.file.startsWith('failures/')).map(p => `${p.file} | ${p.id ?? ''} | ${p.message}`)

/** The shop with one more mode in the ordering analysis. */
function withMode(mode: Mode, id = 'x'): Model {
  const m = shopWithFailures()
  m.failures.ordering.modes[id] = mode
  return m
}
const oneProblem = (m: Model, message: string, id = 'x') => assert.deepEqual(found(m), [`failures/ordering.yaml | ${id} | ${message}`])

test('the shop with failures has no problems at all', () => {
  assert.deepEqual(check(shopWithFailures()), [])
})

test('analysis rules: id, name and scope', () => {
  const m = shopWithFailures()
  m.failures['Bad Id'] = { name: 'Bad', modes: {} }
  assert.deepEqual(found(m), [`failures/Bad Id.yaml |  | "Bad Id" is not a valid analysis id: the file name must ${ID_RULE}`])
  const unnamed = shopWithFailures()
  unnamed.failures.ordering.name = '  '
  assert.deepEqual(found(unnamed), ['failures/ordering.yaml |  | name is missing'])
  for (const scope of ['web', 'nowhere']) {
    const s = shopWithFailures()
    s.failures.ordering.scope = scope
    assert.deepEqual(found(s), [`failures/ordering.yaml |  | scope "${scope}" must be "root" or an object with children`])
  }
  for (const scope of ['root', 'api', undefined]) {
    const s = shopWithFailures()
    s.failures.ordering.scope = scope
    assert.deepEqual(found(s), [], String(scope))
  }
})

test('a mode needs a valid id and a mode sentence', () => {
  oneProblem(withMode({ mode: 'x', on: 'db' }, 'Bad Id'), `Bad Id: the id must ${ID_RULE}`, 'Bad Id')
  oneProblem(withMode({ on: 'db' }), 'x: "mode" is missing')
  oneProblem(withMode({ mode: '  ', on: 'db' }), 'x: "mode" is missing')
})

test('a mode names a part: a shape with on, or a line with from and to', () => {
  oneProblem(withMode({ mode: 'x' }), 'x: needs "on" (a shape) or "from" and "to" (a line)')
  oneProblem(withMode({ mode: 'x', on: 'db', from: 'orders', to: 'db' }), 'x: has "on" and also "from" or "to"; use one or the other')
  oneProblem(withMode({ mode: 'x', from: 'orders' }), 'x: "from" and "to" go together')
  oneProblem(withMode({ mode: 'x', to: 'db' }), 'x: "from" and "to" go together')
  oneProblem(withMode({ mode: 'x', on: 'gone' }), 'x: unknown object "gone"')
  oneProblem(withMode({ mode: 'x', on: 'root' }), 'x: unknown object "root"')
  oneProblem(withMode({ mode: 'x', from: 'gone', to: 'db' }), 'x: unknown object "gone"')
  assert.deepEqual(found(withMode({ mode: 'x', from: 'gone', to: 'gone2' })).length, 2)
})

test('a line mode needs a connection in that direction', () => {
  oneProblem(withMode({ mode: 'x', from: 'db', to: 'orders' }), 'x: db → orders is not a connection in the model')
  oneProblem(withMode({ mode: 'x', from: 'web', to: 'db' }), 'x: web → db is not a connection in the model')
  assert.deepEqual(found(withMode({ mode: 'x', from: 'orders', to: 'db' })), [])
})

test('affects names shapes that exist', () => {
  oneProblem(withMode({ mode: 'x', on: 'db', affects: ['web', 'gone'] }), 'x: affects: unknown object "gone"')
  assert.deepEqual(found(withMode({ mode: 'x', on: 'db', affects: ['web', 'api'] })), [])
})

test('a rating is exactly 1 to 10; 5.5, 0, 11, 07, 1e1 and " 7 " are problems; a blank one is just absent', () => {
  for (const bad of ['5.5', '0', '11', '07', '1e1', ' 7 ', 'high']) {
    oneProblem(withMode({ mode: 'x', on: 'db', severity: bad }), 'x: severity must be a whole number from 1 to 10')
  }
  oneProblem(withMode({ mode: 'x', on: 'db', occurrence: '11' }), 'x: occurrence must be a whole number from 1 to 10')
  oneProblem(withMode({ mode: 'x', on: 'db', detection: '0' }), 'x: detection must be a whole number from 1 to 10')
  oneProblem(withMode({ mode: 'x', on: 'db', after: { occurrence: '11' } }), 'x: after occurrence must be a whole number from 1 to 10')
  assert.deepEqual(found(withMode({ mode: 'x', on: 'db', severity: '', occurrence: '10', detection: '1', after: { severity: '' } })), [])
})

test('status is one of open, planned, done or accepted; blank is open', () => {
  oneProblem(withMode({ mode: 'x', on: 'db', status: 'finished' }), 'x: status "finished" must be open, planned, done or accepted')
  for (const status of ['open', 'planned', 'done', 'accepted', '']) assert.deepEqual(found(withMode({ mode: 'x', on: 'db', status })), [], status)
})

test('a flow link needs a flow that exists, and a step that is in it', () => {
  oneProblem(withMode({ mode: 'x', on: 'db', flow: 'nope' }), 'x: flow "nope" doesn\'t exist')
  oneProblem(withMode({ mode: 'x', on: 'db', step: '2' }), 'x: step needs a flow')
  for (const step of ['0', '1.5', 'two', '-1', '01']) {
    oneProblem(withMode({ mode: 'x', on: 'db', flow: 'checkout', step }), 'x: step must be a whole number from 1')
  }
  oneProblem(withMode({ mode: 'x', on: 'db', flow: 'checkout', step: '4' }), 'x: step 4 is outside flow "checkout", which has 3 steps')
  const one = withMode({ mode: 'x', on: 'db', flow: 'short', step: '2' })
  one.flows.short = { name: 'Short', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'Calls' }] }
  oneProblem(one, 'x: step 2 is outside flow "short", which has 1 step')
  assert.deepEqual(found(withMode({ mode: 'x', on: 'db', flow: 'checkout', step: '3' })), [])
  assert.deepEqual(found(withMode({ mode: 'x', on: 'db', flow: 'checkout' })), [])
})

test('blank part fields are absent: a blank "on" next to a line is just a line', () => {
  assert.deepEqual(found(withMode({ mode: 'x', on: '', from: 'orders', to: 'db' })), [])
  assert.deepEqual(found(withMode({ mode: 'x', on: 'db', from: '', to: '' })), [])
})

test('runLinkProblems names a run that does not exist', () => {
  const a = withMode({ mode: 'x', on: 'db', run: 'ramp' }).failures.ordering
  assert.deepEqual(runLinkProblems('ordering', a, {}), [{ file: 'failures/ordering.yaml', id: 'x', message: 'x: run "ramp" doesn\'t exist' }])
  assert.deepEqual(runLinkProblems('ordering', a, { ramp: {} }), [])
  assert.deepEqual(runLinkProblems('ordering', shopWithFailures().failures.ordering, {}), [])
  assert.deepEqual(runLinkProblems('ordering', withMode({ mode: 'x', on: 'db', run: '__proto__' }).failures.ordering, {}).length, 1)
})

test('newProblems treats an old failures problem as old, so it never blocks an unrelated edit', () => {
  const before = withMode({ mode: 'x', on: 'gone' })
  const after = withMode({ mode: 'x', on: 'gone' })
  after.objects.cache = { type: 'store', name: 'Cache', in: 'shop' }
  assert.deepEqual(newProblems(check(before), check(after)), [])
  const worse = withMode({ mode: 'x', on: 'gone' })
  worse.failures.ordering.modes.y = { mode: 'y', on: 'gone' }
  assert.deepEqual(newProblems(check(before), check(worse)).map(p => p.message), ['y: unknown object "gone"'])
})
