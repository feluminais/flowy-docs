import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowToMermaid } from '../src/core/mermaid.ts'
import { shop } from './fixtures.ts'

test('a step that stops a shape adds a note over it with the state\'s name, and a flow\'s start says what is not running', () => {
  const m = shop()
  m.flows.checkout.states = { db: 'starting', mail: 'running' }
  m.flows.checkout.steps[1].states = { api: 'stopped', db: 'running' }
  assert.equal(flowToMermaid(m, 'checkout'), [
    'sequenceDiagram',
    '  actor n0 as Customer',
    '  participant n1 as Web app',
    '  participant n2 as API',
    '  participant n3 as Orders DB',
    '  participant n4 as Mail service',
    '  Note over n3: Starting',
    '  n0->>n1: Clicks #quot;Buy#quot;',
    '  n1->>n2: POST /orders',
    '  Note over n2: Stopped',
    '  Note over n3: Running',
    '  n2->>n3: Saves the order',
    '',
  ].join('\n'))
})

test('a shape only a states names becomes a participant, and one the model does not have is left out', () => {
  const m = shop()
  m.flows.checkout.steps[0].states = { orders: 'degraded', ghost: 'stopped' }
  const text = flowToMermaid(m, 'checkout')
  assert.match(text, /\n {2}participant n4 as Orders\n/)
  assert.match(text, /\n {2}Note over n4: Degraded\n/)
  assert.doesNotMatch(text, /ghost|Stopped/)
})
