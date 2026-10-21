import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ANIMATION_KINDS, animationOf, OUTCOMES } from '../src/core/animation.ts'
import { AT_ONCE, eventsOf, isTime, knee, runStates, scaleText, sourceKey, traffic } from '../src/core/perf.ts'
import type { Metrics } from '../src/core/perf.ts'
import { marksOf, readStates, STATE_NAMES, statesAt } from '../src/core/states.ts'
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
  const outcomes = new Set<string>()
  const outside = { afterStep: 0, cold: 0 }
  let carries = 0
  for (const [, flow] of flowList) {
    stopsOf(flow).forEach(stop => stop.steps.forEach(i => {
      const step = flow.steps[i]
      const a = animationOf(step)
      if (a === undefined) return
      played.add(a.kind)
      if (a.outcome !== undefined) outcomes.add(a.outcome)
      if (a.carries !== undefined) carries++
      if (a.kind === 'callback' && a.trigger === 'outside') {
        if (stop.before.some(b => flow.steps[b].to === step.from)) outside.afterStep++
        else outside.cold++
      }
    }))
  }
  for (const kind of ANIMATION_KINDS) assert.ok(played.has(kind), `no step plays "${kind}": add a pair of shapes named for it, and a step, to docs/showcase`)
  for (const outcome of OUTCOMES) assert.ok(outcomes.has(outcome), `no step plays outcome "${outcome}": add a pair of shapes named for it, and a step, to docs/showcase`)
  assert.ok(outside.afterStep > 0, 'no callback that a step before it set off')
  assert.ok(outside.cold > 0, 'no callback that something outside set off, with no step before it')
  assert.ok(carries > 0, 'no step carries a word on its blob')
})

test('every step animation kind has a flow of one step to click through, and so does a callback from outside', () => {
  const single = flowList.filter(([, flow]) => flow.steps.length === 1).map(([, flow]) => animationOf(flow.steps[0]))
  for (const kind of ANIMATION_KINDS) assert.ok(single.some(a => a?.kind === kind), `no flow of one step plays "${kind}": add one to docs/showcase`)
  for (const outcome of OUTCOMES) assert.ok(single.some(a => a?.outcome === outcome), `no flow of one step plays outcome "${outcome}": add one to docs/showcase`)
  assert.ok(single.some(a => a?.kind === 'callback' && a.trigger === 'outside'), 'no flow of one step plays a callback from outside')
  assert.ok(single.some(a => a?.carries !== undefined), 'no flow of one step carries a word')
})

