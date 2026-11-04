import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { newSketch } from '../src/core/sketches.ts'
import { describeEdit } from '../src/core/editlabel.ts'
import { emptyModel, pairMode } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { modelFiles, parseFile } from '../src/core/modelfiles.ts'
import { disconnect, OpError, putFlow, relabel, removeConnection, setPairs, setProject } from '../src/core/ops.ts'
import { strandCandidates, strandOf, viaBroken, viaKey } from '../src/core/strands.ts'
import { computeView, placeStep } from '../src/core/views.ts'

const PAYLOADS = { scan: { name: 'Scan request', about: 'What the screen sends to start a scan.' } }
/** The model with its settings replaced (the payloads a connection names stay, so the model has no problem of its own). */
const settings = (meta: Record<string, unknown>): Model => ({ ...wlan(), meta: { payloads: PAYLOADS, ...meta } })

/** A UI, a management system and what they talk to: connections between the same two shapes both ways, and a flow on them. */
const wlan = (extra: Record<string, unknown> = {}): Model => ({
  ...emptyModel(),
  meta: { name: 'WLAN', pairs: 'separate', payloads: PAYLOADS, ...extra },
  objects: {
    ui: { type: 'system', name: 'UI' },
    management: { type: 'system', name: 'Management' },
    linux: { type: 'system', name: 'Linux' },
    bus: { type: 'system', name: 'Bus' },
  },
  connections: [
    { from: 'ui', to: 'management', label: 'Request and reply', kind: 'request' },
    { from: 'ui', to: 'management', label: 'Start scan', kind: 'stream', payloads: ['scan'] },
    { from: 'management', to: 'ui', label: 'Scan results', kind: 'publish' },
    { from: 'management', to: 'ui', label: 'Radio state', kind: 'cached' },
    { from: 'management', to: 'linux', label: 'Apply config' },
    { from: 'management', to: 'bus', label: 'Events', kind: 'publish' },
  ],
})

const withSteps = (model: Model, steps: Model['flows'][string]['steps']): Model => ({ ...model, flows: { scan: { name: 'Scan', view: 'root', steps } } })
const messages = (model: Model) => check(model).map(p => p.message)

test('a project draws a line for each connection when its model.yaml says pairs: separate, and one for each pair otherwise', () => {
  assert.equal(pairMode(wlan()), 'separate')
  assert.equal(pairMode({ ...wlan(), meta: {} }), 'merged')
  assert.equal(pairMode({ ...wlan(), meta: { pairs: 'merged' } }), 'merged')
  assert.equal(pairMode({ ...wlan(), meta: { pairs: 'each' } }), 'merged')
  assert.equal(computeView({ ...wlan(), meta: {} }, 'root').strands, undefined)
  assert.equal(computeView({ ...wlan(), meta: { pairs: 'merged' } }, 'root').strands, undefined)
  assert.equal(computeView(wlan(), 'root').edges.length, 3) // the pairs are still one edge each
})

test('check accepts merged and separate and names the words for anything else, in any folder', () => {
  assert.deepEqual(messages(wlan()), [])
  assert.deepEqual(messages(settings({ pairs: 'merged' })), [])
  assert.deepEqual(messages(settings({ pairs: 'each' })), ['pairs can be merged or separate'])
  assert.deepEqual(messages(settings({ pairs: 'Separate' })), ['pairs can be merged or separate'])
})

test('strands: one for each connection of a pair, the way it runs first from the later id, then the others, each in the order of the file', () => {
  const strands = computeView(wlan(), 'root').strands!
  const pair = strands.filter(s => s.pair === 'management ui')
  // management < ui, so the ones that run from ui (the later id) come first.
  assert.deepEqual(pair.map(s => [s.label, s.from, s.lane, s.lanes]), [
    ['Request and reply', 'ui', 0, 4], ['Start scan', 'ui', 1, 4], ['Scan results', 'management', 2, 4], ['Radio state', 'management', 3, 4],
  ])
  assert.equal(pair[0].id, 'management ui|ui>management|Request and reply')
  assert.deepEqual(pair.map(s => s.connections), [[0], [1], [2], [3]])
  assert.deepEqual(pair.map(s => s.kind), ['request', 'stream', 'publish', 'cached'])
  assert.deepEqual(strands.filter(s => s.pair === 'linux management').map(s => [s.id, s.lane, s.lanes]), [['linux management|management>linux|Apply config', 0, 1]])
  // Every id is unique and has the pair first, so it can never be mistaken for a step line.
  assert.equal(new Set(strands.map(s => s.id)).size, strands.length)
  assert.ok(strands.every(s => s.id.startsWith(`${s.pair}|`) && !/^(step|lane)(-\d+)?$/.test(s.id)))
})

