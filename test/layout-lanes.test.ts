import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BOX, laneCounts, placeCached, spotsOf, tangle, viewSpots } from '../src/core/layout.ts'
import { MOST, PITCH } from '../src/core/lanes.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Model } from '../src/core/model.ts'
import { computeView } from '../src/core/views.ts'

// The layout knows a bundle: where a project draws a line for each connection, a pair of several lines crosses and runs through boxes as wide as its lanes are spread.

const at = (...spots: [string, number, number][]) => new Map(spots.map(([id, x, y]) => [id, { x, y }]))

test('a crossing of two bundles counts every lane of one over every lane of the other, N times M', () => {
  // a-b runs across the picture, c-d crosses it.
  const spots = at(['a', 0, 0], ['b', 600, 0], ['c', 300, -300], ['d', 300, 300])
  const lines = (n: number, m: number) => [{ from: 'a', to: 'b', lanes: n }, { from: 'c', to: 'd', lanes: m }]
  assert.equal(tangle(spots, [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]), 1)
  assert.equal(tangle(spots, lines(1, 1)), 1)
  assert.equal(tangle(spots, lines(3, 2)), 6)
  assert.equal(tangle(spots, lines(4, 1)), 4)
  assert.equal(tangle(spots, lines(1, 5)), 5)
  assert.equal(tangle(spots, lines(8, 8)), 64)
  // Lines that share a box never cross, whatever their lanes.
  assert.equal(tangle(spots, [{ from: 'a', to: 'b', lanes: 5 }, { from: 'a', to: 'c', lanes: 5 }]), 0)
})

test('a bundle runs through a box sooner than a single line: its box is widened by half the span of its lanes plus 6', () => {
  // a and b are 1000 apart on the row y = 0, so the line between their centres is y = 36. c sits so that its box, shrunk by the usual 4 px, begins 10 px under the line.
  const line = (lanes?: number) => [{ from: 'a', to: 'b', ...(lanes === undefined ? {} : { lanes }) }]
  const under = (y: number) => at(['a', -500, 0], ['b', 500, 0], ['c', 0, y])
  assert.equal(tangle(under(42), line()), 0)
  assert.equal(tangle(under(42), line(1)), 0)
  // The reach is (lanes - 1) * 12 / 2 + 6: 12 for 2 lanes, 18 for 3, 24 for 4. A box 10 under the line is met from 2 lanes.
  assert.deepEqual([1, 2, 3, 4].map(n => tangle(under(42), line(n))), [0, 1, 1, 1])
  // A box 15 under the line is met from 3 lanes, not by 2.
  assert.deepEqual([1, 2, 3, 4].map(n => tangle(under(47), line(n))), [0, 0, 1, 1])
  assert.equal(PITCH, 12)
  // A box above the line is met the same way: its shrunk bottom is 10 (or 15) above it.
  assert.deepEqual([1, 2, 3, 4].map(n => tangle(under(-42), line(n))), [0, 1, 1, 1])
  assert.deepEqual([1, 2, 3, 4].map(n => tangle(under(-47), line(n))), [0, 0, 1, 1])
  // A box well clear is never met, and the ends of the line are not boxes it runs through.
  assert.deepEqual([1, 4, 8].map(n => tangle(under(300), line(n))), [0, 0, 0])
})

test('moved boxes: the change a move makes is the same counted whole or only for the boxes that moved, with lanes', () => {
  const edges = [{ from: 'a', to: 'b', lanes: 3 }, { from: 'c', to: 'd', lanes: 2 }, { from: 'a', to: 'd' }]
  const before = at(['a', 0, 0], ['b', 600, 0], ['c', 300, -300], ['d', 300, 300])
  const after = at(['a', 0, 0], ['b', 600, 0], ['c', 300, 100], ['d', 300, 400])
  const moved = new Set(['c', 'd'])
  assert.equal(tangle(after, edges) - tangle(before, edges), tangle(after, edges, moved) - tangle(before, edges, moved))
})

