import { test } from 'node:test'
import assert from 'node:assert/strict'
import { flowToMermaid } from '../src/core/mermaid.ts'
import type { Flow, Step } from '../src/core/model.ts'
import { shop } from './fixtures.ts'

const at = (extra: Step) => extra
const withFlow = (groups: Flow['groups'] | undefined, steps: Step[]) => {
  const m = shop()
  m.flows.pays = { name: 'Pays', view: 'shop', ...(groups ? { groups } : {}), steps }
  return m
}
const HEAD = ['sequenceDiagram', '  participant n0 as Web app', '  participant n1 as API', '  participant n2 as Orders DB']

test('groups become loop, alt/else and par blocks, with the steps indented and a flow link as a note', () => {
  const m = withFlow({
    try: { kind: 'repeat', times: '3', text: 'Backs off' },
    result: { kind: 'branch' },
    both: { kind: 'parallel' },
  }, [
    at({ from: 'web', to: 'api', text: 'Posts', group: 'try' }),
    at({ from: 'api', to: 'db', text: 'Saves', group: 'try' }),
    at({ from: 'api', to: 'mail', text: 'Mails receipt', group: 'result', lane: 'Paid' }),
    at({ from: 'api', to: 'customer', text: 'Says thanks', group: 'result' }),
    at({ from: 'api', to: 'customer', text: 'Says sorry', group: 'result', lane: 'Declined' }),
    at({ from: 'api', to: 'db', text: 'Logs', group: 'both', lane: 'Audit', flow: 'checkout' }),
    at({ from: 'api', to: 'mail', text: 'Tells', group: 'both', lane: 'Notify' }),
    at({ from: 'api', text: 'Thinks' }),
  ])
  assert.equal(flowToMermaid(m, 'pays'), [
    ...HEAD,
    '  participant n3 as Mail service',
    '  actor n4 as Customer',
    '  loop 3 times: Backs off',
    '    n0->>n1: Posts',
    '    n1->>n2: Saves',
    '  end',
    '  alt Paid',
    '    n1->>n3: Mails receipt',
    '    n1->>n4: Says thanks',
    '  else Declined',
    '    n1->>n4: Says sorry',
    '  end',
    '  par Audit',
    '    n1->>n2: Logs',
    '    Note over n2: Continues in #quot;Customer checks out#quot;',
    '  and Notify',
    '    n1->>n3: Tells',
    '  end',
    '  Note over n1: Thinks',
    '',
  ].join('\n'))
})

test('a branch with one lane is an opt, and a repeat names what it has: times, until, text', () => {
  const lines = (groups: Flow['groups'], steps: Step[]) => flowToMermaid(withFlow(groups, steps), 'pays').split('\n').filter(l => !/^(sequenceDiagram|  (participant|actor) )/.test(l))
  assert.deepEqual(lines({ b: { kind: 'branch' } }, [at({ from: 'web', to: 'api', text: 'x', group: 'b', lane: 'If valid' })]), ['  opt If valid', '    n0->>n1: x', '  end', ''])
  const loop = (g: Record<string, string>) => lines({ r: { kind: 'repeat', ...g } }, [at({ from: 'web', to: 'api', text: 'x', group: 'r' })])[0]
  assert.equal(loop({ until: 'it works' }), '  loop Until it works')
  assert.equal(loop({ times: '3', until: 'it works' }), '  loop Up to 3 times, until it works')
  assert.equal(loop({ times: '3', until: 'it works', text: 'Backs off' }), '  loop Up to 3 times, until it works: Backs off')
  assert.equal(loop({ text: 'Only words' }), '  loop Only words')
})

test('a lane label, an until and a text can never be read as Mermaid syntax', () => {
  const m = withFlow({ b: { kind: 'branch' }, r: { kind: 'repeat', until: 'a "b"', text: 'x; y' } }, [
    at({ from: 'web', to: 'api', text: 'x', group: 'b', lane: 'a "b"; #c\nend' }),
    at({ from: 'web', to: 'api', text: 'y', group: 'r' }),
  ])
  const text = flowToMermaid(m, 'pays')
  assert.match(text, /^ {2}opt a #quot;b#quot;#59; #35;c end$/m)
  assert.match(text, /^ {2}loop Until a #quot;b#quot;: x#59; y$/m)
})

test('steps in an undeclared group, or one of unknown kind, export plainly, and a missing flow adds no note', () => {
  const m = withFlow({ g: { kind: 'loop' } }, [
    at({ from: 'web', to: 'api', text: 'a', group: 'g' }),
    at({ from: 'web', to: 'api', text: 'b', group: 'nope', flow: 'missing' }),
    at({ from: 'web', to: 'api', text: 'c', flow: ' ' }),
  ])
  assert.equal(flowToMermaid(m, 'pays'), [
    'sequenceDiagram', '  participant n0 as Web app', '  participant n1 as API',
    '  n0->>n1: a', '  n0->>n1: b', '  n0->>n1: c', '',
  ].join('\n'))
})

test('a flow with no groups exports as before', () => {
  assert.equal(flowToMermaid(shop(), 'checkout').includes('loop'), false)
  assert.equal(flowToMermaid(shop(), 'checkout').includes('  n0->>n1: Clicks #quot;Buy#quot;'), true)
})
