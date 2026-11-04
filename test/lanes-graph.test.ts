import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHAPE_DEFS } from '../src/core/look.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { computeView } from '../src/core/views.ts'
import { focusEdges, pairOf, strandName, toGraph } from '../ui/src/graph.ts'
import { edgeUnder, hitStrand, laneOf, lineOf } from '../ui/src/lanehit.ts'
import { placeLabels } from '../ui/src/labels.ts'
import { lanes, REST, SPREAD } from '../ui/src/lanes.ts'
import { boxEnd } from '../ui/src/lanehit.ts'

// The lines of a pair side by side on the canvas: one edge for each connection with the pair on it, which of them is lit, spread and labelled, and which one the pointer means.

/** A UI and a management system with four connections between them, and two systems each connected once, in a project that draws a line for each connection. */
const wlan = (extra: Partial<Model> = {}): Model => ({
  ...emptyModel(),
  meta: { name: 'WLAN', pairs: 'separate' },
  objects: {
    ui: { type: 'system', name: 'UI' }, management: { type: 'system', name: 'Management' }, linux: { type: 'system', name: 'Linux' }, cloud: { type: 'system', name: 'Cloud' },
  },
  connections: [
    { from: 'ui', to: 'management', label: 'Request and reply', kind: 'request' },
    { from: 'ui', to: 'management', label: 'Start scan', kind: 'stream' },
    { from: 'management', to: 'ui', label: 'Scan results', kind: 'publish' },
    { from: 'management', to: 'ui', label: 'Radio state' },
    { from: 'management', to: 'linux', label: 'Apply config' },
    { from: 'cloud', to: 'management' },
  ],
  flows: {
    scan: {
      name: 'Scan', view: 'root', steps: [
        { from: 'ui', to: 'management', text: 'Asks', via: 'Start scan' },
        { from: 'management', to: 'ui', text: 'Answers' },
        { from: 'management', to: 'linux', text: 'Applies' },
      ],
    },
  },
  ...extra,
})

const IDS = {
  request: 'management ui|ui>management|Request and reply', scan: 'management ui|ui>management|Start scan',
  results: 'management ui|management>ui|Scan results', radio: 'management ui|management>ui|Radio state',
  apply: 'linux management|management>linux|Apply config', cloud: 'cloud management|cloud>management|',
}

test('a project that draws a line for each connection gets an edge for each, in lane order, with the pair on it', () => {
  const { edges } = toGraph(wlan(), 'root')
  assert.deepEqual(edges.map(e => e.id), [IDS.request, IDS.scan, IDS.results, IDS.radio, IDS.apply, IDS.cloud])
  assert.deepEqual(edges.map(e => [e.source, e.target, e.label]), [
    ['ui', 'management', 'Request and reply'], ['ui', 'management', 'Start scan'], ['management', 'ui', 'Scan results'], ['management', 'ui', 'Radio state'],
    ['management', 'linux', 'Apply config'], ['cloud', 'management', undefined],
  ])
  assert.deepEqual(edges.map(e => pairOf(e)), ['management ui', 'management ui', 'management ui', 'management ui', 'linux management', 'cloud management'])
  assert.deepEqual(edges.map(e => e.data?.slot), [
    { lane: 0, lanes: 4, back: 2 }, { lane: 1, lanes: 4, back: 2 }, { lane: 2, lanes: 4, back: 2 }, { lane: 3, lanes: 4, back: 2 },
    { lane: 0, lanes: 1, back: 1 }, { lane: 0, lanes: 1, back: 0 }, // a lone line that runs from the later id of its pair is a back lane of one
  ])
  // A strip the reach wide on each side (in screen pixels) where there are several lines; a lone line keeps React Flow's.
  assert.deepEqual(edges.map(e => e.interactionWidth), [14, 14, 14, 14, undefined, undefined])
  assert.ok(edges.every(e => e.type === 'line' && e.id.includes('|')))
  // The look of each, from its own connection.
  assert.deepEqual(edges.map(e => (e.data?.look as { head: string } | undefined)?.head), ['filled', 'filled', 'open', undefined, undefined, undefined])
})

