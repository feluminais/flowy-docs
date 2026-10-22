import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect, deleteAnalysis, deleteMode, deleteObject, disconnect, OpError, putAnalysis, putMode, refuseNewProblems, removeConnection, updateAnalysis, updateMode } from '../src/core/ops.ts'
import type { ModeInput } from '../src/core/ops.ts'
import { usersOfConnection, usersOfObject } from '../src/core/failures.ts'
import { ID_RULE } from '../src/core/model.ts'
import { shop, shopWithFailures } from './fixtures.ts'

const refused = (fn: () => unknown, message: string) => assert.throws(fn, (e: unknown) => e instanceof OpError && e.message === message, message)

test('putAnalysis creates an analysis with its fields in a stable order, whatever order they come in', () => {
  const m = putAnalysis(shop(), {
    modes: { down: { description: 'More.', status: 'planned', severity: 8, effect: 'Orders stop.', on: 'db', mode: 'The database is unreachable' } },
    scale: { severity: { low: 'Nobody notices', high: 'Money is lost' } }, scope: 'shop', about: 'A test.', name: 'Ordering', id: 'ordering',
  })
  assert.deepEqual(Object.keys(m.failures.ordering), ['name', 'about', 'scope', 'scale', 'modes'])
  assert.deepEqual(Object.keys(m.failures.ordering.modes.down), ['mode', 'on', 'effect', 'severity', 'status', 'description'])
})

test('numbers are written as text, and blank fields and empty lists are dropped', () => {
  const input: ModeInput = {
    mode: 'x', on: 'db', effect: '', cause: '   ', severity: 8, occurrence: 4, detection: 3, affects: [], step: 2, flow: 'checkout',
    after: { severity: 8, occurrence: 2 }, owner: 'Payments', run: '',
  }
  const m = putAnalysis(shop(), { id: 'a', name: 'A', about: '', scope: '', scale: {}, modes: { x: input } })
  assert.deepEqual(m.failures.a, {
    name: 'A',
    modes: { x: { mode: 'x', on: 'db', severity: '8', occurrence: '4', detection: '3', owner: 'Payments', after: { severity: '8', occurrence: '2' }, flow: 'checkout', step: '2' } },
  })
  assert.deepEqual(Object.keys(m.failures.a.modes.x), ['mode', 'on', 'severity', 'occurrence', 'detection', 'owner', 'after', 'flow', 'step'])
})

test('putAnalysis replaces: a hand-written extra key on the old analysis is gone', () => {
  const before = shopWithFailures()
  before.failures.ordering.reviewed = 'by hand'
  const m = putAnalysis(before, { id: 'ordering', name: 'Ordering again', modes: {} })
  assert.deepEqual(m.failures.ordering, { name: 'Ordering again', modes: {} })
})

test('a mode id of __proto__ is stored as a mode and pollutes nothing', () => {
  const modes = JSON.parse('{"__proto__":{"mode":"p","on":"db"}}') as Record<string, ModeInput>
  const m = putAnalysis(shop(), { id: 'p', name: 'P', modes })
  assert.deepEqual(Object.keys(m.failures.p.modes), ['__proto__'])
  assert.equal(Object.getPrototypeOf(m.failures.p.modes), Object.prototype)
  const n = putMode(m, 'p', '__proto__', { mode: 'again', on: 'web' })
  assert.deepEqual(Object.keys(n.failures.p.modes), ['__proto__'])
  assert.equal((n.failures.p.modes as Record<string, { mode?: string }>)['__proto__'].mode, 'again')
  assert.equal(({} as { mode?: string }).mode, undefined)
})

test('an invalid id is refused, and so is one that differs from an existing analysis only in case', () => {
  refused(() => putAnalysis(shop(), { id: 'Bad Id', name: 'B', modes: {} }), `"Bad Id" is not a valid analysis id: ${ID_RULE}`)
  const m = shopWithFailures()
  m.failures.Ordering = m.failures.ordering
  delete (m.failures as Record<string, unknown>).ordering
  refused(() => putAnalysis(m, { id: 'ordering', name: 'O', modes: {} }), 'failures/Ordering.yaml already exists and differs only in case. Rename or delete that file by hand.')
})

