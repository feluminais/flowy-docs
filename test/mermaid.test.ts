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

test('a backtick is escaped too, since one right after a quote starts Mermaid markdown', () => {
  assert.equal(mermaidText('`flowy` CLI'), '#96;flowy#96; CLI')
})