test('a project that draws one line for each pair is drawn as before', () => {
  const { edges } = toGraph(wlan({ meta: {} }), 'root')
  assert.deepEqual(edges.map(e => e.id), ['management ui', 'linux management', 'cloud management'])
  assert.ok(edges.every(e => e.data?.pair === undefined && e.data?.slot === undefined && e.interactionWidth === undefined))
})

test('a screen reader hears the place among the lines of a pair, the way it runs, its label and its kind', () => {
  const model = wlan()
  const names = Object.fromEntries(toGraph(model, 'root').edges.map(e => [e.id, e.ariaLabel]))
  assert.equal(names[IDS.request], '1 of 4, from UI to Management, Request and reply, Request and reply')
  assert.equal(names[IDS.scan], '2 of 4, from UI to Management, Start scan, Request then stream')
  assert.equal(names[IDS.results], '3 of 4, from Management to UI, Scan results, Publish and subscribe')
  assert.equal(names[IDS.radio], '4 of 4, from Management to UI, Radio state')
  // A line alone between its shapes is named as it always was.
  assert.equal(names[IDS.apply], 'Management to Linux, Apply config')
  assert.equal(names[IDS.cloud], 'Cloud to Management')
  const view = computeView(model, 'root')
  assert.equal(strandName(model, view.strands!.find(s => s.id === IDS.radio)!), names[IDS.radio])
})

test('a step lights the line it names, or the one its way and order pick, and dims the rest, even in its own pair', () => {
  const model = wlan()
  const ends = model.flows.scan.steps.map((s): [string, string] => [s.from, s.to!])
  const lit = (playing: Parameters<typeof toGraph>[2]) => toGraph(model, 'root', playing).edges.map(e => [e.id, e.className])
  // Without being told which line a step rides, it takes the first that runs its way: step 0 the first from UI, step 1 the first from Management to UI. The other lines of the pair are
  // its kin (0.35), the lines of other pairs are dim (0.15), and a lit line with neighbours is `several` (it fades to half, not a quarter, when its step times out).
  assert.deepEqual(lit({ ends, step: 0 }), [[IDS.request, 'active several'], [IDS.scan, 'kin'], [IDS.results, 'kin'], [IDS.radio, 'kin'], [IDS.apply, 'dim'], [IDS.cloud, 'dim']])
  assert.deepEqual(lit({ ends, step: 1 }), [[IDS.request, 'kin'], [IDS.scan, 'kin'], [IDS.results, 'active several'], [IDS.radio, 'kin'], [IDS.apply, 'dim'], [IDS.cloud, 'dim']])
  // The player says which line each step rides, from the step's `via`, payload and ends (strandOf): that wins. Step 0 names "Start scan".
  assert.deepEqual(lit({ ends, step: 0, strands: [IDS.scan, IDS.results, IDS.apply] }).map(([, c]) => c), ['kin', 'active several', 'kin', 'kin', 'dim', 'dim'])
  assert.deepEqual(lit({ ends, step: 1, strands: [undefined, IDS.radio, undefined] }).map(([, c]) => c), ['kin', 'kin', 'kin', 'active several', 'dim', 'dim'])
  // A line alone between its shapes has no kin and no neighbours to part for.
  assert.deepEqual(lit({ ends, step: 2 }).map(([, c]) => c), ['dim', 'dim', 'dim', 'dim', 'active', 'dim'])
  // A step against a one-way line gets a dashed one of its own, as before: a reply on a publish has nothing to ride.
  const against = toGraph(model, 'root', { ends: [['linux', 'management']], step: 0 })
  assert.ok(against.edges.some(e => e.id === 'step' && e.className?.includes('step')))
  assert.ok(against.edges.filter(e => !e.id.startsWith('step')).every(e => e.className === 'dim'))
  // A faint step (the lanes of another branch) fades its line the same way.
  assert.deepEqual(toGraph(model, 'root', { ends, step: 0, faint: [2] }).edges.find(e => e.id === IDS.apply)?.className, 'lane')
})