test('putMode replaces one mode and leaves the others, keeping its place', () => {
  const m = putMode(shopWithFailures(), 'ordering', 'api-slow', { mode: 'The API is down', on: 'api', severity: 9, occurrence: 2, detection: 2 })
  assert.deepEqual(m.failures.ordering.modes['api-slow'], { mode: 'The API is down', on: 'api', severity: '9', occurrence: '2', detection: '2' })
  assert.deepEqual(Object.keys(m.failures.ordering.modes), Object.keys(shopWithFailures().failures.ordering.modes))
  assert.deepEqual(m.failures.ordering.modes['db-down'], shopWithFailures().failures.ordering.modes['db-down'])
  const added = putMode(shopWithFailures(), 'ordering', 'new', { mode: 'New', on: 'web' })
  assert.equal(Object.keys(added.failures.ordering.modes).at(-1), 'new')
})

test('putMode on an unknown analysis is refused, and deleting an unknown mode or analysis is refused', () => {
  refused(() => putMode(shop(), 'nope', 'x', { mode: 'x', on: 'db' }), 'unknown analysis "nope"')
  refused(() => deleteMode(shopWithFailures(), 'ordering', 'nope'), 'unknown failure mode "nope" in "ordering"')
  refused(() => deleteMode(shopWithFailures(), 'nope', 'x'), 'unknown analysis "nope"')
  refused(() => deleteAnalysis(shopWithFailures(), 'nope'), 'unknown analysis "nope"')
})

test('deleteMode and deleteAnalysis remove them', () => {
  const m = deleteMode(shopWithFailures(), 'ordering', 'db-down')
  assert.equal(Object.hasOwn(m.failures.ordering.modes, 'db-down'), false)
  assert.equal(Object.keys(m.failures.ordering.modes).length, 5)
  assert.deepEqual(deleteAnalysis(shopWithFailures(), 'ordering').failures, {})
})

test('usersOfObject and usersOfConnection find what a mode, an affects entry or a scope names', () => {
  const m = shopWithFailures()
  assert.deepEqual(usersOfObject(m, 'db'), ['ordering']) // on
  assert.deepEqual(usersOfObject(m, 'mail'), ['ordering']) // end of a line
  assert.deepEqual(usersOfObject(m, 'shop'), ['ordering']) // scope
  assert.deepEqual(usersOfObject(m, 'customer'), [])
  m.failures.ordering.modes['api-slow'].affects = ['customer']
  assert.deepEqual(usersOfObject(m, 'customer'), ['ordering']) // affects
  assert.deepEqual(usersOfConnection(m, 'orders', 'mail'), ['ordering'])
  assert.deepEqual(usersOfConnection(m, 'mail', 'orders'), [])
})

test('deleteObject refuses a shape a mode names, as a part or as a line end, and drops it from affects', () => {
  const flowless = { ...shopWithFailures(), flows: {} } // a flow that uses a shape is refused first, with its own message
  refused(() => deleteObject(flowless, 'db'), '"db" is used by failure analysis ordering. Change or delete those first.')
  refused(() => deleteObject(flowless, 'mail'), '"mail" is used by failure analysis ordering. Change or delete those first.')
  flowless.objects.cache = { type: 'store', name: 'Cache', in: 'shop' }
  flowless.failures.ordering.modes['api-slow'].affects = ['cache', 'web']
  const kept = deleteObject(flowless, 'cache')
  assert.equal(kept.objects.cache, undefined)
  assert.deepEqual(kept.failures.ordering.modes['api-slow'].affects, ['web'])
  flowless.failures.ordering.modes['api-slow'].affects = ['cache']
  assert.equal('affects' in deleteObject(flowless, 'cache').failures.ordering.modes['api-slow'], false)
  flowless.failures.second = { name: 'Second', modes: { y: { mode: 'y', on: 'cache' } } }
  refused(() => deleteObject(flowless, 'cache'), '"cache" is used by failure analysis second. Change or delete those first.')
  flowless.failures.third = { name: 'Third', scope: 'cache', modes: {} }
  refused(() => deleteObject(flowless, 'cache'), '"cache" is used by failure analyses second, third. Change or delete those first.')
})

