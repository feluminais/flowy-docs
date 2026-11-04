import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { toGraph } from '../ui/src/graph.ts'
import type { BoxNode } from '../ui/src/graph.ts'
import { boxEnd, laneOf } from '../ui/src/lanehit.ts'
import { SAMPLE } from '../ui/src/labels.ts'
import { labelSpots } from '../ui/src/labelspots.ts'
import { labelGap } from './label-gap.ts'
import { lanes } from '../ui/src/lanes.ts'

// Where the labels go on a pair of lines side by side whose lines part around the lit ones while a flow plays (parts.ts). The line is drawn at the parted pose, so its label has to be placed
// from the same pose: the desktop lays its labels out from the lines as they are drawn, and the browser must put them in the same places.

const model: Model = {
  ...emptyModel(),
  meta: { pairs: 'separate' },
  objects: { a: { type: 'system', name: 'A' }, b: { type: 'system', name: 'B' } },
  connections: [0, 1, 2, 3].map(i => ({ from: 'a', to: 'b', label: `Line ${i}` })),
}

const PAIR = 'a b'

function drawn() {
  const { nodes, edges } = toGraph(model, 'root')
  // Two boxes a good way apart, each as the browser measured it.
  const placed: BoxNode[] = nodes.map((n, i) => ({ ...n, position: { x: 0, y: i * 400 }, measured: { width: 200, height: 72 } }))
  return { nodes: placed, edges }
}

const at = (nodes: BoxNode[], id: string) => nodes.find(n => n.id === id)!

test('a lit line that has another lit line beside it is labelled beside the line as the pair has parted it, not where it rested', () => {
  const { nodes, edges } = drawn()
  assert.equal(edges.length, 4)
  const lit = [1, 0, 0, 1]
  const asLit = edges.map(e => (e.data?.slot as { lane: number }).lane === 0 || (e.data?.slot as { lane: number }).lane === 3 ? { ...e, className: 'active' } : e)
  const rest = labelSpots('straight', asLit, nodes)
  const parted = labelSpots('straight', asLit, nodes, pair => (pair === PAIR ? lit : undefined))
  for (const e of asLit.filter(e => e.className === 'active')) {
    const { slot } = laneOf(e.data)
    const line = lanes.laneFor(e.id, 'straight', boxEnd(at(nodes, e.source)), boxEnd(at(nodes, e.target)), { s: 0, lam: lit }, slot)
    const gap = labelGap(parted.get(e.id)!, 'Line 0'.length, SAMPLE, line.points!)
    assert.ok(gap > 0 && gap <= 8, `lane ${slot!.lane}: a lit label sits beside its parted line, not on it (${gap} away)`)
    assert.notDeepEqual(parted.get(e.id), rest.get(e.id), `lane ${slot!.lane}: the pair has moved it`)
  }
})

test('every label of a parted pair is on or beside its own line as the line is drawn now, the lines beside the lit ones included', () => {
  const { nodes, edges } = drawn()
  const lit = [1, 0, 0, 1]
  const asLit = edges.map(e => ((e.data?.slot as { lane: number }).lane === 0 || (e.data?.slot as { lane: number }).lane === 3 ? { ...e, className: 'active' } : e))
  const parted = labelSpots('straight', asLit, nodes, pair => (pair === PAIR ? lit : undefined))
  const rest = labelSpots('straight', asLit, nodes)
  let moved = 0
  for (const e of asLit) {
    const { slot } = laneOf(e.data)
    const line = lanes.laneFor(e.id, 'straight', boxEnd(at(nodes, e.source)), boxEnd(at(nodes, e.target)), { s: 0, lam: lit }, slot)
    assert.ok(labelGap(parted.get(e.id)!, 'Line 0'.length, SAMPLE, line.points!) <= 8, `lane ${slot!.lane}: the label is by its line at the parted pose`)
    if (parted.get(e.id)!.x !== rest.get(e.id)!.x || parted.get(e.id)!.y !== rest.get(e.id)!.y) moved++ // the label of a line that parted has moved with it
  }
  assert.ok(moved > 0, 'the labels moved with their lines')
})

test('with no lit lanes, or a pair nothing is lit on, the labels are where they have always been', () => {
  const { nodes, edges } = drawn()
  const rest = labelSpots('straight', edges, nodes)
  assert.deepEqual(labelSpots('straight', edges, nodes, () => undefined), rest)
  assert.deepEqual(labelSpots('straight', edges, nodes, pair => (pair === 'other pair' ? [1, 0] : undefined)), rest)
})

test('a single lit lane keeps its place and its label, and the lines beside it part, labels and all', () => {
  const { nodes, edges } = drawn()
  const lit = [0, 1, 0, 0]
  const asLit = edges.map(e => ((e.data?.slot as { lane: number }).lane === 1 ? { ...e, className: 'active' } : e))
  const rest = labelSpots('straight', asLit, nodes)
  const parted = labelSpots('straight', asLit, nodes, pair => (pair === PAIR ? lit : undefined))
  const one = asLit.find(e => e.className === 'active')!
  assert.deepEqual(parted.get(one.id), rest.get(one.id))
  for (const e of asLit) {
    const line = lanes.laneFor(e.id, 'straight', boxEnd(at(nodes, e.source)), boxEnd(at(nodes, e.target)), { s: 0, lam: lit }, laneOf(e.data).slot)
    assert.ok(labelGap(parted.get(e.id)!, 'Line 0'.length, SAMPLE, line.points!) <= 8, `${e.id}: the label is by its line`)
  }
})