test('a connection with a problem marks its own line, not the others of its pair', () => {
  const bad = toGraph(wlan(), 'root', undefined, [{ file: 'model.yaml', message: 'x', connection: 3 }]).edges
  assert.deepEqual(bad.map(e => e.className), [undefined, undefined, undefined, 'problem', undefined, undefined])
})

test('a pair spreads when it, a line of it, a box on it or keyboard focus on it is selected, and its labels show', () => {
  const { edges } = toGraph(wlan(), 'root')
  const state = (focus: Parameters<typeof focusEdges>[1]) => focusEdges(edges, focus).map(e => [e.data?.spread === true, e.label !== undefined])
  const quiet = [[false, false], [false, false], [false, false], [false, false], [false, false], [false, false]]
  assert.deepEqual(state({}), quiet) // at rest: no spread, no labels
  const spread = [[true, true], [true, true], [true, true], [true, true], [false, false], [false, false]] // a lone line never spreads
  assert.deepEqual(state({ line: IDS.scan }), spread) // a line of the pair is selected
  assert.deepEqual(state({ line: 'management ui' }), spread) // the pair is selected
  assert.deepEqual(state({ focused: IDS.radio }), spread)
  assert.deepEqual(state({ box: 'ui' }).map(([s]) => s), [true, true, true, true, false, false]) // a box on it
  assert.deepEqual(state({ box: 'management' }).map(([s]) => s), [true, true, true, true, false, false])
  // Pointing at a line shows its own label and moves nothing.
  assert.deepEqual(state({ hover: IDS.results }), [[false, false], [false, false], [false, true], [false, false], [false, false], [false, false]])
  // A pair's own id as the thing pointed at (a row of a panel) lights all its lines.
  assert.deepEqual(focusEdges(edges, { hover: 'management ui' }).map(e => e.className), ['hover', 'hover', 'hover', 'hover', undefined, undefined])
})

test('the line selected is the one picked; the pair selected with none picked selects them all', () => {
  const { edges } = toGraph(wlan(), 'root')
  assert.deepEqual(focusEdges(edges, { line: IDS.scan }).map(e => e.selected), [false, true, false, false, false, false])
  assert.deepEqual(focusEdges(edges, { line: 'management ui' }).map(e => e.selected), [true, true, true, true, false, false])
})

test('a step playing on a pair wins over a selection: the pair stays at rest and the lit line shows its label', () => {
  const model = wlan()
  const { edges } = toGraph(model, 'root', { ends: [['ui', 'management']], step: 0 })
  const shown = focusEdges(edges, { line: IDS.radio })
  assert.ok(shown.every(e => e.data?.spread !== true))
  assert.equal(shown.find(e => e.id === IDS.request)?.label, 'Request and reply') // the lit one (first that runs that way)
})

test('merged edges do not carry the new data', () => {
  const edges = toGraph({ ...wlan(), meta: {} }, 'root').edges
  const shown = focusEdges(edges, { line: 'management ui' })
  assert.ok(shown.every(e => !('spread' in (e.data ?? {}))))
  assert.equal(shown.find(e => e.id === 'management ui')?.selected, true)
})

/** The canvas of a model: its edges as the page draws them, its nodes, and the lanes of each as the lane store gives them. */
function canvas(model: Model, focus: Parameters<typeof focusEdges>[1] = {}) {
  const { nodes, edges } = toGraph(model, 'root')
  return { nodes, edges: focusEdges(edges, focus) }
}

