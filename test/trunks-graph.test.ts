import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Edge } from '@xyflow/react'
import { HIT_WIDTH } from '../src/core/lanes.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Model } from '../src/core/model.ts'
import { TRUNK_MARK } from '../src/core/trunks.ts'
import type { Trunk } from '../src/core/views.ts'
import { focusEdges, inTrunk, toGraph } from '../ui/src/graph.ts'
import { pickedStrand, lineOf } from '../ui/src/lanehit.ts'
import { kindsOnScreen } from '../ui/src/kindkey.ts'
import { createLaneStore } from '../ui/src/lanes.ts'
import type { LaneEnd } from '../ui/src/lanes.ts'

// Many lines between two shapes on the canvas: a pair with more lines than fit across its shapes draws a trunk, the trunk opens while its pair is selected, and a step that rides one
// of its lines lights the trunk.

const TRUNK = `a b|a>b|${TRUNK_MARK}`
const line = (i: number) => `a b|a>b|Line ${i}`

/** `n` connections from `a` to `b`, all of a kind if `kind` is given, in a project that draws a line for each, `b` at (x, y), with another system `c` beside `b`. */
function model(n: number, [x, y]: [number, number] = [0, 300], extra: Partial<Model> = {}): Model {
  const connections: Connection[] = Array.from({ length: n }, (_, i) => ({ from: 'a', to: 'b', label: `Line ${i + 1}` }))
  return {
    ...emptyModel(), meta: { pairs: 'separate' }, objects: { a: { type: 'system', name: 'A' }, b: { type: 'system', name: 'B' }, c: { type: 'system', name: 'C' } },
    connections: [...connections, { from: 'b', to: 'c', label: 'Other' }], layout: { root: { a: [0, 0], b: [x, y], c: [x + 600, y] } },
    flows: { f: { name: 'F', view: 'root', steps: [{ from: 'a', to: 'b', text: 'Asks', via: 'Line 4' }, { from: 'b', to: 'c', text: 'Goes on' }] } },
    ...extra,
  }
}
/** A box 200 by 72 at (x, y), as the end of a lane. */
const endOfBox = (id: string, x: number, y: number): LaneEnd => ({ id, rect: { x, y, width: 200, height: 72 }, edge: [] })
const byId = (edges: Edge[]) => Object.fromEntries(edges.map(e => [e.id, e]))

test('a pair with more lines than fit draws a trunk: one lane that stands for them, with the number of connections and the ids of its lines', () => {
  const { edges } = toGraph(model(10), 'root')
  assert.deepEqual(edges.map(e => e.id), [TRUNK, 'b c|b>c|Other'])
  const trunk = edges[0]
  assert.deepEqual(trunk.data?.trunk, { size: 10, members: Array.from({ length: 10 }, (_, i) => line(i + 1)) })
  assert.deepEqual([trunk.data?.pair, trunk.data?.lanes, trunk.data?.slot], ['a b', 1, { lane: 0, lanes: 1, back: 0, stack: [0] }])
  assert.equal(trunk.label, '10 connections')
  assert.equal(trunk.ariaLabel, 'from A to B, 10 connections')
  assert.equal(trunk.interactionWidth, undefined) // one lane alone keeps React Flow's strip
  assert.equal(trunk.className, undefined)
  assert.equal(edges[1].data?.trunk, undefined)
})

test('a trunk of lines of one kind says which', () => {
  const kinded = model(10)
  kinded.connections = kinded.connections.map(c => (c.from === 'a' ? { ...c, kind: 'stream' as const } : c))
  const [trunk] = toGraph(kinded, 'root').edges
  assert.equal(trunk.label, 'Request then stream x10')
  assert.equal(trunk.ariaLabel, 'from A to B, 10 connections, Request then stream')
  assert.equal(trunk.id, `a b|a>b|${TRUNK_MARK}stream`)
  assert.equal((trunk.data?.look as { tail: string }).tail, 'double')
})

test('the lines of a pair that fit are drawn one each, as before', () => {
  const { edges } = toGraph(model(8), 'root')
  assert.deepEqual(edges.map(e => e.id).slice(0, 8), Array.from({ length: 8 }, (_, i) => line(i + 1)))
  assert.ok(edges.slice(0, 8).every(e => e.data?.trunk === undefined && e.data?.lanes === 8 && e.interactionWidth === HIT_WIDTH))
  assert.deepEqual(edges[7].data?.slot, { lane: 7, lanes: 8, back: 0 })
})

test('where the shapes meet decides: beside each other the sides are short and a pair folds from the sixth line, above each other from the ninth', () => {
  assert.equal(toGraph(model(5, [400, 0]), 'root').edges.length, 5 + 1)
  assert.equal(toGraph(model(6, [400, 0]), 'root').edges.length, 1 + 1)
  assert.equal(toGraph(model(8, [0, 300]), 'root').edges.length, 8 + 1)
  assert.equal(toGraph(model(9, [0, 300]), 'root').edges.length, 1 + 1)
  // The line style the reader draws in is part of it: curved and angled lanes meet the short sides.
  for (const style of ['curved', 'angled'] as const) {
    assert.equal(toGraph(model(6, [400, 0]), 'root', undefined, [], {}, { style }).edges.length, 1 + 1, style)
    assert.equal(toGraph(model(5, [400, 0]), 'root', undefined, [], {}, { style }).edges.length, 5 + 1, style)
  }
})