/** `n` connections from `a` to `b`, `m` from `b` to `c`, and one from `c` to `d`, in a project that draws a line for each. */
function chain(n: number, m: number, pairs = 'separate'): Model {
  const lines = (from: string, to: string, count: number): Connection[] => Array.from({ length: count }, (_, i) => ({ from, to, label: `${from}${to}${i + 1}` }))
  return {
    ...emptyModel(), meta: { pairs }, objects: Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id, { type: 'system' as const, name: id }])),
    connections: [...lines('a', 'b', n), ...lines('b', 'c', m), ...lines('c', 'd', 1)],
  }
}

test('the lanes of a pair for the layout: its strands, no more than the most a pair draws; a lone line and a merged view have none', () => {
  assert.deepEqual([...laneCounts(computeView(chain(3, 1), 'root'))], [['a b', 3]])
  assert.deepEqual([...laneCounts(computeView(chain(12, 8), 'root'))], [['a b', MOST], ['b c', MOST]])
  assert.deepEqual([...laneCounts(computeView(chain(1, 1), 'root'))], [])
  assert.deepEqual([...laneCounts(computeView(chain(5, 5, 'merged'), 'root'))], [])
  assert.deepEqual([...laneCounts(computeView(chain(2, 2), 'root'))], [['a b', 2], ['b c', 2]])
})

test('a view that draws one line for each pair is placed as it always was; lanes only change the placement of a project that draws a line for each connection', () => {
  const merged = chain(4, 4, 'merged')
  const view = computeView(merged, 'root')
  const boxes = [...view.members, ...view.outsiders]
  const withoutLanes = placeCached(view.members, [], view.edges)
  assert.deepEqual([...spotsOf(merged, 'root', view, boxes)].map(([id, p]) => [id, p.x, p.y]), boxes.map(id => [id, withoutLanes.get(id)!.x, withoutLanes.get(id)!.y]))
  // A project with lines apart is placed in a way that does not depend on the call: the same weights give the same spots.
  const apart = chain(4, 4)
  const first = [...viewSpots(apart, 'root')]
  assert.deepEqual([...viewSpots(apart, 'root')], first)
  assert.equal(first.length, 4)
  // Boxes keep to the BOX grid: none overlap.
  for (const [i, [, p]] of first.entries()) for (const [, q] of first.slice(i + 1)) assert.ok(Math.abs(p.x - q.x) >= BOX.width || Math.abs(p.y - q.y) >= BOX.height)
})

test('placeCached keys the weights: the same boxes and lines with other lanes are placed again', () => {
  const edges = computeView(chain(2, 2, 'merged'), 'root').edges
  const members = ['a', 'b', 'c', 'd']
  const one = placeCached(members, [], edges, new Map(), new Map([['a b', 3]]))
  const two = placeCached(members, [], edges, new Map(), new Map([['a b', 3]]))
  assert.equal(one, two) // cached
  const other = placeCached(members, [], edges, new Map(), new Map([['a b', 4]]))
  assert.notEqual(other, one)
})

test('the weights reach the placement: of a few seeded views of six systems, some are placed differently once their pairs draw lines apart', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f']
  let seed = 7
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let differing = 0
  for (let round = 0; round < 12; round++) {
    const connections: Connection[] = []
    for (let i = 0, n = 5 + Math.floor(next() * 6); i < n; i++) {
      const [from, to] = [ids[Math.floor(next() * 6)], ids[Math.floor(next() * 6)]]
      if (from === to) continue
      for (let k = 0, count = 1 + Math.floor(next() * 6); k < count; k++) connections.push({ from, to, label: `${from}${to}${k}` })
    }
    const apart: Model = { ...emptyModel(), meta: { pairs: 'separate' }, objects: Object.fromEntries(ids.map(id => [id, { type: 'system' as const, name: id }])), connections }
    const merged: Model = { ...apart, meta: {} }
    if (JSON.stringify([...viewSpots(apart, 'root')]) !== JSON.stringify([...viewSpots(merged, 'root')])) differing++
  }
  assert.ok(differing > 0, 'a project that draws lines apart is placed as the lines it draws')
})
