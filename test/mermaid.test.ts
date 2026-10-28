import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowToMermaid, mermaidText, viewToMermaid } from '../src/core/mermaid.ts'
import { shop } from './fixtures.ts'

test('a view becomes a flowchart, with the boxes around it dashed and lines merged', () => {
  assert.equal(viewToMermaid(shop(), 'shop'), [
    'flowchart TB',
    '  n0["Web app<br/>app · React"]',
    '  n1["API<br/>app · Node"]',
    '  n2[("Orders DB<br/>store · Postgres")]',
    '  n3(["Customer<br/>actor"])',
    '  n4["Mail service<br/>system"]',
    '  n3 -- "browses" --> n0',
    '  n0 -- "REST" --> n1',
    '  n1 -- "2 connections" --> n2',
    '  n1 -- "sends receipts" --> n4',
    '  classDef outsider stroke-dasharray: 4 3',
    '  class n3,n4 outsider',
    '',
  ].join('\n'))
})

test('a flow becomes a sequence diagram of the boxes its steps land on', () => {
  assert.equal(flowToMermaid(shop(), 'checkout'), [
    'sequenceDiagram',
    '  actor n0 as Customer',
    '  participant n1 as Web app',
    '  participant n2 as API',
    '  participant n3 as Orders DB',
    '  n0->>n1: Clicks #quot;Buy#quot;',
    '  n1->>n2: POST /orders',
    '  n2->>n3: Saves the order',
    '',
  ].join('\n'))
})

test('names and labels can never be read as Mermaid syntax', () => {
  assert.equal(mermaidText('A "B" #1; <x>\n  next'), 'A #quot;B#quot; #35;1#59; #lt;x#gt; next')
  const m = shop()
  m.objects.web.name = 'end"]; click x'
  assert.match(viewToMermaid(m, 'shop'), /n0\["end#quot;\]#59; click x<br\/>app · React"\]/)
})

test('an unknown view or flow is an error', () => {
  assert.throws(() => viewToMermaid(shop(), 'nope'), /unknown view "nope"/)
  assert.throws(() => flowToMermaid(shop(), 'nope'), /unknown flow "nope"/)
  assert.throws(() => flowToMermaid(shop(), 'constructor'), /unknown flow "constructor"/)
  assert.match(viewToMermaid(shop(), 'root'), /^flowchart TB\n/)
})

test('a one-box step is a note over that box', () => {
  const m = shop()
  m.flows.checkout.steps.push({ from: 'orders', text: 'Checks stock' })
  assert.match(flowToMermaid(m, 'checkout'), /\n {2}Note over n2: Checks stock\n$/)
})

test('a step that ends in an outcome says so in a note over its ends, in the words of the step card', () => {
  const m = shop()
  m.flows.checkout.steps = [
    { from: 'customer', to: 'web', text: 'Clicks', animation: { kind: 'send', outcome: 'lost', share: '30' } },
    { from: 'web', to: 'api', text: 'Posts', animation: { kind: 'call', outcome: 'rejected', reason: 'Rate limit' } },
    { from: 'web', to: 'api', text: 'Posts again', animation: { kind: 'call', outcome: 'intercepted', by: { name: 'Café wifi proxy' } } },
    { from: 'web', to: 'api', text: 'Posts a third time', animation: { kind: 'call', outcome: 'intercepted', by: 'mail' } },
    { from: 'api', to: 'db', text: 'Saves', animation: { kind: 'send', outcome: 'duplicated' } },
    { from: 'api', to: 'db', text: 'Saves slowly', animation: { kind: 'call', outcome: 'delayed', reason: 'Cold start' } },
    { from: 'api', to: 'db', text: 'Saves badly', animation: { kind: 'call', outcome: 'timeout' } },
    { from: 'api', to: 'db', text: 'Saves wrongly', animation: { kind: 'send', outcome: 'fail', share: '10' } },
  ]
  assert.equal(flowToMermaid(m, 'checkout'), [
    'sequenceDiagram',
    '  actor n0 as Customer',
    '  participant n1 as Web app',
    '  participant n2 as API',
    '  participant n3 as Orders DB',
    '  n0->>n1: Clicks',
    '  Note over n0,n1: 30% lost',
    '  n1->>n2: Posts',
    '  Note over n1,n2: Rejected: Rate limit',
    '  n1->>n2: Posts again',
    '  Note over n1,n2: Taken by Café wifi proxy',
    '  n1->>n2: Posts a third time',
    '  Note over n1,n2: Taken by Mail service',
    '  n2->>n3: Saves',
    '  Note over n2,n3: Sent twice',
    '  n2->>n3: Saves slowly',
    '  Note over n2,n3: Delayed: Cold start',
    '  n2->>n3: Saves badly',
    '  Note over n2,n3: Times out',
    '  n2->>n3: Saves wrongly',
    '  Note over n2,n3: 10% fail',
    '',
  ].join('\n'))
})

test('a reason can never be read as Mermaid syntax, and a step without an outcome gets no note', () => {
  const m = shop()
  m.flows.checkout.steps = [
    { from: 'customer', to: 'web', text: 'Clicks', animation: { kind: 'send', outcome: 'lost', reason: 'Gone; "far" <away>' } },
    { from: 'web', to: 'api', text: 'Posts', animation: 'call' },
  ]
  const out = flowToMermaid(m, 'checkout')
  assert.match(out, /\n {2}Note over n0,n1: Lost: Gone#59; #quot;far#quot; #lt;away#gt;\n/)
  assert.equal(out.split('\n').filter(l => l.includes('Note over')).length, 1)
})

test('a recursion is an arrow back to the same shape, and nothing that only looks like one is', () => {
  const m = shop()
  m.flows.checkout.steps = [
    { from: 'api', text: 'Walks the tree', animation: 'recurse' },
    { from: 'api', text: 'Plain note' },
    { from: 'api', text: 'Bad depth', animation: { kind: 'recurse', depth: '9' } },
    { from: 'api', to: 'api', text: 'To itself', animation: 'recurse' },
    { from: 'api', to: 'db', text: 'Recurse with a to', animation: 'recurse' },
    { from: 'api', text: 'Not a recursion', animation: 'call' },
  ]
  const text = flowToMermaid(m, 'checkout')
  assert.match(text, /\n {2}(n\d+)->>\1: Walks the tree\n/)
  for (const note of ['Plain note', 'Bad depth', 'To itself', 'Not a recursion']) assert.match(text, new RegExp(`\\n {2}Note over n\\d+: ${note}\\n`), note)
  assert.match(text, /\n {2}(n\d+)->>(?!\1)n\d+: Recurse with a to\n/)
})

test('a backtick is escaped too, since one right after a quote starts Mermaid markdown', () => {
  assert.equal(mermaidText('`flowy` CLI'), '#96;flowy#96; CLI')
})