test('the new keys of an outcome are all played: a share, a reason, a place, and a shape and a name that take a request', () => {
  const all = flowList.flatMap(([, flow]) => flow.steps.flatMap(step => animationOf(step) ?? []))
  assert.ok(all.some(a => a.share !== undefined && a.share < 100), 'no step plays only a share of its requests')
  assert.ok(all.some(a => a.reason !== undefined), 'no step gives a reason')
  assert.ok(all.some(a => a.at !== undefined), 'no step says where along its line a request is lost')
  assert.ok(all.some(a => a.by !== undefined && 'name' in a.by), 'no step is intercepted by a party that is not in the model')
  const shapes = all.flatMap(a => (a.by !== undefined && 'shape' in a.by ? [a.by.shape] : []))
  assert.ok(shapes.length > 0, 'no step is intercepted by a shape')
  for (const id of shapes) assert.ok(model.objects[id], `intercepted by "${id}", which is not a shape of the showcase`)
  // A share plays a burst, so the showcase has one that loses part of it and one more that is a single request to compare with.
  assert.ok(all.some(a => a.outcome === 'lost' && a.share === undefined), 'no step loses a single request')
  assert.ok(all.some(a => a.outcome === 'lost' && a.share !== undefined), 'no step loses a share of a burst')
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

test('every state is shown by a flow, and a shape that holds one in a state shows that at the overview', () => {
  const whole = modelOf(state)
  const shown = new Set<string>()
  let inside = 0
  for (const [, flow] of flowList) {
    for (const raw of [flow.states, ...flow.steps.map(s => s.states)]) for (const state of Object.values(readStates(raw))) shown.add(state)
    const stops = stopsOf(flow)
    stops.forEach((_, k) => {
      for (const mark of Object.values(marksOf(whole, statesAt(flow, stops, k)))) if (mark.inside) inside++
    })
  }
  for (const name of STATE_NAMES) assert.ok(shown.has(name), `no flow puts a shape in "${name}": add a step to docs/showcase`)
  assert.ok(inside > 0, 'no stop shows a shape that only holds a shape in a state')
})

test('a run over time puts a shape in every state through its events, and a shape that holds one shows that at the overview', () => {
  const whole = modelOf(state)
  const timed = Object.entries(state.runs ?? {}).filter(([, r]) => isTime(r))
  assert.ok(timed.length > 0, 'no run over time: add one to docs/showcase/flowy/perf')
  const shown = new Set<string>()
  let inside = 0
  for (const [, r] of timed) {
    for (const e of eventsOf(r)) {
      shown.add(e.state)
      for (const mark of Object.values(marksOf(whole, runStates(r, e.at)))) if (mark.inside) inside++
    }
  }
  for (const name of STATE_NAMES) assert.ok(shown.has(name), `no event of a run over time puts a shape in "${name}": add one to docs/showcase/flowy/perf`)
  assert.ok(inside > 0, 'no event leaves a shape that only holds a shape in a state')
})

test('the run over time has events that fall between its levels, so the slider has somewhere to stand that no level is', () => {
  const [, r] = Object.entries(state.runs ?? {}).find(([, found]) => isTime(found)) ?? []
  assert.ok(r, 'no run over time')
  const times = new Set(r.levels.map(l => l.load))
  assert.ok(eventsOf(r).some(e => !times.has(e.at)), 'every event is on a level: put one between two')
  assert.ok(eventsOf(r).length >= 7, 'one event for each state, and more')
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

test('the Colour and scale run sets a colour, a dot formula and a size formula, and its lines use bytes, lost and rejected', () => {
  const scale = state.runs?.scale
  assert.ok(scale, 'perf/scale.yaml is missing')
  assert.ok(scale.source?.color && scale.source.dot && scale.source.size, 'the source should set color, dot and size')
  assert.equal(scaleText(scale), '1 dot = 50 calls/s')
  const lines = scale.levels.flatMap(l => l.connections)
  assert.ok(lines.some(c => c.bytes !== undefined), 'no line has a size of a call (bytes)')
  assert.ok(lines.some(c => c.failure === 'lost' && (c.errors ?? 0) > 0), 'no line fails by losing calls')
  assert.ok(lines.some(c => c.failure === 'rejected' && (c.errors ?? 0) > 0), 'no line fails by rejecting calls')
  const bytes = new Set(lines.filter(c => c.to === 'dots-big').map(c => c.bytes))
  assert.ok(bytes.size >= 4, 'the size of a call should change across the levels')
})

test('at the strongest level the canvas shows dots in proportion to the calls, a line scaled down, a bigger dot and both ways to fail', () => {
  const scale = state.runs?.scale
  assert.ok(scale)
  const top = scale.levels[scale.levels.length - 1].load
  const whole = { ...model, flows, failures: {}, layout: state.layout }
  const t = traffic(whole, scale, top, 'scale')
  const line = (to: string) => t.lines.find(l => l.to === to)
  assert.equal(line('dots-few')?.dots, 16)
  assert.equal(line('dots-many')?.dots, AT_ONCE, 'the busy line should pass the cap')
  assert.equal(line('dots-many')?.capped, true)
  assert.equal(line('dots-few')?.capped, undefined)
  assert.equal(line('dots-slow')?.dots, line('dots-few')?.dots, 'equal calls should be equal dots, whatever the speed')
  assert.ok(line('dots-slow')!.travelMs > line('dots-few')!.travelMs * 2, 'the slow line should take longer to cross')
  assert.ok((line('dots-big')?.radius ?? 0) >= 2, 'the bigger calls should draw bigger dots')
  assert.equal(line('calls-lost')?.failure, 'lost')
  assert.equal(line('calls-rejected')?.failure, 'rejected')
  assert.ok(t.lines.every(l => l.color === 'blue'))
  const key = sourceKey(scale, t.lines)
  assert.deepEqual(key, { name: 'Colour and scale', color: 'blue', scale: '1 dot = 50 calls/s', bigger: true, scaledDown: true })
  const lowest = traffic(whole, scale, scale.levels[0].load, 'scale')
  assert.equal(sourceKey(scale, lowest.lines)?.scaledDown, false, 'nothing is scaled down at the lowest level')
})

test('the Colour and scale shapes are all named and each one has a line from the source', () => {
  const inside = Object.entries(model.objects).filter(([, o]) => o.in === 'scale').map(([id]) => id)
  assert.ok(inside.length >= 7)
  for (const id of inside.filter(i => i !== 'source')) assert.ok(model.connections.some(c => c.from === 'source' && c.to === id), `${id} has no line from the source`)
})