test('deleting a mode first frees the shape', () => {
  const m = { ...deleteMode(shopWithFailures(), 'ordering', 'web-glitch'), flows: {} }
  assert.equal(deleteObject(m, 'web').objects.web, undefined)
})

test('disconnect and removeConnection refuse to remove the last connection a line mode needs, but allow it while a duplicate with another label remains', () => {
  const m = shopWithFailures()
  const message = 'connection orders → mail is used by failure analysis ordering. Change or delete those first.'
  refused(() => disconnect(m, { from: 'orders', to: 'mail' }), message)
  refused(() => removeConnection(m, { from: 'orders', to: 'mail', label: 'sends receipts' }), message)
  const twice = connect(m, { from: 'orders', to: 'mail', label: 'second' })
  assert.equal(removeConnection(twice, { from: 'orders', to: 'mail', label: 'sends receipts' }).connections.length, m.connections.length)
  assert.equal(disconnect(twice, { from: 'orders', to: 'mail', label: 'sends receipts' }).connections.length, m.connections.length)
  refused(() => disconnect(twice, { from: 'orders', to: 'mail' }), message)
  assert.equal(disconnect(m, { from: 'customer', to: 'web' }).connections.length, m.connections.length - 1)
})

test('refuseNewProblems refuses a putMode with an unknown part and names it', () => {
  const before = shopWithFailures()
  const after = putMode(before, 'ordering', 'bad', { mode: 'x', on: 'gone' })
  assert.throws(() => refuseNewProblems(before, after), (e: unknown) => e instanceof OpError && /failures\/ordering\.yaml: bad: unknown object "gone"/.test(e.message))
  assert.doesNotThrow(() => refuseNewProblems(before, putMode(before, 'ordering', 'good', { mode: 'x', on: 'web', severity: 3 })))
})

test('updateMode sets a field as text, removes one set to blank, and leaves every other field and mode alone', () => {
  const before = shopWithFailures()
  const m = updateMode(before, 'ordering', 'api-slow', { severity: '9', owner: 'Payments' })
  assert.deepEqual(m.failures.ordering.modes['api-slow'], { ...before.failures.ordering.modes['api-slow'], severity: '9', owner: 'Payments' })
  assert.deepEqual(m.failures.ordering.modes['db-down'], before.failures.ordering.modes['db-down'])
  const cleared = updateMode(before, 'ordering', 'db-down', { effect: '', cause: '  ' })
  assert.equal(Object.hasOwn(cleared.failures.ordering.modes['db-down'], 'effect'), false)
  assert.equal(Object.hasOwn(cleared.failures.ordering.modes['db-down'], 'cause'), false)
})

test('updateMode merges after per rating, and an emptied after is gone', () => {
  const start = shopWithFailures()
  const one = updateMode(start, 'ordering', 'auth-lock', { after: { occurrence: '1' } })
  assert.deepEqual(one.failures.ordering.modes['auth-lock'].after, { occurrence: '1' })
  const two = updateMode(one, 'ordering', 'auth-lock', { after: { severity: '6' } })
  assert.deepEqual(Object.keys(two.failures.ordering.modes['auth-lock'].after ?? {}), ['severity', 'occurrence'])
  const none = updateMode(two, 'ordering', 'auth-lock', { after: { severity: '', occurrence: '' } })
  assert.equal(Object.hasOwn(none.failures.ordering.modes['auth-lock'], 'after'), false)
})

test('updateMode sets and clears affects', () => {
  const set = updateMode(shopWithFailures(), 'ordering', 'db-down', { affects: ['web', 'api'] })
  assert.deepEqual(set.failures.ordering.modes['db-down'].affects, ['web', 'api'])
  const gone = updateMode(set, 'ordering', 'db-down', { affects: [] })
  assert.equal(Object.hasOwn(gone.failures.ordering.modes['db-down'], 'affects'), false)
})