test('strands: the order does not depend on the names of the shapes, and an insert elsewhere renames nothing', () => {
  const before = computeView(wlan(), 'root').strands!
  const longer: Model = { ...wlan(), connections: [{ from: 'linux', to: 'bus', label: 'Elsewhere' }, ...wlan().connections] }
  const after = computeView(longer, 'root').strands!
  for (const s of before) {
    const same = after.find(t => t.id === s.id)!
    assert.deepEqual([same.lane, same.lanes], [s.lane, s.lanes])
  }
})

test('strands: connections with the same ends and label fold into one where a view zooms out, and keep a kind they share', () => {
  const model: Model = {
    ...emptyModel(),
    meta: { pairs: 'separate' },
    objects: {
      ui: { type: 'system', name: 'UI' }, screen: { type: 'app', in: 'ui', name: 'Screen' }, banner: { type: 'app', in: 'ui', name: 'Banner' },
      management: { type: 'system', name: 'Management' }, agent: { type: 'app', in: 'management', name: 'Agent' },
    },
    connections: [
      { from: 'screen', to: 'agent', label: 'Ask', kind: 'request' }, { from: 'banner', to: 'agent', label: 'Ask', kind: 'request' },
      { from: 'banner', to: 'agent', label: 'Tell', kind: 'publish' }, { from: 'agent', to: 'screen', label: 'Ask' },
    ],
  }
  const root = computeView(model, 'root').strands!
  assert.deepEqual(root.map(s => [s.label, s.from, s.connections, s.kind]), [['Ask', 'ui', [0, 1], 'request'], ['Tell', 'ui', [2], 'publish'], ['Ask', 'management', [3], undefined]])
  // Inside one system the same connections are lines of their own.
  assert.equal(computeView(model, 'ui').strands!.length, 4)
  assert.equal(new Set(computeView(model, 'ui').strands!.map(s => s.id)).size, 4)
})

test('strandOf: the via decides, whatever the case and the space at its ends', () => {
  const model = wlan()
  const view = computeView(model, 'root')
  const pick = (step: Model['flows'][string]['steps'][number]) => strandOf(model, view, step, ['ui', 'management'])?.label
  assert.equal(pick({ from: 'ui', to: 'management', text: 'x', via: ' start SCAN ' }), 'Start scan')
  assert.equal(pick({ from: 'ui', to: 'management', text: 'x', via: 'Request and reply' }), 'Request and reply')
  assert.equal(viaKey(' start SCAN '), 'start scan')
})

test('strandOf: with no via the payload decides, then the shapes the step is really between, then the first line', () => {
  const model: Model = {
    ...wlan(),
    objects: { ...wlan().objects, screen: { type: 'app', in: 'ui', name: 'Screen' }, banner: { type: 'app', in: 'ui', name: 'Banner' }, agent: { type: 'app', in: 'management', name: 'Agent' } },
    connections: [...wlan().connections, { from: 'screen', to: 'agent', label: 'Ask' }, { from: 'banner', to: 'agent', label: 'Banner' }],
  }
  const view = computeView(model, 'root')
  const pick = (step: Model['flows'][string]['steps'][number]) => strandOf(model, view, step, placeStep(model, 'root', step)!)?.label
  assert.equal(pick({ from: 'ui', to: 'management', text: 'x', payload: 'scan' }), 'Start scan') // the payload of the second connection
  assert.equal(pick({ from: 'ui', to: 'management', text: 'x', payload: 'nobody-has-it' }), 'Request and reply')
  assert.equal(pick({ from: 'banner', to: 'agent', text: 'x' }), 'Banner') // really between the banner and the agent
  assert.equal(pick({ from: 'screen', to: 'agent', text: 'x' }), 'Ask')
  assert.equal(pick({ from: 'ui', to: 'agent', text: 'x' }), 'Request and reply') // nothing decides: the first
  // A wrong via is no error: the later rules still give a line.
  assert.equal(pick({ from: 'banner', to: 'agent', text: 'x', via: 'Nope' }), 'Banner')
})

