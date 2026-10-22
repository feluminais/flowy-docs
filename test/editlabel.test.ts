import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEdit } from '../src/core/editlabel.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { CASES } from '../desktop/fixtures/editlabel.ts'

// The table is in desktop/fixtures/editlabel.ts: the C# tests read the same cases.
for (const { name, before, after, label } of CASES) {
  test(`an edit is named: ${name}`, () => {
    assert.equal(describeEdit(before, after), label)
  })
}

test('naming an edit does not change the models', () => {
  for (const { before, after } of CASES) {
    const [b, a] = [JSON.stringify(before), JSON.stringify(after)]
    describeEdit(before, after)
    assert.equal(JSON.stringify(before), b)
    assert.equal(JSON.stringify(after), a)
  }
})

test('the order of keys inside an object is not a change', () => {
  const [{ before }] = CASES
  const reordered = structuredClone(before)
  reordered.objects.api = Object.fromEntries(Object.entries(reordered.objects.api).reverse()) as typeof reordered.objects.api
  assert.equal(describeEdit(before, reordered), undefined)
})

// Failure analyses have no cases in the shared table: the desktop app does not edit them yet, so the C# twin has nothing to match.
const withFailures = (failures: Model['failures']): Model => ({ ...emptyModel(), failures })
const ordering = (): Model['failures'] => ({
  ordering: { name: 'Ordering', modes: { late: { mode: 'Charge arrives late' }, dup: { mode: 'Order placed twice' } } },
})

test('a failure analysis added, deleted or renamed is named', () => {
  const none = withFailures({})
  assert.equal(describeEdit(none, withFailures(ordering())), 'Added the Ordering failure analysis')
  assert.equal(describeEdit(withFailures(ordering()), none), 'Deleted the Ordering failure analysis')
  assert.equal(describeEdit(none, withFailures({ ...ordering(), pay: { name: 'Pay', modes: {} } })), 'Added 2 failure analyses')
  assert.equal(describeEdit(withFailures({ ...ordering(), pay: { name: 'Pay', modes: {} } }), none), 'Deleted 2 failure analyses')
  const renamed = ordering()
  renamed.ordering.name = 'Checkout'
  assert.equal(describeEdit(withFailures(ordering()), withFailures(renamed)), 'Renamed the failure analysis Ordering to Checkout')
})

test('a failure analysis with no name is called by its id', () => {
  assert.equal(describeEdit(withFailures({}), withFailures({ ordering: { name: '', modes: {} } })), 'Added the ordering failure analysis')
})

test('a failure mode added, deleted or changed is named', () => {
  const [base, more, fewer, edited, editedBoth] = [ordering(), ordering(), ordering(), ordering(), ordering()]
  more.ordering.modes.slow = { mode: 'Stock check is slow' }
  delete fewer.ordering.modes.dup
  edited.ordering.modes.late.effect = 'Customer is charged twice'
  editedBoth.ordering.modes.late.effect = 'Customer is charged twice'
  editedBoth.ordering.modes.dup.cause = 'Retry without a key'
  assert.equal(describeEdit(withFailures(base), withFailures(more)), 'Added the Stock check is slow failure mode')
  assert.equal(describeEdit(withFailures(base), withFailures(fewer)), 'Deleted the Order placed twice failure mode')
  assert.equal(describeEdit(withFailures(base), withFailures(edited)), 'Changed the Charge arrives late failure mode')
  assert.equal(describeEdit(withFailures(base), withFailures(editedBoth)), 'Changed 2 failure modes')
  assert.equal(describeEdit(withFailures(more), withFailures({ ordering: { name: 'Ordering', modes: {} } })), 'Deleted 3 failure modes')
  assert.equal(describeEdit(withFailures(ordering()), withFailures({ ordering: { name: 'Ordering', modes: { ...more.ordering.modes, extra: { mode: 'One more' } } } })), 'Added 2 failure modes')
})

test('a failure mode with no name is called by its id, and an analysis detail change is named', () => {
  const [base, noName, scoped] = [ordering(), ordering(), ordering()]
  noName.ordering.modes.late = {}
  scoped.ordering.scope = 'shop'
  assert.equal(describeEdit(withFailures(base), withFailures(noName)), 'Changed the late failure mode')
  assert.equal(describeEdit(withFailures(base), withFailures(scoped)), 'Changed the Ordering failure analysis')
})

test('a failure edit with another change counts the other', () => {
  const before = withFailures(ordering())
  const after = withFailures(ordering())
  after.failures.ordering.modes.late.effect = 'Customer is charged twice'
  after.meta.lines = 'curved'
  assert.equal(describeEdit(before, after), 'Changed the Charge arrives late failure mode and 1 other change')
})

test('a failure mode listed in another order is not a change', () => {
  const before = withFailures(ordering())
  const after = withFailures({ ordering: { name: 'Ordering', modes: { dup: { mode: 'Order placed twice' }, late: { mode: 'Charge arrives late' } } } })
  assert.equal(describeEdit(before, after), undefined)
})

// A flow's `compare` is a tag, not a change to the flow: it is named as the link it makes. The holder is the newer flow, `with` the older.
const withFlows = (flows: Record<string, { name: string; compare?: unknown }>): Model => ({
  ...emptyModel(),
  flows: Object.fromEntries(Object.entries(flows).map(([id, f]) => [id, { view: 'root', steps: [], ...f }])),
})
const pair = (compare?: unknown) => withFlows({ old: { name: 'Refund, old' }, now: { name: 'Refund, now', ...(compare === undefined ? {} : { compare }) } })

test('a flow linked, unlinked, retargeted or noted is named', () => {
  assert.equal(describeEdit(pair(), pair('old')), 'Linked Refund, old with Refund, now')
  assert.equal(describeEdit(pair('old'), pair()), 'Unlinked Refund, now')
  assert.equal(describeEdit(pair('old'), pair({ with: 'old', note: 'After the fix' })), 'Noted Refund, old and Refund, now')
  assert.equal(describeEdit(pair({ with: 'old', note: 'After the fix' }), pair('old')), 'Cleared the note on Refund, old and Refund, now')
  assert.equal(describeEdit(pair(), pair({ with: 'old', note: 'First' })), 'Linked Refund, old with Refund, now')
  const three = (compare: string) => withFlows({ a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C', compare } })
  assert.equal(describeEdit(three('a'), three('b')), 'Linked B with C')
})

test('a link made along with another change to the flow is a change to the flow', () => {
  const after = pair('old')
  after.flows.now.name = 'Refund, new'
  assert.equal(describeEdit(pair(), after), 'Changed the Refund, new flow')
})

test('a tag to a flow that is not there is named by its id, and two links count as a change each', () => {
  assert.equal(describeEdit(pair(), pair('gone')), 'Linked gone with Refund, now')
  const [before, after] = [withFlows({ a: { name: 'A' }, b: { name: 'B' }, c: { name: 'C' } }), withFlows({ a: { name: 'A' }, b: { name: 'B', compare: 'a' }, c: { name: 'C', compare: 'a' } })]
  assert.equal(describeEdit(before, after), 'Changed 2 flows')
})
