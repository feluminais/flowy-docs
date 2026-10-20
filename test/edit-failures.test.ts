import { test } from 'node:test'
import assert from 'node:assert/strict'
import { locate } from '../ui/src/edit.ts'
import { shopWithFailures } from './fixtures.ts'

const m = shopWithFailures()

test('a problem in a failures file points at its mode, in the view that draws it', () => {
  assert.deepEqual(locate(m, { file: 'failures/ordering.yaml', message: 'auth-lock: severity must be a whole number from 1 to 10' }),
    { view: 'api', failure: { analysis: 'ordering', mode: 'auth-lock' } })
  assert.deepEqual(locate(m, { file: 'failures/ordering.yaml', message: 'mail-timeout: orders → mail is not a connection in the model' }),
    { view: 'api', failure: { analysis: 'ordering', mode: 'mail-timeout' } })
})

test('a problem of the analysis itself points at the analysis, in the overview', () => {
  assert.deepEqual(locate(m, { file: 'failures/ordering.yaml', message: 'name is missing' }), { view: 'root', failure: { analysis: 'ordering' } })
})

test('a problem in a file that is not an analysis in the model points nowhere in particular', () => {
  assert.deepEqual(locate(m, { file: 'failures/gone.yaml', message: 'name is missing' }), { view: 'root' })
})

test('a mode named like a shape never points at that shape', () => {
  const same = shopWithFailures()
  same.failures.ordering.modes.web = { mode: 'x', on: 'db', severity: '11' }
  const spot = locate(same, { file: 'failures/ordering.yaml', message: 'web: severity must be a whole number from 1 to 10' })
  assert.deepEqual(spot, { view: 'shop', failure: { analysis: 'ordering', mode: 'web' } })
  assert.equal('object' in spot, false)
})

test('the longest mode id the message starts with is the mode', () => {
  const same = shopWithFailures()
  same.failures.ordering.modes.db = { mode: 'x', on: 'db' }
  same.failures.ordering.modes['db-down'] = same.failures.ordering.modes['db-down']
  assert.equal(locate(same, { file: 'failures/ordering.yaml', message: 'db-down: unknown object "x"' }).failure?.mode, 'db-down')
  assert.equal(locate(same, { file: 'failures/ordering.yaml', message: 'db: unknown object "x"' }).failure?.mode, 'db')
})