test('updateMode keeps a hand-written key, keeps keys in place, and puts a new one after the nearest earlier key', () => {
  const before = shopWithFailures()
  before.failures.ordering.modes.tidy = { mode: 'x', on: 'db', reviewed: 'by hand', description: 'More.' }
  const sev = updateMode(before, 'ordering', 'tidy', { severity: '4' })
  assert.deepEqual(Object.keys(sev.failures.ordering.modes.tidy), ['mode', 'on', 'severity', 'reviewed', 'description']) // just after `on`, the nearest earlier key present
  assert.equal(sev.failures.ordering.modes.tidy.reviewed, 'by hand')
  const cause = updateMode(sev, 'ordering', 'tidy', { cause: 'A reason.' })
  assert.deepEqual(Object.keys(cause.failures.ordering.modes.tidy), ['mode', 'on', 'cause', 'severity', 'reviewed', 'description'])
  const again = updateMode(cause, 'ordering', 'tidy', { severity: '5' })
  assert.deepEqual(Object.keys(again.failures.ordering.modes.tidy), ['mode', 'on', 'cause', 'severity', 'reviewed', 'description']) // an existing key keeps its place
  assert.equal(again.failures.ordering.modes.tidy.severity, '5')
})

test('updateMode and updateAnalysis refuse what is not there', () => {
  refused(() => updateMode(shop(), 'nope', 'x', { effect: 'e' }), 'unknown analysis "nope"')
  refused(() => updateMode(shopWithFailures(), 'ordering', 'nope', { effect: 'e' }), 'unknown failure mode "nope" in "ordering"')
  refused(() => updateAnalysis(shop(), 'nope', { name: 'N' }), 'unknown analysis "nope"')
})

test('an update the checker refuses is refused whole: a blank mode, a rating of 11, a part that is not there', () => {
  const before = shopWithFailures()
  const refuse = (changes: Parameters<typeof updateMode>[3], message: RegExp) =>
    assert.throws(() => refuseNewProblems(before, updateMode(before, 'ordering', 'api-slow', changes)), (e: unknown) => e instanceof OpError && message.test(e.message))
  refuse({ mode: '' }, /api-slow: "mode" is missing/)
  refuse({ severity: '11' }, /api-slow: severity must be a whole number from 1 to 10/)
  refuse({ on: 'gone' }, /api-slow: unknown object "gone"/)
  assert.doesNotThrow(() => refuseNewProblems(before, updateMode(before, 'ordering', 'api-slow', { severity: '8' })))
})

test('updateAnalysis renames, sets and clears about and scope, and keeps the rest', () => {
  const start = shopWithFailures()
  const { name, scope, modes } = start.failures.ordering
  start.failures.ordering = { name, scope, scale: { severity: { low: 'Nobody notices', high: 'Money is lost' } }, modes }
  const named = updateAnalysis(start, 'ordering', { name: 'Orders', about: 'Rated by the team.', scope: 'api' })
  assert.deepEqual(Object.keys(named.failures.ordering), ['name', 'about', 'scope', 'scale', 'modes'])
  assert.deepEqual([named.failures.ordering.name, named.failures.ordering.about, named.failures.ordering.scope], ['Orders', 'Rated by the team.', 'api'])
  assert.deepEqual(named.failures.ordering.scale, start.failures.ordering.scale)
  const cleared = updateAnalysis(named, 'ordering', { about: '', scope: '' })
  assert.deepEqual(Object.keys(cleared.failures.ordering), ['name', 'scale', 'modes'])
  const blankName = updateAnalysis(start, 'ordering', { name: '' })
  assert.equal(blankName.failures.ordering.name, '') // kept, so the checker can refuse it
  assert.throws(() => refuseNewProblems(start, blankName), (e: unknown) => e instanceof OpError && /name is missing/.test(e.message))
})
