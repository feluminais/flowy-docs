import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFlowFile, serializeFlow } from '../src/core/model.ts'
import { putFlow, updateFlow } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

const steps = [
  { from: 'web', to: 'api', text: 'Posts', group: 'try' },
  { from: 'api', to: 'db', text: 'Saves', group: 'try' },
  { from: 'api', to: 'db', text: 'Logs', group: 'both', lane: 'Audit', flow: 'checkout' },
  { from: 'api', to: 'db', text: 'Tells', group: 'both', lane: 'Notify' },
]
const groups = { try: { kind: 'repeat', times: 3, text: 'Backs off' }, both: { kind: 'parallel' } }

test('putFlow keeps groups and each step\'s group, lane and flow, with a number times written as text and groups before steps', () => {
  const m = putFlow(shop(), { id: 'pays', name: 'Pays', view: 'shop', groups, steps })
  assert.deepEqual(m.flows.pays.groups, { try: { kind: 'repeat', times: '3', text: 'Backs off' }, both: { kind: 'parallel' } })
  assert.deepEqual(m.flows.pays.steps, steps)
  assert.deepEqual(Object.keys(m.flows.pays), ['name', 'view', 'groups', 'steps'])
  assert.deepEqual(parseFlowFile('pays', serializeFlow(m.flows.pays)), m.flows.pays)
})

test('putFlow with no groups, or an empty set, writes none, and replacing a flow drops the groups it had', () => {
  assert.equal('groups' in putFlow(shop(), { id: 'pays', name: 'Pays', view: 'shop', steps }).flows.pays, false)
  assert.equal('groups' in putFlow(shop(), { id: 'pays', name: 'Pays', view: 'shop', groups: {}, steps }).flows.pays, false)
  const first = putFlow(shop(), { id: 'pays', name: 'Pays', view: 'shop', groups, steps })
  assert.equal('groups' in putFlow(first, { id: 'pays', name: 'Pays', view: 'shop', steps: [steps[0]] }).flows.pays, false)
})

test('updateFlow keeps the groups when the name or the steps change', () => {
  const m = putFlow(shop(), { id: 'pays', name: 'Pays', view: 'shop', groups, steps })
  assert.deepEqual(updateFlow(m, 'pays', { name: 'Pays again' }).flows.pays.groups, m.flows.pays.groups)
  assert.deepEqual(updateFlow(m, 'pays', { steps: steps.slice(0, 2) }).flows.pays.groups, m.flows.pays.groups)
})
