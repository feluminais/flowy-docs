import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Step } from '../src/core/model.ts'
import { connectionPayloads, dotPayload, payloadsOf, resolvePayload, stepPayload, stepReply } from '../src/core/payloads.ts'

const order = { name: 'Order', about: 'What the app sends at checkout.', shape: { language: 'typescript', text: 'type Order = { id: string }' } }
const model = () => ({ ...emptyModel(), meta: { payloads: { order, bad: 'x', refund: { about: 'Money going back.' } } } })

test('payloadsOf keeps the entries that are mappings, in file order', () => {
  assert.deepEqual(Object.keys(payloadsOf(model())), ['order', 'refund'])
  assert.deepEqual(payloadsOf(emptyModel()), {})
  assert.deepEqual(payloadsOf({ meta: { payloads: ['order'] } }), {})
})

test('an id finds its payload, named after the id when it has no name', () => {
  assert.deepEqual(resolvePayload(model(), 'refund'), { id: 'refund', name: 'refund', about: 'Money going back.' })
  assert.deepEqual(resolvePayload(model(), 'order'), { id: 'order', ...order })
})

test('an inline payload is itself, with no id', () => {
  assert.deepEqual(resolvePayload(model(), { name: 'Receipt', about: 'x' }), { name: 'Receipt', about: 'x' })
})

test('an unknown id, an inline payload with no name and a key of Object.prototype find nothing', () => {
  for (const ref of ['nope', { about: 'x' }, 'constructor', 'toString', 'bad', 42, undefined]) assert.equal(resolvePayload(model(), ref), undefined, String(ref))
})

test('a connection lists the payloads that resolve, in its order', () => {
  const c: Connection = { from: 'app', to: 'api', payloads: ['refund', 'nope', { name: 'Receipt' }] }
  assert.deepEqual(connectionPayloads(model(), c).map(p => p.name), ['refund', 'Receipt'])
  assert.deepEqual(connectionPayloads(model(), { from: 'app', to: 'api', payloads: 'refund' }), [])
  assert.deepEqual(connectionPayloads(model(), { from: 'app', to: 'api' }), [])
})

test('a blank or malformed code block is left out of what is shown', () => {
  const m = { ...emptyModel(), meta: { payloads: { odd: { about: 'x', shape: { text: '\n  \n' }, example: 'json' } } } }
  assert.deepEqual(resolvePayload(m, 'odd'), { id: 'odd', name: 'odd', about: 'x' })
})

test('stepPayload and stepReply read the step\'s payload and reply', () => {
  const s: Step = { from: 'app', to: 'api', text: 'Places it', payload: 'order', reply: { name: 'Receipt', about: 'y' } }
  assert.equal(stepPayload(model(), s)?.name, 'Order')
  assert.equal(stepReply(model(), s)?.name, 'Receipt')
  assert.equal(stepPayload(model(), { from: 'app', text: 'x' }), undefined)
})

test('a draft that copies a line takes the payloads its lines and the model name with it', async () => {
  const { newDraft } = await import('../src/core/drafts.ts')
  const { check } = await import('../src/core/check.ts')
  const m = { ...emptyModel(), objects: { a: { type: 'system' as const, name: 'A' }, b: { type: 'system' as const, name: 'B' } }, connections: [{ from: 'a', to: 'b', payloads: ['refund'] }], meta: { payloads: { order, refund: { about: 'Money going back.' } } } }
  const draft = newDraft(m, { name: 'Sketch', copy: ['a', 'b'] })
  assert.deepEqual(check(draft), [])
  assert.deepEqual(Object.keys(payloadsOf(draft)), ['order', 'refund'])
})

const withReply = () => ({ ...emptyModel(), meta: { payloads: { order: { name: 'Order' }, receipt: { name: 'Receipt' } } } })
const asks: Step = { from: 'web', to: 'api', text: 'Places the order', animation: 'call', payload: 'order', reply: 'receipt' }

test('a dot that answers carries the reply, and every other dot the payload', () => {
  assert.deepEqual(dotPayload(withReply(), asks), { shown: { id: 'order', name: 'Order' }, back: false })
  assert.deepEqual(dotPayload(withReply(), asks, 'reply'), { shown: { id: 'receipt', name: 'Receipt' }, back: true })
  assert.deepEqual(dotPayload(withReply(), asks, 'fail'), { shown: { id: 'order', name: 'Order' }, back: false })
})

test('a dot whose step names nothing, or an id that is not there, carries nothing', () => {
  assert.equal(dotPayload(withReply(), { from: 'a', to: 'b', text: 'x' }), undefined)
  assert.equal(dotPayload(withReply(), { from: 'a', to: 'b', text: 'x', payload: 'gone' }), undefined)
  assert.equal(dotPayload(withReply(), { from: 'a', to: 'b', text: 'x', payload: 'order' }, 'reply'), undefined)
})

test('a payload written in place is what its dot carries', () => {
  assert.deepEqual(dotPayload(withReply(), { from: 'a', to: 'b', text: 'x', payload: { name: 'Ping', about: 'A heartbeat.' } }), { shown: { name: 'Ping', about: 'A heartbeat.' }, back: false })
})