test('a selected pair opens its trunks into the lines they stand for, which fan out of the trunk\'s lane', () => {
  for (const opened of ['a b', line(7), TRUNK]) {
    const { edges } = toGraph(model(10), 'root', undefined, [], {}, { opened })
    // A line selected or the pair selected opens it; the trunk's own id is not an id a panel names, so it opens nothing.
    const isOpen = edges.length === 11
    assert.equal(isOpen, opened !== TRUNK, opened)
    if (!isOpen) continue
    assert.deepEqual(edges.map(e => e.id).slice(0, 10), Array.from({ length: 10 }, (_, i) => line(i + 1)))
    assert.ok(edges.slice(0, 10).every(e => e.data?.trunk === undefined && e.data?.lanes === 10 && e.interactionWidth === HIT_WIDTH))
    assert.deepEqual(edges.slice(0, 10).map(e => (e.data?.slot as { within?: number }).within), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    assert.deepEqual(edges[3].data?.slot, { lane: 0, lanes: 1, back: 0, stack: [0], fan: [10], within: 3 })
    assert.equal(edges[3].ariaLabel, '4 of 10, from A to B, Line 4')
    assert.equal(edges[3].label, 'Line 4')
  }
  // The pair's trunk shuts again when nothing is selected, or something else is.
  assert.equal(toGraph(model(10), 'root', undefined, [], {}, { opened: undefined }).edges.length, 2)
  assert.equal(toGraph(model(10), 'root', undefined, [], {}, { opened: 'b c|b>c|Other' }).edges.length, 2)
  assert.equal(toGraph(model(10), 'root', undefined, [], {}, { opened: 'nowhere' }).edges.length, 2)
})

test('a trunk of more lines than a pair can show stays shut when its pair is selected', () => {
  assert.equal(toGraph(model(12, [0, 300]), 'root', undefined, [], {}, { opened: 'a b' }).edges.length, 12 + 1)
  assert.equal(toGraph(model(13, [0, 300]), 'root', undefined, [], {}, { opened: 'a b' }).edges.length, 1 + 1)
})

test('a step that rides a line in a trunk lights the trunk; the pair is not opened under it', () => {
  const m = model(10)
  const ends: [string, string][] = [['a', 'b'], ['b', 'c']]
  // The player says which line the step rides (its via is "Line 4"): the trunk it is in.
  for (const strands of [undefined, [line(4), 'b c|b>c|Other'], [TRUNK, 'b c|b>c|Other']]) {
    const lit = byId(toGraph(m, 'root', { ends, step: 0, ...(strands ? { strands } : {}) }, [], {}, { opened: 'a b' }).edges)
    assert.deepEqual(Object.keys(lit), [TRUNK, 'b c|b>c|Other'], 'a step playing on a pair wins over its selection')
    assert.equal(lit[TRUNK].className, 'active') // a trunk is a lane alone in its pair: no kin to part for
    assert.equal(lit[TRUNK].zIndex, 1)
    assert.equal(lit['b c|b>c|Other'].className, 'dim')
  }
  // A trunk of another pair lit: this pair's is dim.
  const other = byId(toGraph(m, 'root', { ends, step: 1 }).edges)
  assert.equal(other[TRUNK].className, 'dim')
  assert.equal(other['b c|b>c|Other'].className, 'active')
  // A faint step (the lanes of another branch) fades the trunk the same way.
  assert.equal(byId(toGraph(m, 'root', { ends, step: 1, faint: [0] }).edges)[TRUNK].className, 'lane')
})

test('a trunk beside another lane: the step that rides it parts the others, and the others are its kin', () => {
  // Nine lines one way and one the other: two lanes, the nine folded.
  const m = model(9)
  m.connections.push({ from: 'b', to: 'a', label: 'Back' })
  const { edges } = toGraph(m, 'root', { ends: [['a', 'b']], step: 0, strands: [line(2)] })
  const lit = byId(edges)
  const trunk = Object.keys(lit).find(id => id.includes(TRUNK_MARK))!
  assert.equal(lit[trunk].className, 'active several')
  assert.equal(lit['a b|b>a|Back'].className, 'kin')
  assert.deepEqual([lit[trunk].data?.lanes, lit['a b|b>a|Back'].data?.lanes], [2, 2])
})

test('a trunk is pointed at and selected by any of its lines, and a pair\'s selection reaches it', () => {
  const { edges } = toGraph(model(10), 'root')
  const trunk = edges[0]
  assert.equal(inTrunk(trunk, line(3)), true)
  assert.equal(inTrunk(trunk, line(11)), false)
  assert.equal(inTrunk(trunk, undefined), false)
  assert.equal(inTrunk(edges[1], line(3)), false)
  const states = (focus: Parameters<typeof focusEdges>[1]) => focusEdges(edges, focus).map(e => [e.selected, e.className, e.label])
  assert.deepEqual(states({ hover: line(3) })[0], [false, 'hover', '10 connections'])
  assert.deepEqual(states({ line: line(3) })[0], [true, undefined, '10 connections'])
  assert.deepEqual(states({ line: 'a b' })[0], [true, undefined, '10 connections'])
  assert.deepEqual(states({})[0], [false, undefined, undefined])
  assert.deepEqual(states({ hover: line(30) })[0], [false, undefined, undefined])
  // The pair of a line a trunk holds is the trunk's pair: a box on it, or the line, spreads nothing (a lane alone) but a lane beside it spreads with it.
  assert.equal(focusEdges(edges, { line: line(3) })[1].selected, false)
})

test('a click on a trunk picks its first line, which opens the pair and shows that connection in the panel', () => {
  const { edges } = toGraph(model(10), 'root')
  assert.equal(pickedStrand(edges[0]), line(1))
  assert.equal(pickedStrand(edges[1]), 'b c|b>c|Other')
  assert.deepEqual(lineOf(edges[0], 'root'), { kind: 'line', from: 'a', to: 'b', view: 'root', strand: line(1) })
  // That line is then an edge: the pair is open, and the line picked is the one selected.
  const opened = toGraph(model(10), 'root', undefined, [], {}, { opened: line(1) }).edges
  assert.equal(focusEdges(opened, { line: line(1) }).filter(e => e.selected).map(e => e.id).join(), line(1))
})

test('the key shows "Stacked lines" while a trunk is on screen and "In use" while a step plays on one of several lanes', () => {
  const { edges } = toGraph(model(10), 'root')
  assert.deepEqual(kindsOnScreen(edges), { kinds: [], plain: true, stacked: true, inUse: false })
  assert.deepEqual(kindsOnScreen(toGraph(model(10), 'root', undefined, [], {}, { opened: 'a b' }).edges).stacked, false)
  assert.deepEqual(kindsOnScreen(toGraph(model(4), 'root').edges), { kinds: [], plain: true, stacked: false, inUse: false })
  // A step on a trunk alone in its pair is a lone lit line: nothing is in use among others.
  const lonely = toGraph(model(10), 'root', { ends: [['a', 'b']], step: 0 }).edges
  assert.deepEqual(kindsOnScreen(lonely), { kinds: [], plain: true, stacked: true, inUse: false })
  // A step on one of four lanes of a pair is.
  const four = toGraph(model(4), 'root', { ends: [['a', 'b']], step: 0, strands: [line(2)] }).edges
  assert.deepEqual(kindsOnScreen(four), { kinds: [], plain: true, stacked: false, inUse: true })
  // A trunk beside a lane that a step rides: both.
  const m = model(9)
  m.connections.push({ from: 'b', to: 'a', label: 'Back' })
  assert.deepEqual(kindsOnScreen(toGraph(m, 'root', { ends: [['b', 'a']], step: 0, strands: ['a b|b>a|Back'] }).edges), { kinds: [], plain: true, stacked: true, inUse: true })
  // A line a step added is not a connection.
  assert.deepEqual(kindsOnScreen([{ id: 'step', className: 'step active', data: { lanes: 3 } }]), { kinds: [], plain: false, stacked: false, inUse: false })
})

test('the lane store draws a trunk as the lone line of a lone lane, and an open trunk\'s lines as a fan, each from its own slot', () => {
  const store = createLaneStore()
  const closed = toGraph(model(10), 'root').edges[0]
  const [a, b] = [endOfBox('a', 0, 0), endOfBox('b', 0, 300)]
  const lane = store.laneFor(closed.id, 'straight', a, b, undefined, closed.data?.slot as never)
  assert.equal(lane.path, store.laneFor('lone', 'straight', a, b).path) // a straight line between the facing sides, the way a lone line goes
  assert.equal(lane.points, undefined) // a lone lane has no points
  const open = toGraph(model(10), 'root', undefined, [], {}, { opened: 'a b' }).edges.slice(0, 10)
  const lanes = open.map(e => store.laneFor(e.id, 'straight', a, b, undefined, e.data?.slot as never))
  assert.ok(lanes.every(l => l.points !== undefined && l.points.length === 25))
  // All start and end where the trunk did; the middles are 12 apart.
  const mids = lanes.map(l => ({ x: l.x, y: l.y }))
  for (let i = 1; i < mids.length; i++) assert.ok(Math.abs(Math.abs(mids[i].x - mids[i - 1].x) - 12) < 0.01, `${mids[i].x} ${mids[i - 1].x}`)
  assert.ok(Math.abs((mids[0].x + mids[9].x) / 2 - (lane.x)) < 0.01)
})

test('the pair-level lines are untouched: one edge of the view for the pair, whatever the trunks', () => {
  const trunk = ((toGraph(model(10), 'root').edges[0].data?.trunk) as Trunk).size
  assert.equal(trunk, 10)
})