test('strandOf: a step against a request or a stream rides it, and one against a publish rides nothing', () => {
  const model = wlan()
  const view = computeView(model, 'root')
  const ride = (from: string, to: string, via?: string) => strandOf(model, view, { from, to, text: 'x', ...(via === undefined ? {} : { via }) }, [from, to])?.label
  // The pair holds lines both ways: the ones that run the step's way come first, then the requests against it.
  assert.deepEqual(strandCandidates(view, ['management', 'ui']).map(s => s.label), ['Scan results', 'Radio state', 'Request and reply', 'Start scan'])
  assert.equal(ride('management', 'ui'), 'Scan results')
  assert.equal(ride('management', 'ui', 'Start scan'), 'Start scan') // an answer named by via rides its request
  const only: Model = { ...wlan(), connections: [{ from: 'ui', to: 'management', label: 'Ask', kind: 'request' }, { from: 'management', to: 'bus', label: 'Events', kind: 'publish' }, { from: 'linux', to: 'bus', label: 'Plain' }] }
  const alone = computeView(only, 'root')
  const rideOnly = (from: string, to: string) => strandOf(only, alone, { from, to, text: 'x' }, [from, to])?.label
  assert.equal(rideOnly('management', 'ui'), 'Ask') // the answer to a request
  assert.equal(rideOnly('bus', 'management'), undefined) // nothing comes back on a publish: a step line, as ever
  assert.equal(rideOnly('bus', 'linux'), undefined) // nor on a plain line
  assert.equal(rideOnly('ui', 'ui'), undefined)
})

test('strandOf rides nothing where the view draws one line for each pair', () => {
  const model: Model = { ...wlan(), meta: {} }
  const view = computeView(model, 'root')
  assert.deepEqual(strandCandidates(view, ['ui', 'management']), [])
  assert.equal(strandOf(model, view, { from: 'ui', to: 'management', text: 'x' }, ['ui', 'management']), undefined)
})

test('check reports a via that names no connection between the shapes, and only that', () => {
  const steps = [
    { from: 'ui', to: 'management', text: 'a', via: 'Start scan' },
    { from: 'management', to: 'ui', text: 'b', via: 'start scan' }, // an answer may name the request it answers
    { from: 'ui', to: 'management', text: 'c', via: 'Nope' },
    { from: 'ui', to: 'management', text: 'd', via: '  ' },
    { from: 'ui', to: 'linux', text: 'e', via: 'Apply config' }, // a connection of another pair is no connection of this one
    { from: 'ui', to: 'management', text: 'f' },
    { from: 'ui', text: 'g', via: 'Nope' }, // a shape on its own has no line to name
  ]
  assert.deepEqual(messages(withSteps(wlan(), steps)), [
    'step 3: "via" "Nope" matches no connection from ui to management',
    'step 5: "via" "Apply config" matches no connection from ui to linux',
  ])
  // Two lines a step could ride are not a problem.
  assert.deepEqual(messages(withSteps(wlan(), [{ from: 'ui', to: 'management', text: 'a' }])), [])
  // The check is the same where each pair has one line.
  assert.deepEqual(messages(withSteps(settings({}), [{ from: 'ui', to: 'management', text: 'a', via: 'Nope' }])), ['step 1: "via" "Nope" matches no connection from ui to management'])
})

test('check puts the via of a step on the zoomed-out line it lands on', () => {
  const model: Model = {
    ...wlan(),
    objects: { ...wlan().objects, agent: { type: 'app', in: 'management', name: 'Agent' } },
    connections: [{ from: 'ui', to: 'agent', label: 'Ask' }],
    flows: { f: { name: 'F', view: 'root', steps: [{ from: 'ui', to: 'management', text: 'x', via: 'Ask' }, { from: 'ui', to: 'management', text: 'y', via: 'Tell' }] } },
  }
  assert.deepEqual(messages(model), ['step 2: "via" "Tell" matches no connection from ui to management'])
})