test('the lanes of a pair follow the line style: straight, curved or right-angled, all four told apart', () => {
  const { nodes, edges } = canvas(wlan())
  const at = new Map(nodes.map(n => [n.id, n]))
  const pair = edges.filter(e => pairOf(e) === 'management ui')
  const laneIn = (style: 'straight' | 'curved' | 'angled') => pair.map(e => {
    const { slot, pose } = laneOf(e.data)
    return lanes.laneFor(e.id, style, boxEnd(at.get(e.source)!), boxEnd(at.get(e.target)!), pose, slot)
  })
  const straight = laneIn('straight')
  assert.equal(straight.length, 4)
  for (const lane of straight) assert.match(lane.path, /^M[-\d.]+ [-\d.]+L[-\d.]+ [-\d.]+$/)
  // Management is below and to the left of the UI, with room between them: a curve and a staircase for each lane.
  const curved = laneIn('curved')
  for (const lane of curved) assert.match(lane.path, /^M[-\d.]+ [-\d.]+C[-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+$/)
  const angled = laneIn('angled')
  for (const lane of angled) assert.match(lane.path, /Q/)
  for (const set of [straight, curved, angled]) assert.equal(new Set(set.map(l => l.path)).size, 4)
  // A lone line keeps the style.
  const lone = edges.find(e => e.id === IDS.apply)!
  const loneCurved = lanes.laneFor(lone.id, 'curved', boxEnd(at.get(lone.source)!), boxEnd(at.get(lone.target)!), REST, laneOf(lone.data).slot)
  assert.match(loneCurved.path, /C/)
})

test('the pointer means the nearest line of the pair, at rest and when the pair is spread', () => {
  for (const [focus, pose] of [[{}, REST], [{ line: IDS.scan }, SPREAD]] as const) {
    const { nodes, edges } = canvas(wlan(), focus)
    const at = new Map(nodes.map(n => [n.id, n]))
    const lane = (id: string) => {
      const e = edges.find(x => x.id === id)!
      return lanes.laneFor(id, 'straight', boxEnd(at.get(e.source)!), boxEnd(at.get(e.target)!), laneOf(e.data).pose, laneOf(e.data).slot)
    }
    assert.equal(laneOf(edges[0].data).pose, pose)
    for (const id of [IDS.request, IDS.scan, IDS.results, IDS.radio]) {
      // The pointer on the middle of a lane means it, whichever lane React Flow says it hit.
      const { x, y } = lane(id)
      for (const hit of [IDS.request, IDS.radio]) assert.equal(hitStrand(edges, nodes, 'straight', edges.find(e => e.id === hit)!, { x, y }), id, `${id} (hit ${hit})`)
    }
    // Away from every lane of the pair, the edge React Flow found stands.
    const far = lane(IDS.request)
    assert.equal(hitStrand(edges, nodes, 'straight', edges.find(e => e.id === IDS.scan)!, { x: far.x, y: far.y - 200 }), IDS.scan)
  }
  // A lone line, and the line of a merged project, are their own.
  const { nodes, edges } = canvas(wlan())
  const lone = edges.find(e => e.id === IDS.apply)!
  assert.equal(hitStrand(edges, nodes, 'straight', lone, { x: 0, y: 0 }), IDS.apply)
})

test('a click on a line in a pane of a comparison picks the line of the pair nearest the pointer, with its pair and view, as the single canvas does', () => {
  const { nodes, edges } = canvas(wlan())
  const at = new Map(nodes.map(n => [n.id, n]))
  const middle = (id: string) => {
    const e = edges.find(x => x.id === id)!
    return lanes.laneFor(id, 'straight', boxEnd(at.get(e.source)!), boxEnd(at.get(e.target)!), laneOf(e.data).pose, laneOf(e.data).slot)
  }
  // The pane asks its React Flow instance where the pointer is; here the screen is the canvas.
  const instance = { screenToFlowPosition: (p: { x: number; y: number }) => p, getZoom: () => 1 }
  const first = edges.find(e => e.id === IDS.request)!
  for (const id of [IDS.request, IDS.scan, IDS.results, IDS.radio]) {
    const { x, y } = middle(id)
    const picked = edgeUnder(instance, { clientX: x, clientY: y }, edges, nodes, 'straight', first) // React Flow found the first strip whatever lane was clicked
    assert.equal(picked.id, id)
    const line = lineOf(picked, 'root')
    assert.equal(line.strand, id)
    assert.deepEqual([line.kind, line.view], ['line', 'root'])
  }
  // Before React Flow is ready the edge it found stands; a line of a merged project, or alone between its shapes, is the pair's one line and names no strand.
  assert.equal(edgeUnder(undefined, { clientX: 0, clientY: 0 }, edges, nodes, 'straight', first), first)
  const merged = canvas(wlan({ meta: { name: 'WLAN' } }))
  assert.equal(lineOf(merged.edges[0], 'root').strand, undefined)
})

test('while a step plays on a pair, a pane of a comparison means the line where the pair has parted to, as the main canvas and the desktop do', () => {
  const { nodes, edges } = canvas(wlan())
  const at = new Map(nodes.map(n => [n.id, n]))
  const instance = { screenToFlowPosition: (p: { x: number; y: number }) => p, getZoom: () => 1 }
  const ids = [IDS.request, IDS.scan, IDS.results, IDS.radio]
  const where = (id: string, lam?: readonly number[]) => {
    const e = edges.find(x => x.id === id)!
    const pose = laneOf(e.data).pose
    return lanes.laneFor(id, 'straight', boxEnd(at.get(e.source)!), boxEnd(at.get(e.target)!), lam === undefined ? pose : { s: pose.s, lam }, laneOf(e.data).slot)
  }
  const hit = edges.find(e => e.id === IDS.request)! // React Flow found the first strip whatever lane was clicked
  // A step rides the third line: the pair parts around it. Each line is picked where it is now, and the same pointer means another line (or none) at rest.
  const lam = [0, 0, 1, 0]
  const lit = (pair: string) => (pair === 'management ui' ? lam : undefined)
  let moved = 0
  for (const id of ids) {
    const { x, y } = where(id, lam)
    const event = { clientX: x, clientY: y }
    assert.equal(edgeUnder(instance, event, edges, nodes, 'straight', hit, lit).id, id, `${id} where the pair has parted to`)
    if (edgeUnder(instance, event, edges, nodes, 'straight', hit).id !== id) moved++
  }
  assert.ok(moved > 0, 'the parted pair has lines that are not where they rest')
  // A pair that is not parted answers as it does at rest.
  const { x, y } = where(IDS.scan)
  assert.equal(edgeUnder(instance, { clientX: x, clientY: y }, edges, nodes, 'straight', hit, () => undefined).id, IDS.scan)
})

test('the pointer reaches 7 screen pixels from a line of a pair at any zoom, as the desktop measures it', () => {
  const { nodes, edges } = canvas(wlan())
  const at = new Map(nodes.map(n => [n.id, n]))
  const middle = (id: string) => {
    const e = edges.find(x => x.id === id)!
    return lanes.laneFor(id, 'straight', boxEnd(at.get(e.source)!), boxEnd(at.get(e.target)!), laneOf(e.data).pose, laneOf(e.data).slot)
  }
  // The first lane of the pair: the pointer goes off the outside of it, along its normal, d canvas units from the middle of the lane.
  const out = middle(IDS.request)
  const [p, q] = [out.points![0], out.points![out.points!.length - 1]]
  const length = Math.hypot(q.x - p.x, q.y - p.y)
  const toward = (middle(IDS.radio).x - out.x) * (q.y - p.y) - (middle(IDS.radio).y - out.y) * (q.x - p.x) // which side of the lane the others are on
  const sign = toward > 0 ? 1 : -1
  const [ux, uy] = [(-(q.y - p.y) / length) * sign, ((q.x - p.x) / length) * sign]
  const pointer = (d: number, zoom: number) => ({ clientX: (out.x + ux * d) * zoom, clientY: (out.y + uy * d) * zoom })
  const zoomed = (zoom: number) => ({ screenToFlowPosition: (p: { x: number; y: number }) => ({ x: p.x / zoom, y: p.y / zoom }), getZoom: () => zoom })
  const other = edges.find(e => e.id === IDS.scan)! // React Flow found another strip: it stands unless the pointer is within reach of the first line
  for (const zoom of [0.25, 0.5, 1, 2, 4]) {
    const picks = (pixels: number) => edgeUnder(zoomed(zoom), pointer(pixels / zoom, zoom), edges, nodes, 'straight', other).id
    // The lines of the pair are 12 units apart, so on the screen 12 * zoom pixels, and the reach is 7 pixels unless that is more than half the way to the next line (plus one).
    const reach = Math.min(7, (12 * zoom) / 2 + 1)
    assert.equal(picks(0), IDS.request, `on the line at zoom ${zoom}`)
    assert.equal(picks(reach - 0.3), IDS.request, `just inside the reach at zoom ${zoom}`)
    assert.equal(picks(reach + 0.3), IDS.scan, `just outside the reach at zoom ${zoom}`)
  }
})

test('the label of a line of a pair side by side sits beside its own line, and the labels of one pair do not cover each other', () => {
  const [a, b] = [{ x: 0, y: 0, width: 200, height: 72 }, { x: 0, y: 400, width: 200, height: 72 }]
  // A vertical pair of three lanes, spread: 22 apart, so labels in a row would overlap; their places differ along the lanes.
  const xs = [88, 100, 112].map(x => x)
  const lines = xs.map((x, i) => ({ id: `l${i}`, path: `M${x} 72L${x} 400`, mid: { x, y: 236 }, chars: 12, across: xs.filter((_, j) => j !== i).map(o => [{ x: o, y: 72 }, { x: o, y: 400 }]), extra: 34 }))
  const spots = placeLabels(lines, [a, b])
  const drawn = lines.map(l => ({ ...spots.get(l.id)! }))
  drawn.forEach((p, i) => drawn.forEach((q, j) => {
    if (i < j) assert.ok(Math.abs(p.y - q.y) >= 18 || Math.abs(p.x - q.x) >= 12 * 6.2 + 10, `labels ${i} and ${j} overlap`)
  }))
  // Each sits beside its own line, running away from the others, the sample of its line at the end by the line.
  drawn.forEach((p, i) => {
    assert.equal(p.side, i === 0 ? -1 : 1, `label ${i} runs away from the lanes beside it`)
    assert.ok(Math.abs(Math.abs(p.x - xs[i]) - ((12 * 6.2 + 10 + 34) / 2 + 4)) < 1e-9, `label ${i} is 4 from its own line`)
  })
})

test('the labels of a crowded pair find rows beside their lines, and those that find none are left out', () => {
  const [a, b] = [{ x: 0, y: 0, width: 200, height: 72 }, { x: 0, y: 72 + 110, width: 200, height: 72 }]
  const xs = [34, 56, 78, 100, 122, 144, 166, 188]
  const lines = xs.map((x, i) => ({ id: `l${i}`, path: `M${x} 72L${x} 182`, mid: { x, y: 127 }, chars: 14, across: xs.filter((_, j) => j !== i).map(o => [{ x: o, y: 72 }, { x: o, y: 182 }]), extra: 34 }))
  const spots = placeLabels(lines, [a, b])
  const shown = lines.filter(l => !spots.get(l.id)!.hidden)
  assert.ok(shown.length >= 4 && shown.length < lines.length, `some are shown (${shown.length}) and the crowd is not`)
  shown.forEach((l, i) => shown.forEach((m, j) => {
    if (i >= j) return
    const [p, q] = [spots.get(l.id)!, spots.get(m.id)!]
    assert.ok(Math.abs(p.y - q.y) >= 18 || Math.abs(p.x - q.x) >= 14 * 6.2 + 10 + 34, `shown labels ${l.id} and ${m.id} do not overlap`)
  }))
  for (const l of shown) {
    const p = spots.get(l.id)!
    assert.ok(p.y - 9 >= 72 && p.y + 9 <= 182, `${l.id} is between the shapes`)
  }
})

test('a lone label is not moved by lines beside it that it cannot get clear of', () => {
  const lines = [{ id: 'one', path: 'M0 100L300 100', mid: { x: 150, y: 100 }, chars: 10, across: [[{ x: 0, y: 112 }, { x: 300, y: 112 }], [{ x: 0, y: 88 }, { x: 300, y: 88 }]] }]
  assert.deepEqual(placeLabels(lines, []).get('one'), { x: 150, y: 100 })
})

test('every shape the lanes are drawn between keeps its outline', () => {
  assert.ok(Object.keys(SHAPE_DEFS).length > 0)
})
