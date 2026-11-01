import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import type { Model } from '../src/core/model.ts'
import { connect, deletePayload, putPayload, setLinePayloads } from '../src/core/ops.ts'
import { payloadUsers, tidyPayload } from '../src/core/payloads.ts'
import { shop } from './fixtures.ts'

const order = { id: 'order', name: 'Order', about: 'What the web app sends at checkout.' }
const withOrder = (): Model => putPayload(shop(), order)
const payloads = (m: Model) => m.meta.payloads as Record<string, unknown> | undefined

test('putPayload writes the keys in order and the language as its id', () => {
  const m = putPayload(shop(), { id: 'order', example: { language: 'JSON', text: '\r\n{ "id": 1 }\r\n\r\n' }, name: 'Order' })
  assert.deepEqual(payloads(m)?.order, { name: 'Order', example: { language: 'json', text: '{ "id": 1 }' } })
  assert.deepEqual(Object.keys(payloads(m)!.order as object), ['name', 'example'])
  assert.deepEqual(check(m), [])
})

test('putPayload merges into what is there, null removes a block and "" the about', () => {
  let m = putPayload(withOrder(), { id: 'order', shape: { text: 'type Order = { id: string }' } })
  assert.deepEqual(payloads(m)?.order, { ...{ name: 'Order', about: order.about }, shape: { text: 'type Order = { id: string }' } })
  m = putPayload(m, { id: 'order', about: '', shape: null, example: { text: '{}' } })
  assert.deepEqual(payloads(m)?.order, { name: 'Order', example: { text: '{}' } })
})

test('putPayload keeps a key it does not know, after the known ones', () => {
  const m: Model = { ...shop(), meta: { payloads: { order: { owner: 'pay team', about: 'x' } } } }
  assert.deepEqual(Object.keys(payloads(putPayload(m, { id: 'order', name: 'Order' }))!.order as object), ['name', 'about', 'owner'])
})

test('a new payload that says nothing, and a bad id, are refused', () => {
  assert.throws(() => putPayload(shop(), { id: 'empty', name: 'Empty' }), /^OpError: payload empty says nothing: give it an about, a shape or an example$/)
  assert.throws(() => putPayload(shop(), { id: 'Bad Id', about: 'x' }), /"Bad Id" is not a valid id/)
})

test('deletePayload is refused while a connection, a step\'s payload or a step\'s reply uses it, and names them', () => {
  let m = setLinePayloads(withOrder(), { from: 'web', to: 'api', label: 'REST' }, ['order'])
  const checkout = m.flows.checkout
  m = { ...m, flows: { ...m.flows, checkout: { ...checkout, steps: checkout.steps.map((s, i) => (i === 1 ? { ...s, reply: 'order', animation: 'call' } : s)) } } }
  assert.deepEqual(payloadUsers(m, 'order'), ['connection web → api', 'flow checkout step 2'])
  assert.throws(() => deletePayload(m, 'order'), /^OpError: payload "order" is used by connection web → api, flow checkout step 2\. Change those first\.$/)
})

test('an inline payload of the same name does not count as a use', () => {
  const m = setLinePayloads(withOrder(), { from: 'web', to: 'api', label: 'REST' }, [{ name: 'order', about: 'x' }])
  assert.deepEqual(payloadUsers(m, 'order'), [])
})

test('deleting the last payload takes payloads: away, and an unknown one is refused', () => {
  assert.equal(Object.hasOwn(deletePayload(withOrder(), 'order').meta, 'payloads'), false)
  assert.throws(() => deletePayload(withOrder(), 'nope'), /^OpError: unknown payload "nope"$/)
})

