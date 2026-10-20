import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ANIMATION_KINDS, animationOf } from '../src/core/animation.ts'
import { knee, traffic } from '../src/core/perf.ts'
import type { Metrics } from '../src/core/perf.ts'
import { GROUP_KINDS, runsOf, stopsOf } from '../src/core/structure.ts'
import { fileData, serializeFile } from '../src/core/model.ts'
import { modelOf } from '../src/core/state.ts'
import { loadState } from '../src/node/files.ts'

/**
 * docs/showcase is the page that plays every animation Flowy has, so a person can open it and see that each one works and
 * looks right. These tests are what keeps it complete: a new animation kind, group kind or load effect fails here until the
 * showcase has a pair of shapes and a step for it. Add the pair to docs/showcase/flowy, then to the list in this file.
 */
const dir = join(import.meta.dirname, '../docs/showcase/flowy')
const state = await loadState(dir)
assert.ok('model' in state && 'flows' in state, 'the showcase folder should load')
const { model, flows } = state
const flowList = Object.entries(flows)
const run = state.runs?.['every-load-effect']

test('the showcase loads with nothing wrong in it, in its flows or in its run', () => {
  assert.deepEqual(state.problems, [])
  assert.equal('runProblems' in state, false)
  assert.ok(run, 'perf/every-load-effect.yaml is missing')
})

test('every file of the showcase writes back, so it can be edited in edit mode', () => {
  const whole = modelOf(state)
  for (const file of ['model.yaml', ...Object.keys(whole.flows).map(id => `flows/${id}.yaml`)])
    // A comma inside unquoted text in a { } line ends the value and leaves a key with no value, which can't be written.
    assert.doesNotThrow(() => serializeFile(file, fileData(whole, file)), `${file} can't be written back`)
})

test('every shape inside a showcase view is named for the animation it plays, and no two share a name', () => {
  const names = Object.entries(model.objects).filter(([, o]) => o.in !== undefined && model.objects[o.in]?.type === 'system').map(([id, o]) => [id, o.name] as const)
  assert.ok(names.length >= 20, `only ${names.length} shapes`)
  for (const [id, name] of names) assert.ok(name.trim() !== '' && name !== id, `${id} needs a name a person would say`)
  assert.equal(new Set(names.map(([, n]) => n)).size, names.length, 'two shapes share a name, so they are hard to tell apart')
})

test('every step animation kind is played by a step, and the callback is shown after a step and with none before it', () => {
  const played = new Set<string>()
  const outside = { afterStep: 0, cold: 0 }
  let carries = 0
  for (const [, flow] of flowList) {
    stopsOf(flow).forEach(stop => stop.steps.forEach(i => {
      const step = flow.steps[i]
      const a = animationOf(step)
      if (a === undefined) return
      played.add(a.kind)
      if (a.carries !== undefined) carries++
      if (a.kind === 'callback' && a.trigger === 'outside') {
        if (stop.before.some(b => flow.steps[b].to === step.from)) outside.afterStep++
        else outside.cold++
      }
    }))
  }
  for (const kind of ANIMATION_KINDS) assert.ok(played.has(kind), `no step plays "${kind}": add a pair of shapes named for it, and a step, to docs/showcase`)
  assert.ok(outside.afterStep > 0, 'no callback that a step before it set off')
  assert.ok(outside.cold > 0, 'no callback that something outside set off, with no step before it')
  assert.ok(carries > 0, 'no step carries a word on its blob')
})

test('every step animation kind has a flow of one step to click through, and so does a callback from outside', () => {
  const single = flowList.filter(([, flow]) => flow.steps.length === 1).map(([, flow]) => animationOf(flow.steps[0]))
  for (const kind of ANIMATION_KINDS) assert.ok(single.some(a => a?.kind === kind), `no flow of one step plays "${kind}": add one to docs/showcase`)
  assert.ok(single.some(a => a?.kind === 'callback' && a.trigger === 'outside'), 'no flow of one step plays a callback from outside')
  assert.ok(single.some(a => a?.carries !== undefined), 'no flow of one step carries a word')
})

