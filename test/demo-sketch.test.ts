import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { animationOf } from '../src/core/animation.ts'
import { KIND_IDS, kindOf } from '../src/core/kinds.ts'
import { payloadsOf } from '../src/core/payloads.ts'
import { modelOf } from '../src/core/state.ts'
import { strandOf, viaKey } from '../src/core/strands.ts'
import { computeView, lineKey, placeStep } from '../src/core/views.ts'
import { runsOf } from '../src/core/structure.ts'
import { loadState } from '../src/node/files.ts'

/**
 * The Embedded device sketch of the Plum demo (docs/demo/flowy/sketches/embedded-device) is what a person opens to see several lines between two shapes: three layers, a line for
 * each connection, all six kinds, and flows whose steps name the line they ride. These tests keep it that way.
 */
const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy/sketches/embedded-device'))
assert.ok('model' in state && 'flows' in state, 'the sketch folder should load')
const model = modelOf(state)
const flows = Object.entries(model.flows)
const view = computeView(model, 'root')
const between = (a: string, b: string) => model.connections.filter(c => lineKey(c.from, c.to) === lineKey(a, b))

test('the sketch loads with nothing wrong in it, and draws a line for each connection', () => {
  assert.deepEqual(state.problems, [])
  assert.equal(model.meta.pairs, 'separate')
  assert.equal(view.strands?.length, model.connections.length)
})

test('three layers with generic names, joined by connections of all six kinds', () => {
  const layers = ['touch-app', 'controller', 'network-daemon']
  assert.deepEqual(layers.map(id => model.objects[id]?.name), ['Touch app', 'Controller', 'Network daemon'])
  const kinds = new Set(model.connections.map(c => kindOf(c)))
  for (const kind of KIND_IDS) assert.ok(kinds.has(kind), `no connection is a ${kind}`)
  assert.ok(kinds.has(undefined), 'no plain line to show beside the kinds')
  // Which layer starts what: the Touch app asks the Controller, which asks the daemon, and the Controller and the daemon publish upwards.
  for (const [a, b] of [['touch-app', 'controller'], ['controller', 'network-daemon']]) {
    const lines = between(a, b)
    assert.ok(lines.length >= 5, `${a} and ${b} have only ${lines.length} lines`)
    assert.ok(lines.some(c => c.from === a) && lines.some(c => c.from === b), `${a} and ${b} talk one way only`)
  }
  assert.equal(between('touch-app', 'network-daemon').length, 0, 'the Touch app talks to the Controller only')
})

test('lines that carry something name a payload that exists', () => {
  const listed = model.connections.flatMap(c => (Array.isArray(c.payloads) ? c.payloads : []))
  assert.ok(listed.length >= 4, 'few lines carry anything')
  for (const id of listed) assert.ok(typeof id === 'string' && Object.hasOwn(payloadsOf(model), id), `a line carries "${String(id)}", which is not under payloads`)
})

test('every step between two shapes moves, and every step on a pair of several lines rides the line it names', () => {
  for (const [id, flow] of flows) {
    flow.steps.forEach((step, i) => {
      const at = `${id} step ${i + 1}`
      if (step.to === undefined) return
      assert.notEqual(animationOf(step), undefined, `${at} does not move`)
      const placed = placeStep(model, flow.view, step)
      assert.ok(placed, `${at} lands nowhere`)
      const lines = between(placed[0], placed[1])
      if (lines.length < 2) return
      assert.ok(typeof step.via === 'string', `${at} is between two shapes with ${lines.length} lines and names none`)
      assert.equal(viaKey(strandOf(model, view, step, placed)?.label), viaKey(step.via), `${at} rides a line other than the one it names`)
    })
  }
})

test('the flows show a request and reply, a stream, a cached publish on subscribe, a publish with two subscribers, an extension point and a failure', () => {
  const rides = (flow: string) => model.flows[flow].steps.map(step => {
    const placed = step.to === undefined ? null : placeStep(model, model.flows[flow].view, step)
    const strand = placed ? strandOf(model, view, step, placed) : undefined
    return { step, kind: strand?.kind, animation: animationOf(step) }
  })
  assert.equal(flows.length, 4)
  for (const [, flow] of flows) assert.equal(flow.view, 'root')

  const screen = rides('open-the-wifi-screen')
  assert.ok(screen.some(r => r.kind === 'request' && r.animation?.kind === 'call' && r.step.reply !== undefined), 'no request and reply with an answer')
  const listener = screen.findIndex(r => r.animation?.opens === 'listener')
  assert.ok(listener >= 0, 'nothing subscribes')
  assert.ok(screen.slice(listener + 1).some(r => r.kind === 'cached' && r.animation?.kind === 'event'), 'the subscriber is not handed the cached value at once')

  const scan = rides('scan-for-networks')
  const opened = scan.flatMap(r => (r.animation?.opens === 'stream' ? [r.animation.name] : []))
  assert.equal(opened.length, 2, 'the scan should open a stream on each pair')
  assert.deepEqual(scan.flatMap(r => (r.animation?.closes ? [r.animation.closes] : [])).sort(), [...opened].sort(), 'each stream is closed by a later step')
  assert.ok(scan.some(r => r.kind === 'stream' && r.step.from === 'controller' && r.step.to === 'touch-app'), 'the results do not come back on the line that asked')

  const join = model.flows['join-a-network']
  const parallel = runsOf(join).filter(r => r.kind === 'parallel')
  assert.equal(parallel.length, 1)
  assert.equal(parallel[0].lanes.length, 2, 'a publish with two subscribers is two lanes')
  const heard = rides('join-a-network').filter(r => r.kind === 'publish')
  assert.equal(heard.length, 2)
  assert.deepEqual(new Set(heard.map(r => r.step.to)), new Set(['touch-app', 'network-daemon']))
  assert.ok(rides('join-a-network').some(r => r.kind === 'extension' && r.animation?.kind === 'call'), 'no call of an extension point')

  const failed = rides('the-radio-does-not-answer').filter(r => r.animation?.outcome !== undefined)
  assert.deepEqual(failed.map(r => r.animation?.outcome), ['timeout'])
  assert.equal(failed[0].kind, 'request')
  // The answer to the screen rides the line of the request that came in, against its way.
  const answer = rides('the-radio-does-not-answer').find(r => r.step.from === 'controller' && r.step.to === 'touch-app')
  assert.equal(answer?.kind, 'request')
})