test('connect writes payloads after the label; setLinePayloads replaces them and [] removes them', () => {
  const m = connect(withOrder(), { from: 'api', to: 'mail', label: 'receipts', payloads: ['order', { name: 'Receipt', example: { language: 'ts', text: 'x' } }] })
  const c = m.connections.at(-1)!
  assert.deepEqual(Object.keys(c), ['from', 'to', 'label', 'payloads'])
  assert.deepEqual(c.payloads, ['order', { name: 'Receipt', example: { language: 'typescript', text: 'x' } }])
  const replaced = setLinePayloads(m, { from: 'api', to: 'mail', label: 'receipts' }, ['order'])
  assert.deepEqual(replaced.connections.at(-1)!.payloads, ['order'])
  assert.equal(Object.hasOwn(setLinePayloads(m, { from: 'api', to: 'mail', label: 'receipts' }, []).connections.at(-1)!, 'payloads'), false)
  assert.deepEqual(Object.keys(connect(withOrder(), { from: 'api', to: 'mail', payloads: [] }).connections.at(-1)!), ['from', 'to'])
})

test('an unknown payload id is refused by connect and setLinePayloads', () => {
  assert.throws(() => connect(withOrder(), { from: 'api', to: 'mail', payloads: ['nope'] }), /^OpError: unknown payload "nope"$/)
  assert.throws(() => setLinePayloads(withOrder(), { from: 'web', to: 'api', label: 'REST' }, ['nope']), /^OpError: unknown payload "nope"$/)
})

test('tidyPayload leaves what is not a mapping as it is', () => {
  assert.equal(tidyPayload('order'), 'order')
  assert.deepEqual(tidyPayload({ about: '  ', name: ' Order ', shape: { text: 'x', language: 'cobol' } }), { name: 'Order', shape: { language: 'cobol', text: 'x' } })
})

test('putPayload refuses to write over a payloads: that is not a mapping, rather than throw it away', () => {
  const m: Model = { ...shop(), meta: { payloads: ['order', 'refund'] } }
  assert.throws(() => putPayload(m, order), /^OpError: payloads in model\.yaml is not a mapping of ids to payloads: fix it in the file first$/)
})

test('setStepPayload sets a step\'s payload or reply by id or written in place, and removes it', async () => {
  const { setStepPayload } = await import('../src/core/ops.ts')
  let m = withOrder()
  m = setStepPayload(m, 'checkout', 1, 'payload', 'order')
  assert.equal(m.flows.checkout.steps[1].payload, 'order')
  m = setStepPayload(m, 'checkout', 1, 'payload', { name: ' Cart ', example: { language: 'TS', text: '\r\nx\r\n' } })
  assert.deepEqual(m.flows.checkout.steps[1].payload, { name: 'Cart', example: { language: 'typescript', text: 'x' } })
  m = setStepPayload(m, 'checkout', 1, 'payload', undefined)
  assert.equal(Object.hasOwn(m.flows.checkout.steps[1], 'payload'), false)
})

test('setStepPayload refuses an unknown id, and a reply on a step that gets no answer', async () => {
  const { setStepPayload } = await import('../src/core/ops.ts')
  assert.throws(() => setStepPayload(withOrder(), 'checkout', 1, 'payload', 'nope'), /^OpError: unknown payload "nope"$/)
  assert.throws(() => setStepPayload(withOrder(), 'checkout', 1, 'reply', 'order'), /^OpError: a reply needs a call, a callback or a recurse animation$/)
})

test('put_flow writes an inline payload on a step tidied', async () => {
  const { putFlow } = await import('../src/core/ops.ts')
  const m = putFlow(withOrder(), { id: 'quick', name: 'Quick', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'x', animation: 'call', payload: { name: 'Cart ', about: '  ', shape: { language: 'TS', text: 'a\r\n' } }, reply: 'order' }] })
  assert.deepEqual(m.flows.quick.steps[0].payload, { name: 'Cart', shape: { language: 'typescript', text: 'a' } })
})

test('an edit to the payloads is named in the history', async () => {
  const { describeEdit } = await import('../src/core/editlabel.ts')
  const added = withOrder()
  assert.equal(describeEdit(shop(), added), 'Added payload Order')
  assert.equal(describeEdit(added, putPayload(added, { id: 'order', about: 'Changed.' })), 'Edited payload Order')
  assert.equal(describeEdit(added, deletePayload(added, 'order')), 'Removed payload Order')
})