test('every kind of group is drawn by a flow, and a step can hand its story to another flow and can act on its own', () => {
  for (const kind of GROUP_KINDS) {
    assert.ok(flowList.some(([, flow]) => runsOf(flow).some(r => r.kind === kind)), `no flow has a "${kind}" group: add one to docs/showcase`)
  }
  const parallel = flowList.flatMap(([, flow]) => runsOf(flow).filter(r => r.kind === 'parallel'))
  assert.ok(parallel.some(r => r.lanes.some(l => l.steps.length > 1) && r.lanes.some(l => l.steps.length === 1)), 'no parallel group with a lane that outlasts the others')
  assert.ok(flowList.some(([, flow]) => flow.steps.some(s => s.flow !== undefined && s.flow in flows)), 'no step hands its story to another flow')
  assert.ok(flowList.some(([, flow]) => flow.steps.some(s => s.to === undefined)), 'no step where a shape acts on its own')
})

test('the run has every load effect, and the strongest level shows each one', () => {
  assert.ok(run)
  const levels = run.levels
  const objectMetric = (key: keyof Metrics) => levels.flatMap(l => Object.entries(l.objects).filter(([, m]) => m[key] !== undefined).map(([id]) => id))
  const edge = (key: keyof Metrics) => levels.flatMap(l => l.connections.filter(c => c[key] !== undefined && c[key] !== 0))
  assert.ok(objectMetric('util').length > 0, 'no shape fills up (util)')
  assert.ok(objectMetric('errors').length > 0, 'no shape fails calls (errors)')
  assert.ok(objectMetric('queue').length > 0, 'no shape has calls waiting (queue)')
  assert.ok(edge('errors').length > 0, 'no line has failing calls (errors)')
  assert.ok(edge('rate').length > 0, 'no line carries traffic (rate)')
  for (const key of ['rate', 'p50'] as const) {
    const byLine = new Map<string, Set<number>>()
    for (const l of levels) for (const c of l.connections) if (c[key] !== undefined) byLine.set(`${c.from} ${c.to}`, (byLine.get(`${c.from} ${c.to}`) ?? new Set()).add(c[key]))
    assert.ok([...byLine.values()].some(v => v.size >= 4), `no line changes its ${key} across the levels`)
  }
  assert.ok(knee(run), 'the run never first struggles, so the chart has no mark')
  assert.ok(levels[0].overall.p95 !== undefined && levels[0].overall.p50 !== undefined, 'the chart needs overall p50 and p95')
})

test('at the strongest load the canvas shows strain, waiting, failing calls and slow calls, and leaves what was not measured plain', () => {
  assert.ok(run)
  const top = run.levels[run.levels.length - 1].load
  const t = traffic({ ...model, flows, failures: {}, layout: state.layout }, run, top, 'performance')
  assert.ok(Object.values(t.boxes).some(b => b.strain !== undefined && b.strain >= 0.85), 'no shape is near full')
  assert.ok(Object.values(t.boxes).some(b => b.queue > 0), 'no shape shows a waiting badge')
  assert.ok(t.lines.some(l => l.failed >= 0.2), 'no line has failing calls')
  assert.ok(t.lines.some(l => l.travelMs >= 2500), 'no line has slow calls')
  assert.ok(t.lines.some(l => l.perSecond >= 10), 'no line is busy')
  assert.equal('not-measured' in t.boxes, false, 'a shape that was not measured must stay plain')
  assert.equal(t.lines.some(l => l.to === 'not-measured'), false, 'a line that was not measured must stay plain')
  const held = model.objects['rolled-up']
  assert.ok(held, 'rolled-up is missing')
  const parts = Object.entries(model.objects).filter(([, o]) => o.in === 'rolled-up').map(([id]) => id)
  assert.ok(parts.length >= 2, 'rolled-up needs at least two parts')
  assert.equal(t.boxes['rolled-up'].queue, parts.reduce((n, id) => n + (t.boxes[id]?.queue ?? 0), 0), 'the holder should show the waiting of its parts added up')
})
