import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deleteObject, disconnect, OpError, putObject, refuseNewProblems, removeConnection } from '../src/core/ops.ts'
import type { Run } from '../src/core/perf/types.ts'
import { shop } from './fixtures.ts'

/** A run that measured mail, and the line from orders to it. Only what the checker reads is there. */
const run = (over: Partial<Run> = {}): Run => ({
  levels: [{ load: 1, overall: {}, objects: { mail: { util: 0.2 } }, connections: [{ from: 'orders', to: 'mail', rate: 3 }] }],
  ...over,
}) as unknown as Run

const runs = { 'mail-load': run() }
const refused = (re: RegExp) => (e: unknown) => e instanceof OpError && re.test(e.message)

test('refuseNewProblems refuses deleting a shape that a run measured, and names the run', () => {
  const before = shop()
  const after = deleteObject(before, 'mail')
  assert.throws(() => refuseNewProblems(before, after, new Set(), runs), refused(/perf\/mail-load\.yaml: unknown object "mail"\nChange or delete those runs first/))
  assert.doesNotThrow(() => refuseNewProblems(before, after))
})

test('refuseNewProblems refuses removing a line that a run measured', () => {
  const before = shop()
  const line = { from: 'orders', to: 'mail', label: 'sends receipts' }
  assert.throws(() => refuseNewProblems(before, disconnect(before, line), new Set(), runs), refused(/perf\/mail-load\.yaml: orders → mail is not a connection in the model/))
  assert.throws(() => refuseNewProblems(before, removeConnection(before, line), new Set(), runs), refused(/perf\/mail-load\.yaml/))
})

test('refuseNewProblems lets an edit through that no run cares about, and one a run was already broken by', () => {
  const before = shop()
  assert.doesNotThrow(() => refuseNewProblems(before, putObject(before, { id: 'cache', type: 'system', name: 'Cache' }), new Set(), runs))
  const broken = { ...before, objects: Object.fromEntries(Object.entries(before.objects).filter(([id]) => id !== 'mail')), connections: before.connections.filter(c => c.to !== 'mail') }
  assert.doesNotThrow(() => refuseNewProblems(broken, deleteObject(broken, 'auth'), new Set(), runs), 'the run already named a shape that is gone')
})
