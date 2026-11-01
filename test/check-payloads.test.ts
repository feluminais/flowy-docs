import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import type { Model, Step } from '../src/core/model.ts'
import { ID_RULE } from '../src/core/model.ts'
import { LANGUAGES } from '../src/core/snippets.ts'
import { shop } from './fixtures.ts'

const order = { name: 'Order', about: 'What the web app sends at checkout.' }

/** The shop, with these payloads, the web → api connection carrying `carried`, and a flow `t` of these steps. */
function model({ payloads, carried, steps }: { payloads?: unknown; carried?: unknown; steps?: Step[] } = {}): Model {
  const m = shop()
  return {
    ...m,
    meta: payloads === undefined ? {} : { payloads },
    connections: m.connections.map(c => (c.from === 'web' && c.to === 'api' && carried !== undefined ? { ...c, payloads: carried } : c)),
    flows: steps === undefined ? m.flows : { ...m.flows, t: { name: 'T', view: 'shop', steps } },
  }
}

const problems = (m: Model) => check(m).map(p => `${p.file} ${p.message}`)
const languages = LANGUAGES.map(l => l.id).join(', ')

test('well-formed payloads, lines and steps have no problems', () => {
  const m = model({
    payloads: { order, receipt: { example: { language: 'json', text: '{ "id": 1 }' } } },
    carried: ['order', { name: 'Cart', about: 'The basket.' }],
    steps: [{ from: 'web', to: 'api', text: 'Places it', payload: 'order', reply: 'receipt', animation: 'call' }],
  })
  assert.deepEqual(problems(m), [])
})

test('payloads written as a list is one problem', () => {
  assert.deepEqual(problems(model({ payloads: ['order'] })), ['model.yaml payloads must map ids to payloads'])
})

test('a payload entry is checked: its id, a mapping, text fields, and that it says something', () => {
  const m = model({ payloads: { 'Bad Id': order, plain: 'x', named: { name: ['x'], about: 3 }, empty: { name: 'Empty' } } })
  assert.deepEqual(problems(m), [
    `model.yaml payload Bad Id: ids ${ID_RULE}`,
    'model.yaml payload plain must be a mapping',
    'model.yaml payload named: name must be plain text',
    'model.yaml payload named: about must be plain text',
    'model.yaml payload named says nothing: give it an about, a shape or an example',
    'model.yaml payload empty says nothing: give it an about, a shape or an example',
  ])
})

test('a code block is checked: a mapping, some text, its size and its language', () => {
  const long = `\r\n\r\n${Array.from({ length: 401 }, (_, i) => `field${i}: string`).join('\r\n')}\r\n\r\n`
  const m = model({
    payloads: {
      a: { shape: 'type A', example: { text: '  \n' } },
      b: { shape: { text: long } },
      c: { example: { text: 'x'.repeat(40001) } },
      d: { shape: { language: 'cobol', text: 'X' }, example: { language: ['json'], text: '{}' } },
    },
  })
  assert.deepEqual(problems(m), [
    'model.yaml payload a: shape must be a mapping with text and, if you like, a language',
    'model.yaml payload a: example has no text',
    'model.yaml payload b: shape is 401 lines, at most 400',
    'model.yaml payload c: example is 40001 characters, at most 40000',
    `model.yaml payload d: shape: unknown language "cobol" (use ${languages}, or leave it out to have it worked out)`,
    'model.yaml payload d: example: language must be plain text',
  ])
})

test('more than 200 payloads is too many', () => {
  const payloads = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`p${i}`, { about: 'x' }]))
  assert.deepEqual(problems(model({ payloads })), ['model.yaml 201 payloads, at most 200'])
})

test('a connection\'s payloads written as one id is one problem', () => {
  assert.deepEqual(problems(model({ payloads: { order }, carried: 'order' })), ['model.yaml connection web → api: payloads must be a list of payload ids or payloads'])
})

test('a connection names payloads that exist, and an inline one is checked as an entry is, by its place in the list', () => {
  const m = model({ payloads: { order }, carried: ['order', 'nope', { about: 'x' }, 7, { name: 'Cart' }] })
  assert.deepEqual(problems(m), [
    'model.yaml connection web → api: unknown payload "nope"',
    'model.yaml connection web → api: payload 3 has no name',
    'model.yaml connection web → api: payload 4 must be a mapping',
    'model.yaml connection web → api: payload 5 says nothing: give it an about, a shape or an example',
  ])
})

test('a connection carries at most 12 payloads', () => {
  const m = model({ payloads: { order }, carried: Array.from({ length: 13 }, () => 'order') })
  assert.deepEqual(problems(m), ['model.yaml connection web → api: 13 payloads, at most 12'])
})

test('a step names a payload and a reply that exist, and an inline one is checked', () => {
  const m = model({ payloads: { order }, steps: [{ from: 'web', to: 'api', text: 'x', payload: 'nope', reply: { about: 'y' }, animation: 'call' }] })
  assert.deepEqual(problems(m), ['flows/t.yaml step 1: unknown payload "nope"', 'flows/t.yaml step 1: reply has no name'])
  const unknownReply = model({ payloads: { order }, steps: [{ from: 'web', to: 'api', text: 'x', reply: 'nope', animation: 'call' }] })
  assert.deepEqual(problems(unknownReply), ['flows/t.yaml step 1: unknown reply "nope"'])
})

test('a reply on a send is refused, on a call it is fine', () => {
  const send = model({ payloads: { order }, steps: [{ from: 'web', to: 'api', text: 'x', reply: 'order', animation: 'send' }] })
  assert.deepEqual(problems(send), ['flows/t.yaml step 1: a reply needs a call, a callback or a recurse animation'])
  const still = model({ payloads: { order }, steps: [{ from: 'web', to: 'api', text: 'x', reply: 'order' }] })
  assert.deepEqual(problems(still), ['flows/t.yaml step 1: a reply needs a call, a callback or a recurse animation'])
  const call = model({ payloads: { order }, steps: [{ from: 'web', to: 'api', text: 'x', reply: 'order', animation: { kind: 'call' } }] })
  assert.deepEqual(problems(call), [])
})

test('a payload on a step with no to is refused, unless it recurses', () => {
  const alone = model({ payloads: { order }, steps: [{ from: 'api', text: 'Thinks', payload: 'order' }] })
  assert.deepEqual(problems(alone), ['flows/t.yaml step 1: a payload needs a "to": nothing is sent'])
  const recurse = model({ payloads: { order }, steps: [{ from: 'api', text: 'Prices it', payload: 'order', reply: 'order', animation: 'recurse' }] })
  assert.deepEqual(problems(recurse), [])
})

test('the problems of a step point at it', () => {
  const m = model({ payloads: { order }, steps: [{ from: 'web', to: 'api', text: 'x', payload: 'nope' }] })
  const [p] = check(m)
  assert.equal(p.step, 0)
})
