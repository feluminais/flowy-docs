import { test } from 'node:test'
import assert from 'node:assert/strict'
import { animationFields, animationOf, animationProblem, animationWith, CHANNEL_KINDS, channelLine, DEFAULT_END } from '../src/core/animation.ts'
import { channelProblems, channelsAt, CHANNEL_LABELS, kindsOf, usesChannels } from '../src/core/channels.ts'
import type { Flow, Step } from '../src/core/model.ts'
import { stopsOf } from '../src/core/structure.ts'
import { check } from '../src/core/check.ts'
import { flowToMermaid } from '../src/core/mermaid.ts'
import { shop } from './fixtures.ts'

const step = (extra: Partial<Step> = {}): Step => ({ from: 'web', to: 'api', text: 't', ...extra })
const flowOf = (steps: Step[], extra: Partial<Flow> = {}): Flow => ({ name: 'F', view: 'shop', ...extra, steps })
const at = (flow: Flow, k: number) => channelsAt(flow, stopsOf(flow), k)
const open = (opens: string, more: Record<string, unknown> = {}) => step({ animation: { kind: 'call', opens, ...more } })
const close = (name: string) => step({ animation: { kind: 'send', closes: name } })

test('three kinds, with the words a person says, and where each points when the step does not say', () => {
  assert.deepEqual([...CHANNEL_KINDS], ['stream', 'listener', 'job'])
  assert.deepEqual(CHANNEL_KINDS.map(k => CHANNEL_LABELS[k]), ['Open stream', 'Listening', 'Running job'])
  assert.deepEqual(DEFAULT_END, { stream: 'to', listener: 'from', job: 'to' })
})

test('animationOf reads opens, name, towards and closes', () => {
  assert.deepEqual(animationOf(step({ animation: { kind: 'call', opens: 'stream', name: ' Orders ', towards: 'from' } })), { kind: 'call', trigger: 'inside', opens: 'stream', name: 'Orders', towards: 'from' })
  assert.equal(animationOf(step({ animation: { kind: 'send', closes: 'Orders' } }))?.closes, 'Orders')
  assert.equal(animationOf(step({ animation: 'call' }))?.opens, undefined)
})

test('animationProblem: what a channel may hold', () => {
  const p = (a: Record<string, unknown>) => animationProblem({ kind: 'call', ...a }, true)
  assert.equal(p({ opens: 'stream', name: 'Orders', towards: 'from' }), undefined)
  assert.equal(p({ closes: 'Orders' }), undefined)
  assert.equal(p({ opens: 'pipe' }), 'animation opens must be stream, listener or job')
  assert.equal(p({ opens: 'stream', towards: 'up' }), 'animation towards must be from or to')
  assert.equal(p({ name: 'Orders' }), 'animation name needs opens')
  assert.equal(p({ towards: 'to' }), 'animation towards needs opens')
  assert.equal(p({ opens: 'stream', closes: 'x' }), 'animation opens and closes cannot be on one step')
  assert.equal(p({ opens: 'stream', outcome: 'fail' }), 'animation opens only applies to a request that arrives, not to outcome fail')
  assert.equal(p({ closes: 'x', outcome: 'lost' }), 'animation closes only applies to a request that arrives, not to outcome lost')
  assert.equal(p({ opens: 'stream', name: 'x'.repeat(25) }), 'animation name can be at most 24 characters')
  assert.equal(p({ closes: '' }), 'animation closes must be plain text on one line')
  assert.match(p({ nope: 1 }) ?? '', /use kind, trigger, carries, outcome, share, reason, by, at, opens, name, towards, closes/)
})

test('channelsAt: a channel stays open on the steps after it, until a step closes it', () => {
  const flow = flowOf([step(), open('stream', { name: 'Orders' }), step(), step(), close('Orders'), step()])
  assert.deepEqual(at(flow, 0), [])
  const opened = at(flow, 1)
  assert.equal(opened.length, 1)
  assert.deepEqual({ ...opened[0] }, { step: 1, kind: 'stream', name: 'Orders', from: 'web', to: 'api', end: 'to', opening: true, closing: false })
  assert.deepEqual(at(flow, 2).map(c => [c.name, c.opening, c.closing]), [['Orders', false, false]])
  assert.deepEqual(at(flow, 3).map(c => [c.name, c.opening, c.closing]), [['Orders', false, false]])
  assert.deepEqual(at(flow, 4).map(c => [c.name, c.opening, c.closing]), [['Orders', false, true]], 'the closing step still shows it')
  assert.deepEqual(at(flow, 5), [])
})

test('channelsAt: unnamed channels stay open to the end, and listener and job sit where their kind says', () => {
  const flow = flowOf([open('listener'), open('job'), open('stream', { towards: 'from' }), step()])
  const last = at(flow, 3)
  assert.deepEqual(last.map(c => [c.kind, c.end]), [['listener', 'from'], ['job', 'to'], ['stream', 'from']])
  assert.deepEqual(last.map(c => c.step), [0, 1, 2])
})