test('a via is plain text in a flow file, kept in place and read back', () => {
  const model = withSteps(wlan(), [{ from: 'ui', to: 'management', text: 'a', via: 'Start scan' }])
  const files = modelFiles(model)
  assert.match(files['flows/scan.yaml'], /via: Start scan/)
  assert.equal((parseFile('flows/scan.yaml', files['flows/scan.yaml']) as Model['flows'][string]).steps[0].via, 'Start scan')
  assert.throws(() => parseFile('flows/scan.yaml', 'name: x\nview: root\nsteps:\n  - { from: ui, to: management, text: a, via: [Start scan] }\n'), /"via" must be plain text/)
})

test('setPairs writes pairs: separate after lines or the name, takes the key off for merged, and refuses any other word', () => {
  const bare = { ...emptyModel(), meta: { name: 'WLAN', about: 'Radios.', lines: 'curved', icons: {} } }
  assert.deepEqual(Object.keys(setPairs(bare, 'separate').meta), ['name', 'about', 'lines', 'pairs', 'icons'])
  assert.deepEqual(Object.keys(setPairs({ ...bare, meta: { icons: {}, name: 'WLAN' } }, 'separate').meta), ['icons', 'name', 'pairs'])
  assert.deepEqual(Object.keys(setPairs({ ...bare, meta: { icons: {} } }, 'separate').meta), ['pairs', 'icons'])
  const set = setPairs(bare, 'separate')
  assert.equal(setPairs(set, 'separate').meta.pairs, 'separate')
  assert.deepEqual(setPairs(set, 'merged').meta, bare.meta)
  assert.deepEqual(setPairs(set, undefined).meta, bare.meta)
  assert.deepEqual(Object.keys(setPairs({ ...set, meta: { pairs: 'merged', name: 'x' } }, 'separate').meta), ['pairs', 'name']) // the key keeps its place
  assert.throws(() => setPairs(bare, 'every' as 'merged'), (e: unknown) => e instanceof OpError && /unknown mode "every" \(use merged or separate\)/.test(e.message))
})

test('setProject takes pairs with the name and about', () => {
  const named = setProject({ ...emptyModel(), meta: { lines: 'curved' } }, { name: 'WLAN', pairs: 'separate' })
  assert.deepEqual(named.meta, { name: 'WLAN', lines: 'curved', pairs: 'separate' })
  assert.deepEqual(setProject(named, { pairs: 'merged' }).meta, { name: 'WLAN', lines: 'curved' })
  assert.deepEqual(setProject(named, { about: 'Radios.' }).meta, { name: 'WLAN', about: 'Radios.', lines: 'curved', pairs: 'separate' })
})

test('the history says what the setting became', () => {
  const bare = { ...emptyModel(), meta: { name: 'WLAN' } }
  assert.equal(describeEdit(bare, setPairs(bare, 'separate')), 'Set lines between two shapes to separate')
  assert.equal(describeEdit(setPairs(bare, 'separate'), bare), 'Set lines between two shapes to merged')
})

test('putFlow keeps a via and drops a blank one', () => {
  const made = putFlow(wlan(), { id: 'scan', name: 'Scan', view: 'root', steps: [{ from: 'ui', to: 'management', text: 'a', via: 'Start scan' }, { from: 'ui', to: 'management', text: 'b', via: '  ' }] })
  assert.deepEqual(made.flows.scan.steps.map(s => s.via), ['Start scan', undefined])
  assert.equal('via' in made.flows.scan.steps[1], false)
})

test('relabel renames the vias that named the old label, and removes them for no label', () => {
  const steps = [
    { from: 'ui', to: 'management', text: 'a', via: ' start SCAN ' },
    { from: 'management', to: 'ui', text: 'b', via: 'Start scan' },
    { from: 'ui', to: 'management', text: 'c', via: 'Request and reply' },
    { from: 'ui', to: 'management', text: 'd', via: 'Nope' },
    { from: 'ui', to: 'management', text: 'e' },
  ]
  const model = withSteps(wlan(), steps)
  const renamed = relabel(model, { from: 'ui', to: 'management', label: 'Start scan' }, 'Begin scan')
  assert.deepEqual(renamed.flows.scan.steps.map(s => s.via), ['Begin scan', 'Begin scan', 'Request and reply', 'Nope', undefined])
  assert.equal(renamed.connections[1].label, 'Begin scan')
  const cleared = relabel(model, { from: 'ui', to: 'management', label: 'Start scan' }, '')
  assert.deepEqual(cleared.flows.scan.steps.map(s => s.via), [undefined, undefined, 'Request and reply', 'Nope', undefined])
  assert.deepEqual(Object.keys(cleared.flows.scan.steps[0]), ['from', 'to', 'text'])
  // The same words in other capitals still name it, and a label another connection of the pair keeps names it too.
  assert.equal(relabel(model, { from: 'ui', to: 'management', label: 'Start scan' }, 'START SCAN').flows.scan.steps[0].via, ' start SCAN ')
  const twin = { ...model, connections: [...model.connections, { from: 'management', to: 'ui', label: 'start scan' }] }
  assert.equal(relabel(twin, { from: 'ui', to: 'management', label: 'Start scan' }, 'Begin scan').flows.scan.steps[0].via, ' start SCAN ')
  // A model with no via has its flows as they were.
  const base = wlan()
  assert.equal(relabel(base, { from: 'ui', to: 'management', label: 'Start scan' }, 'Begin scan').flows, base.flows)
})