test('channelsAt: stepping back needs no undo, and a flow with no channels folds to nothing at once', () => {
  const flow = flowOf([open('stream', { name: 'A' }), close('A')])
  assert.equal(at(flow, 1).length, 1)
  assert.equal(at(flow, 0).length, 1)
  for (const k of [-1, 2, 1.5]) assert.deepEqual(at(flow, k), [], String(k))
  assert.deepEqual(at(flowOf([step(), step()]), 1), [])
  assert.equal(usesChannels(flow), true)
  assert.equal(usesChannels(flowOf([step()])), false)
})

test('channelsAt: a branch lane starts from what was open before the branch, and a channel opened in a lane carries on after it', () => {
  const flow = flowOf(
    [open('stream', { name: 'A' }), step({ group: 'g', lane: 'yes' }), open('job', { name: 'B', group: 'g' }), step({ group: 'g', lane: 'no' }), step()],
    { groups: { g: { kind: 'branch' } } },
  )
  assert.deepEqual(at(flow, 3).map(c => c.name), ['A'], 'the second lane does not see what the first opened')
  assert.deepEqual(at(flow, 4).map(c => c.name), ['A'])
})

test('kindsOf lists the kinds present in the order of the kinds', () => {
  const flow = flowOf([open('job'), open('stream')])
  assert.deepEqual(kindsOf(at(flow, 1)), ['stream', 'job'])
})

test('channelProblems: closing what is not open, and opening a name that is open', () => {
  const p = (steps: Step[]) => { const f = flowOf(steps); return channelProblems(f, stopsOf(f)) }
  assert.deepEqual(p([open('stream', { name: 'A' }), close('A')]), [])
  assert.deepEqual(p([close('A')]), [{ step: 0, message: 'closes "A", but nothing by that name is open' }])
  assert.deepEqual(p([open('stream', { name: 'A' }), close('B')]), [{ step: 1, message: 'closes "B", but nothing by that name is open (open: A)' }])
  assert.deepEqual(p([open('stream', { name: 'A' }), close('A'), close('A')]), [{ step: 2, message: 'closes "A", but nothing by that name is open' }])
  assert.deepEqual(p([open('stream', { name: 'A' }), open('job', { name: 'A' })]), [{ step: 1, message: 'opens "A", which is already open' }])
})

test('check() reports a channel problem on the step, and a good flow has none', () => {
  const model = shop()
  const base = Object.values(model.flows)[0]
  const withSteps = (steps: Step[]) => ({ ...model, flows: { ...model.flows, f: { ...base, steps } } })
  const mine = (steps: Step[]) => check(withSteps(steps)).filter(p => p.file.endsWith('f.yaml'))
  assert.deepEqual(mine([open('stream', { name: 'A' }), close('A')]), [])
  assert.match(mine([close('A')])[0].message, /step 1: closes "A", but nothing by that name is open/)
})

test('animationWith: opening, naming, pointing and closing, and what each one drops', () => {
  assert.deepEqual(animationWith('call', 'opens', 'stream'), { kind: 'call', opens: 'stream' })
  assert.deepEqual(animationWith({ kind: 'call', opens: 'stream' }, 'name', ' Orders '), { kind: 'call', opens: 'stream', name: 'Orders' })
  assert.deepEqual(animationWith({ kind: 'call', opens: 'stream', name: 'O', towards: 'from' }, 'opens', ''), 'call')
  assert.deepEqual(animationWith({ kind: 'call', opens: 'stream', name: 'O' }, 'closes', 'O'), { kind: 'call', closes: 'O' })
  assert.deepEqual(animationWith({ kind: 'call', closes: 'O' }, 'opens', 'job'), { kind: 'call', opens: 'job' })
  assert.deepEqual(animationWith({ kind: 'call', opens: 'stream', name: 'O' }, 'outcome', 'fail'), { kind: 'call', outcome: 'fail' })
  assert.deepEqual(animationFields(step({ animation: { kind: 'call', opens: 'job', name: 'N', towards: 'from' } })), { kind: 'call', outcome: '', share: '', reason: '', by: '', byName: '', opens: 'job', name: 'N', towards: 'from', closes: '' })
})

test('channelLine says what a step opens or closes, and nothing for any other step', () => {
  const line = (a: unknown) => { const x = animationOf(step({ animation: a })); return x && channelLine(x) }
  assert.equal(line({ kind: 'call', opens: 'stream', name: 'Orders' }), 'Opens a stream: Orders')
  assert.equal(line({ kind: 'call', opens: 'listener' }), 'Starts listening')
  assert.equal(line({ kind: 'send', opens: 'job', name: 'Report' }), 'Starts a job: Report')
  assert.equal(line({ kind: 'send', closes: 'Orders' }), 'Closes Orders')
  assert.equal(line('call'), undefined)
})

test('the Mermaid note over a step names what it opens or closes', () => {
  const model = shop()
  const flow = { name: 'F', view: 'shop', steps: [open('stream', { name: 'Orders' }), close('Orders')] }
  const text = flowToMermaid({ ...model, flows: { f: flow } }, 'f')
  assert.match(text, /Note over \w+,\w+: Opens a stream: Orders/)
  assert.match(text, /Note over \w+,\w+: Closes Orders/)
})