test('removing a connection a via names is refused with the steps listed, unless another connection with the label is left', () => {
  const model = withSteps(wlan(), [
    { from: 'ui', to: 'management', text: 'a', via: 'Start scan' },
    { from: 'management', to: 'ui', text: 'b', via: 'start scan' },
    { from: 'ui', to: 'management', text: 'c', via: 'Request and reply' },
  ])
  assert.throws(() => removeConnection(model, { from: 'ui', to: 'management', label: 'Start scan' }),
    (e: unknown) => e instanceof OpError && e.message === 'connection ui → management is named by flow scan step 1, flow scan step 2. Change those first.')
  assert.throws(() => removeConnection(model, { from: 'ui', to: 'management', label: 'Request and reply' }), /flow scan step 3/)
  // The label stays on the pair when another connection keeps it, so the via still names one.
  const twin = { ...model, connections: [...model.connections, { from: 'management', to: 'ui', label: 'Start scan' }] }
  assert.equal(removeConnection(twin, { from: 'ui', to: 'management', label: 'Start scan' }).connections.length, 6)
  // A connection no via names goes as ever.
  assert.equal(removeConnection(model, { from: 'management', to: 'ui', label: 'Radio state' }).connections.length, 5)
})

test('viaBroken lists the steps whose via names nothing after a change, and none for a step that named nothing before', () => {
  const model = withSteps(wlan(), [{ from: 'ui', to: 'management', text: 'a', via: 'Start scan' }, { from: 'ui', to: 'management', text: 'b', via: 'Nope' }])
  assert.deepEqual(viaBroken(model, { ...model, connections: model.connections.filter(c => c.label !== 'Start scan') }), [{ flow: 'scan', step: 0 }])
  assert.deepEqual(viaBroken(model, model), [])
})

test('a new sketch is made with pairs: separate, empty or copied', () => {
  const sketch = newSketch(wlan({ pairs: undefined }), { name: 'Sketch', copy: ['ui', 'management'] })
  assert.equal(sketch.meta.pairs, 'separate')
  assert.deepEqual(Object.keys(sketch.meta).slice(0, 2), ['name', 'pairs'])
  assert.equal(sketch.connections.length, 4)
  assert.deepEqual(newSketch(emptyModel(), { name: 'Blank' }).meta, { name: 'Blank', pairs: 'separate' })
  assert.deepEqual(newSketch(emptyModel(), { name: 'Blank', about: 'Try.' }).meta, { name: 'Blank', about: 'Try.', pairs: 'separate' })
})

test('disconnect with no label is refused where each connection is a line of its own and several run between the two, and lists the labels', () => {
  const model = wlan()
  assert.throws(() => disconnect(model, { from: 'ui', to: 'management' }), (e: unknown) => e instanceof OpError && /2 connections run ui → management/.test(e.message) && /"Request and reply", "Start scan"/.test(e.message))
  // Naming one goes through, and so does a pair with a single connection.
  assert.equal(disconnect(model, { from: 'ui', to: 'management', label: 'Start scan' }).connections.length, 5)
  assert.equal(disconnect(model, { from: 'management', to: 'linux' }).connections.length, 5)
  // A project that draws one line for each pair keeps the old meaning: no label removes them all.
  const merged = { ...model, meta: { ...model.meta, pairs: 'merged' } }
  assert.equal(disconnect(merged, { from: 'ui', to: 'management' }).connections.length, 4)
})
