import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { KIND_IDS } from '../src/core/kinds.ts'
import type { KindId } from '../src/core/kinds.ts'
import {
  bulge, displacement, FOLD_FROM, GUTTER, HAIRLINE_GAP, isLaned, laneCapacity, laneGeometry, LANE_KEY, MOST, offsetOf, offsetsOf, OPEN_MOST, PITCH, pitchFor, REST, round3, slotsOf, stackStep, TRUNK_EXTRA, usableOf,
} from '../src/core/lanes.ts'
import type { LaneBox, Slot } from '../src/core/lanes.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Model } from '../src/core/model.ts'
import { drawnStrandOf, drawnView, foldPair, foldStrands, openTrunks, pairsOpenedBy, TRUNK_MARK, trunkId, trunkLabel } from '../src/core/trunks.ts'
import { computeView, lineKey } from '../src/core/views.ts'
import type { Strand } from '../src/core/views.ts'

// Many lines between two shapes: how many lanes a pair draws (CAP), when and how the rest fold into trunks, how a trunk opens, and the room a trunk takes.

/** A box 200 by 72 whose centre is (cx, cy). */
const box = (id: string, cx: number, cy: number): LaneBox => ({ id, rect: { x: cx - 100, y: cy - 36, width: 200, height: 72 }, edge: [] })

/** The strands of the pair a < b the way computeView makes them: first the ones that run from b to a, then the others, each in the order given. */
function pair(specs: { way: 'back' | 'ahead'; kind?: KindId; label?: string; connections?: number }[]): Strand[] {
  const back = specs.filter(s => s.way === 'back')
  const ahead = specs.filter(s => s.way === 'ahead')
  let next = 0
  return [...back, ...ahead].map((s, lane, all) => {
    const [from, to] = s.way === 'back' ? ['b', 'a'] : ['a', 'b']
    const label = s.label ?? `${s.way} ${lane}`
    const connections = Array.from({ length: s.connections ?? 1 }, () => next++)
    return { id: `a b|${from}>${to}|${label}`, pair: 'a b', from, to, label, connections, lane, lanes: all.length, ...(s.kind === undefined ? {} : { kind: s.kind }) }
  })
}
const many = (n: number, way: 'back' | 'ahead', kind?: KindId) => Array.from({ length: n }, () => ({ way, ...(kind === undefined ? {} : { kind }) }))
const ids = (strands: readonly Strand[]) => strands.map(s => s.id)

test('CAP: the lanes that fit across a pair, with the room each trunk takes (6 px) and the gutter between the two ways', () => {
  assert.equal(TRUNK_EXTRA, 6)
  assert.equal(MOST, 8)
  // min(8, floor((usable - G - 6 * trunks) / 12) + 1); usable = 2 * (half - 10)
  assert.equal(usableOf(36), 52)
  const table: [half: number, bothWays: boolean, trunks: number, fit: number][] = [
    [36, false, 0, 5], [36, true, 0, 4], [36, false, 1, 4], [36, false, 2, 4], [36, false, 3, 3], [36, true, 1, 4], [36, true, 2, 3], [36, true, 3, 3],
    [100, false, 0, 8], [100, true, 0, 8], [100, false, 2, 8], [100, true, 4, 8], [140, false, 6, 8],
    [20, false, 0, 2], [20, false, 1, 2], [20, false, 2, 1], [10, false, 0, 1], [10, true, 2, 1],
  ]
  for (const [half, both, trunks, fit] of table) {
    assert.equal(laneCapacity(half, both, trunks), fit, `half ${half}, ${both ? 'both ways' : 'one way'}, ${trunks} trunks`)
    assert.equal(laneCapacity(half, both, trunks), Math.max(1, Math.min(8, Math.floor((usableOf(half) - (both ? GUTTER : 0) - TRUNK_EXTRA * trunks) / PITCH) + 1)))
  }
  assert.equal(laneCapacity(36, false), laneCapacity(36, false, 0)) // trunks default to none
})

test('CAP: a pair of up to three lines is never folded, since three lanes need 30 px and every shape has that much room', () => {
  assert.equal(FOLD_FROM, 4)
  assert.ok(laneCapacity(25, true) >= 3)
  assert.ok(laneCapacity(25, false) >= 3)
  // foldStrands does not even ask for the room of a pair of fewer than FOLD_FROM strands.
  const asked: string[] = []
  const folded = foldStrands(pair(many(3, 'ahead')), (from, to) => {
    asked.push(`${from}${to}`)
    return 36
  })!
  assert.deepEqual(asked, [])
  assert.equal(folded.strands.length, 3)
  assert.equal(foldStrands(pair(many(FOLD_FROM, 'ahead')), () => 36)!.strands.length, FOLD_FROM) // four fit one way across 36
  const askedLater: string[] = []
  foldStrands(pair(many(FOLD_FROM + 2, 'ahead')), (from, to) => {
    askedLater.push(`${from}${to}`)
    return 36
  })
  assert.deepEqual(askedLater, ['ab'])
  assert.equal(foldStrands(undefined, () => 36), undefined) // a view that draws one line for each pair has no strands
})

test('folding: lines that fit across the shapes are drawn as they are', () => {
  const strands = pair(many(5, 'ahead'))
  const same = foldPair(strands, 36) // five fit one way across 36
  assert.deepEqual(same.strands, strands)
  assert.equal(same.stands.size, 0)
  assert.equal(foldPair(pair(many(8, 'ahead')), 100).strands.length, 8)
  assert.equal(foldPair(pair([...many(4, 'back'), ...many(4, 'ahead')]), 100).strands.length, 8)
  assert.equal(foldPair(pair([{ way: 'ahead' }]), 36).strands.length, 1)
  assert.deepEqual(foldPair([], 36).strands, [])
})

test('folding: more than CAP lines that run one way and share a kind become one trunk, with the kind, the number and the ids it stands for', () => {
  const strands = pair(many(9, 'ahead', 'request'))
  const { strands: out, stands } = foldPair(strands, 100)
  assert.equal(out.length, 1)
  const [trunk] = out
  assert.equal(trunk.id, trunkId('a b', 'a', 'b', 'request'))
  assert.equal(trunk.id, `a b|a>b|${TRUNK_MARK}request`)
  assert.deepEqual([trunk.pair, trunk.from, trunk.to, trunk.lane, trunk.lanes, trunk.kind], ['a b', 'a', 'b', 0, 1, 'request'])
  assert.deepEqual(trunk.trunk, { size: 9, members: ids(strands) })
  assert.deepEqual(trunk.connections, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  assert.equal(trunk.label, 'Request and reply x9')
  assert.equal(trunkLabel('request', 9), 'Request and reply x9')
  assert.deepEqual([...stands], strands.map(s => [s.id, trunk.id]))
})

test('folding: lines of no kind make a trunk named by its number, and lines of different kinds in the second step too', () => {
  const plain = foldPair(pair(many(9, 'ahead')), 100).strands
  assert.equal(plain.length, 1)
  assert.equal(plain[0].kind, undefined)
  assert.equal(plain[0].label, '9 connections')
  assert.equal(plain[0].id, `a b|a>b|${TRUNK_MARK}`)
  assert.equal(trunkLabel(undefined, 1), '1 connections')
})

test('folding: one trunk for each way and kind, in the order of each group\'s first line; a group of one stays a lane', () => {
  const specs = [
    ...many(5, 'back', 'request'), { way: 'back' as const, kind: 'stream' as const },
    { way: 'ahead' as const, kind: 'publish' as const }, ...many(2, 'ahead'), ...many(2, 'ahead', 'publish'),
  ]
  const strands = pair(specs)
  const { strands: out, stands } = foldPair(strands, 100)
  // 5 request (a trunk), the stream (alone), 3 publish (a trunk), 2 plain (a trunk): 4 lanes with 3 trunks.
  assert.deepEqual(out.map(s => [s.lane, s.lanes, s.from, s.kind ?? null, s.trunk?.size ?? null]), [[0, 4, 'b', 'request', 5], [1, 4, 'b', 'stream', null], [2, 4, 'a', 'publish', 3], [3, 4, 'a', null, 2]])
  assert.equal(out[1].id, strands[5].id) // the stream is the strand itself, only its lane is new
  assert.deepEqual(out[2].trunk!.members, [strands[6].id, strands[9].id, strands[10].id])
  assert.equal(stands.size, 5 + 3 + 2)
  assert.ok(!stands.has(strands[5].id))
  assert.equal(out.reduce((n, s) => n + s.connections.length, 0), strands.length) // no connection is lost
})

test('folding: the lanes that makes must fit with the room the trunks take, else one trunk for each way whatever the kinds', () => {
  // Across 36 (a short side) with both ways, 4 lanes fit and 3 with a trunk. Eight distinct singles would not, so: back 3 kinds + ahead 3 kinds + the same again.
  const specs = [
    ...KIND_IDS.slice(0, 3).map(kind => ({ way: 'back' as const, kind })), ...KIND_IDS.slice(0, 3).map(kind => ({ way: 'back' as const, kind })),
    ...KIND_IDS.slice(0, 3).map(kind => ({ way: 'ahead' as const, kind })), ...KIND_IDS.slice(0, 3).map(kind => ({ way: 'ahead' as const, kind })),
  ]
  const strands = pair(specs)
  // By kind that is 6 trunks of two: too many. By way: two trunks of 6, of mixed kinds.
  const { strands: out } = foldPair(strands, 36)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(s => [s.from, s.trunk!.size, s.kind ?? null, s.label]), [['b', 6, null, '6 connections'], ['a', 6, null, '6 connections']])
  assert.equal(out[0].id, `a b|b>a|${TRUNK_MARK}`)
  assert.equal(out[1].id, `a b|a>b|${TRUNK_MARK}`)
  // The same pair across a wide side (100) is eight lanes at most: 12 lines in 6 kinds fold by kind, 6 trunks fit.
  assert.equal(foldPair(strands, 100).strands.length, 6)
  // A way with one kind keeps it when folded by way.
  const alike = pair([...many(3, 'back', 'request'), ...many(2, 'back', 'cached'), ...many(2, 'ahead', 'object'), ...many(2, 'ahead', 'object'), ...many(2, 'ahead', 'stream')])
  assert.deepEqual(foldPair(alike, 36).strands.map(s => [s.kind ?? null, s.trunk?.size]), [[null, 5], [null, 6]]) // 3 trunks do not fit (3 lanes need 4)
})

test('folding: a trunk never counts fewer connections than it holds; a strand of several connections counts them all', () => {
  const strands = pair([{ way: 'ahead', connections: 3 }, ...many(9, 'ahead')])
  const [trunk] = foldPair(strands, 100).strands
  assert.equal(trunk.trunk!.size, 12)
  assert.equal(trunk.trunk!.members.length, 10)
  assert.equal(trunk.connections.length, 12)
})

test('folding: a trunk id is never the id of a strand, whatever the labels say', () => {
  const labels = ['', `${TRUNK_MARK}`, 'request', 'x'.repeat(200), 'a b|a>b|']
  const strands = pair(labels.flatMap(label => many(2, 'ahead', 'request').map(s => ({ ...s, label }))).concat(many(1, 'ahead', 'request').map(s => ({ ...s, label: 'one more' }))))
  const { strands: out } = foldPair(strands, 36)
  assert.equal(out.length, 1)
  assert.ok(!strands.some(s => s.id === out[0].id))
  assert.ok(out[0].id.includes('\u0002'))
  assert.equal(/\u0002/.test('any label a file can hold'), false) // YAML cannot hold a control character, so no label has one
})

test('folding keeps every connection exactly once, the ways apart and in order, and fits (properties)', () => {
  const kind = fc.constantFrom<KindId | undefined>(undefined, ...KIND_IDS)
  const spec = fc.record({ way: fc.constantFrom<'back' | 'ahead'>('back', 'ahead'), kind, connections: fc.integer({ min: 1, max: 3 }) })
  fc.assert(fc.property(fc.array(spec, { minLength: 1, maxLength: 40 }), fc.constantFrom(20, 26, 36, 44, 100, 140), (specs, half) => {
    const strands = pair(specs)
    const { strands: out, stands } = foldPair(strands, half)
    const both = specs.some(s => s.way === 'back') && specs.some(s => s.way === 'ahead')
    // Every connection once.
    const before = strands.flatMap(s => s.connections).sort((a, b) => a - b)
    assert.deepEqual(out.flatMap(s => s.connections).sort((a, b) => a - b), before)
    // The lanes are numbered 0..n-1 in order, the back ones first.
    assert.deepEqual(out.map(s => s.lane), out.map((_, i) => i))
    assert.ok(out.every(s => s.lanes === out.length))
    const firstAhead = out.findIndex(s => s.from < s.to)
    assert.ok(firstAhead === -1 || out.slice(firstAhead).every(s => s.from < s.to))
    // Each trunk holds strands of one way, and its size is the connections of its members.
    for (const s of out) {
      if (s.trunk === undefined) continue
      const members = strands.filter(m => s.trunk!.members.includes(m.id))
      assert.equal(members.length, s.trunk.members.length)
      assert.ok(members.every(m => m.from === s.from))
      assert.equal(s.trunk.size, members.reduce((n, m) => n + m.connections.length, 0))
      assert.ok(members.every(m => stands.get(m.id) === s.id))
    }
    // It fits: within the capacity with the room its trunks take, or the least a way can be folded to (a lane for each way).
    const trunks = out.filter(s => s.trunk !== undefined).length
    assert.ok(out.length <= laneCapacity(half, both, trunks) || out.length <= (both ? 2 : 1), `${out.length} lanes, ${trunks} trunks, half ${half}`)
    // Nothing is folded that fit.
    if (strands.length <= laneCapacity(half, both)) assert.deepEqual(out, strands)
  }), { numRuns: 400 })
})

test('opening a trunk: its pair\'s selection swaps it for its lines, each in its lane; the other pairs keep theirs', () => {
  const strands = pair([...many(6, 'back', 'request'), ...many(5, 'ahead')])
  const unfolded = new Map(strands.map(s => [s.id, s]))
  const folded = foldPair(strands, 36).strands // 2 trunks of 6 and 5 (across 36 both ways: 4 lanes fit, 2 trunks)
  assert.equal(folded.length, 2)
  const other = pair(many(2, 'ahead')).map(s => ({ ...s, pair: 'c d', id: `c d|${s.id}` }))
  const opened = openTrunks([...folded, ...other], new Map([...unfolded, ...other.map(s => [s.id, s] as const)]), new Set(['a b']))
  assert.equal(opened.length, 11 + 2)
  assert.deepEqual(opened.slice(0, 6).map(s => [s.lane, s.lanes]), Array.from({ length: 6 }, () => [0, 2]))
  assert.deepEqual(opened.slice(6, 11).map(s => [s.lane, s.lanes]), Array.from({ length: 5 }, () => [1, 2]))
  assert.deepEqual(ids(opened.slice(0, 11)), ids(strands)) // the lines of the file, in the order of the file
  assert.ok(opened.every(s => s.trunk === undefined))
  assert.deepEqual(opened.slice(11), other)
  // Nothing opened: the same lines.
  assert.deepEqual(openTrunks(folded, unfolded, new Set()), folded)
  assert.deepEqual(openTrunks(folded, unfolded, new Set(['c d'])), folded)
})

test('opening a trunk: one that holds more than OPEN_MOST lines stays shut, since a pair of that many is read in the panel', () => {
  assert.equal(OPEN_MOST, 12)
  const twelve = pair(many(12, 'ahead'))
  const thirteen = pair(many(13, 'ahead'))
  const open = (strands: Strand[]) => openTrunks(foldPair(strands, 100).strands, new Map(strands.map(s => [s.id, s])), new Set(['a b'])).length
  assert.equal(open(twelve), 12)
  assert.equal(open(thirteen), 1)
})

test('a selected line opens the pair of the line, or the pair when the pair is selected', () => {
  const strands = pair(many(3, 'ahead'))
  assert.deepEqual([...pairsOpenedBy(strands, strands[1].id)], ['a b'])
  assert.deepEqual([...pairsOpenedBy(strands, 'a b')], ['a b'])
  assert.deepEqual([...pairsOpenedBy(strands, 'x y')], [])
  assert.deepEqual([...pairsOpenedBy(strands, undefined)], [])
  assert.deepEqual([...pairsOpenedBy(strands, `${strands[1].pair}|a>b|nothing`)], [])
})

test('slots: a trunk is a lane in the pair\'s stack, the lanes of an open trunk share a lane and fan out, and a plain pair is as it was', () => {
  const plain = slotsOf(pair([...many(2, 'back'), ...many(2, 'ahead')]))
  assert.deepEqual([...plain.values()].map(s => Object.keys(s)), Array.from({ length: 4 }, () => ['lane', 'lanes', 'back']))
  const strands = pair([...many(6, 'back', 'request'), ...many(5, 'ahead')])
  const folded = foldPair(strands, 36).strands
  const closed = slotsOf(folded)
  assert.deepEqual([...closed.values()], [{ lane: 0, lanes: 2, back: 1, stack: [0, 1] }, { lane: 1, lanes: 2, back: 1, stack: [0, 1] }])
  const opened = openTrunks(folded, new Map(strands.map(s => [s.id, s])), new Set(['a b']))
  const fanned = slotsOf(opened)
  assert.equal(fanned.size, 11)
  assert.deepEqual([...fanned.values()].map(s => [s.lane, s.lanes, s.back, s.within]), [...[0, 1, 2, 3, 4, 5].map(w => [0, 2, 1, w]), ...[0, 1, 2, 3, 4].map(w => [1, 2, 1, w])])
  assert.ok([...fanned.values()].every(s => s.fan!.join() === '6,5' && s.stack!.join() === '0,1'))
  assert.ok([...fanned.values()].every(s => isLaned(s)))
  // A lone trunk is one lane, which is not laned until it is open.
  const lone = foldPair(pair(many(9, 'ahead')), 100).strands
  const [loneSlot] = [...slotsOf(lone).values()]
  assert.deepEqual(loneSlot, { lane: 0, lanes: 1, back: 0, stack: [0] })
  assert.equal(isLaned(loneSlot), false)
  assert.equal(isLaned(undefined), false)
  const openLone = [...slotsOf(openTrunks(lone, new Map(pair(many(9, 'ahead')).map(s => [s.id, s])), new Set(['a b']))).values()]
  assert.ok(openLone.every(s => isLaned(s) && s.lanes === 1 && s.fan!.join() === '9'))
})

test('a trunk takes 6 px more room on its outer side; the bundle stays centred; the room the lanes take is what the capacity says', () => {
  const slot = (lane: number, lanes: number, back: number, stack?: number[]): Slot => ({ lane, lanes, back, ...(stack ? { stack } : {}) })
  // No trunk: the offsets are what they always were.
  assert.deepEqual(offsetsOf(slot(0, 3, 0)), [-12, 0, 12])
  assert.equal(offsetOf(slot(1, 3, 0)), 0)
  // One trunk in the middle: its outer side is the right; the lane beyond it is 6 further out; centred again.
  assert.deepEqual(offsetsOf(slot(0, 3, 0, [1])), [-15, -3, 15])
  // A trunk on the left lane has its outer side to the left: the lane beyond it is the one further left (none here); on the right lane, to the right.
  assert.deepEqual(offsetsOf(slot(0, 3, 0, [0])), [-12, 0, 12])
  assert.deepEqual(offsetsOf(slot(0, 3, 0, [2])), [-12, 0, 12])
  // Two lanes one each way, both trunks: each hairline side faces away from the other lane, so nothing moves.
  assert.deepEqual(offsetsOf(slot(0, 2, 1, [0, 1])), [-9, 9])
  // Four lanes with a trunk on the second lane, left of the centre: its outer side is the left, so the first lane is 6 further out, then the whole is centred again.
  assert.deepEqual(offsetsOf(slot(0, 4, 0, [1])), [-21, -3, 9, 21])
  for (const lanes of [2, 3, 4, 5, 6, 8]) {
    for (const stack of [[0], [1], [lanes - 1], [0, lanes - 1], [1, 2], [0, 1, 2]].filter(s => s.every(i => i < lanes))) {
      for (const back of [0, 1, lanes - 1]) {
        const s = slot(0, lanes, back, stack)
        const o = offsetsOf(s)
        assert.equal(round3(Math.max(...o) + Math.min(...o)), 0, `centred: ${JSON.stringify(s)}`)
        assert.equal(offsetOf({ ...s, lane: lanes - 1 }), o[lanes - 1])
        // The span the lanes take, from the first to the last, is the capacity's: lanes - 1 pitches, the gutter, and 6 for each trunk that has a lane beyond it.
        const gutter = back > 0 && back < lanes ? GUTTER : 0
        const raw = offsetsOf({ lane: 0, lanes, back })
        const outer = (t: number) => (raw[t] >= 0 ? t < lanes - 1 : t > 0)
        const extra = stack.filter(outer).length * TRUNK_EXTRA
        assert.equal(round3(Math.max(...o) - Math.min(...o)), round3((lanes - 1) * PITCH + gutter + extra), JSON.stringify(s))
        // And never more than the capacity allows when the pair fits.
        assert.ok(round3(Math.max(...o) - Math.min(...o)) <= (lanes - 1) * PITCH + gutter + TRUNK_EXTRA * stack.length)
      }
    }
  }
})

test('a pair of trunks and lanes that fits across the shapes keeps its pitch; one that does not is squeezed', () => {
  const stacked: Slot = { lane: 0, lanes: 3, back: 0, stack: [0, 1] }
  // usable(36) = 52: three lanes need 24 + 12 = 36.
  assert.equal(pitchFor(36, stacked), PITCH)
  assert.equal(pitchFor(36, { lane: 0, lanes: 4, back: 0, stack: [0, 1, 2] }), (52 - 18) / 3)
  assert.equal(pitchFor(36, { lane: 0, lanes: 4, back: 0 }), PITCH)
})

test('the hairlines lie behind a trunk, on its outer side, a fixed step along the normal of the pair', () => {
  assert.equal(HAIRLINE_GAP, 3)
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  // a < b, so the normal n of the pair points down (towards +y) when b is to the right of a.
  assert.deepEqual(stackStep(a, b, { lane: 0, lanes: 1, back: 0, stack: [0] }), { x: 0, y: 1 })
  assert.deepEqual(stackStep(b, a, { lane: 0, lanes: 1, back: 0, stack: [0] }), { x: 0, y: 1 }) // the same whichever end the lane starts at
  assert.deepEqual(stackStep(a, b, { lane: 0, lanes: 2, back: 1, stack: [0, 1] }), { x: 0, y: -1 }) // the lane left of the centre: its outer side is the other way
  assert.deepEqual(stackStep(a, b, { lane: 1, lanes: 2, back: 1, stack: [0, 1] }), { x: 0, y: 1 })
  const c = box('c', 300, 300)
  const s = stackStep(a, c, { lane: 0, lanes: 1, back: 0, stack: [0] })
  assert.ok(Math.abs(s.x * s.x + s.y * s.y - 1) < 0.001)
  assert.ok(Object.is(stackStep(box('a', 0, 0), box('b', 0, 300), { lane: 0, lanes: 1, back: 0, stack: [0] }).y, 0)) // not -0
})

/** The point of a lane at sample t of 24 (a lane at rest is one straight stretch). */
const at = (lane: { points: { x: number; y: number }[] }, t: number) => {
  if (lane.points.length > 2) return lane.points[t]
  const [p, q] = lane.points
  return { x: p.x + ((q.x - p.x) * t) / 24, y: p.y + ((q.y - p.y) * t) / 24 }
}

test('the lines of an open trunk fan out of the trunk\'s place: the same ends, a pitch apart in the middle, and the lanes beside it move away', () => {
  const [a, b] = [box('a', 0, 0), box('b', 0, 400)]
  const strands = pair([...many(7, 'ahead', 'request'), ...many(1, 'ahead', 'stream'), ...many(1, 'ahead', 'publish'), ...many(1, 'ahead', 'cached'), ...many(1, 'ahead', 'object'), ...many(1, 'ahead', 'extension')])
  const folded = foldPair(strands, 100).strands
  assert.ok(folded.some(s => s.trunk))
  const opened = openTrunks(folded, new Map(strands.map(s => [s.id, s])), new Set(['a b']))
  const slots = slotsOf(opened)
  const lanesOf = opened.map(s => laneGeometry(a, b, slots.get(s.id)!, REST))
  const trunkAt = folded.findIndex(s => s.trunk)
  const closedLane = laneGeometry(a, b, slotsOf(folded).get(folded[trunkAt].id)!, REST)
  const members = opened.filter(s => s.lane === trunkAt)
  assert.equal(members.length, 7)
  const fan = lanesOf.filter((_, i) => opened[i].lane === trunkAt)
  // Ends meet: every line of the trunk starts and ends where the trunk does (the open trunk keeps its lane's room, so the closed trunk's path is theirs at the ends).
  for (const lane of fan) assert.deepEqual([lane.points[0], lane.points.at(-1)], [closedLane.points[0], closedLane.points.at(-1)])
  // Middle: a pitch apart along n, centred on the trunk.
  const mid = fan.map(l => ({ x: l.x, y: l.y }))
  for (let i = 1; i < mid.length; i++) assert.ok(Math.abs(Math.abs(mid[i].x - mid[i - 1].x) - PITCH) < 0.01 && Math.abs(mid[i].y - mid[i - 1].y) < 0.01)
  assert.ok(Math.abs((mid[0].x + mid.at(-1)!.x) / 2 - closedLane.points[0].x) < 0.01)
  // The neighbours are a pitch (and the room of the hairlines) away from the nearest line of the trunk in the middle as at the ends, and every line is in order at every sample: nothing crosses.
  const ordered = opened.map((s, i) => ({ s, lane: lanesOf[i] })).sort((p, q) => p.s.lane - q.s.lane || (slots.get(p.s.id)!.within ?? 0) - (slots.get(q.s.id)!.within ?? 0))
  for (let t = 0; t <= 24; t++) {
    const xs = ordered.map(o => at(o.lane, t).x)
    // along +x in this frame: a < b, n = (1, 0) rotated... the lanes only need to be sorted one way or the other
    const up = xs.every((x, i) => i === 0 || x >= xs[i - 1] - 0.0001)
    const down = xs.every((x, i) => i === 0 || x <= xs[i - 1] + 0.0001)
    assert.ok(up || down, `no crossing at sample ${t}: ${xs.join(' ')}`)
  }
  // Shut, the trunk is one lane and its neighbours are where they were at rest.
  const restOf = (i: number) => laneGeometry(a, b, slotsOf(folded).get(folded[i].id)!, REST).points
  assert.ok(restOf(trunkAt).length === 2)
})

test('displacement of an open trunk is a field that is monotone in the lane and in the place within the lane (properties)', () => {
  fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 12 }), { minLength: 1, maxLength: 5 }), fc.integer({ min: 0, max: 5 }), fc.constantFrom(100, 250, 600), (counts, backRaw, length) => {
    const lanes = counts.length
    const back = Math.min(backRaw, lanes)
    const stack = counts.flatMap((n, lane) => (n > 1 ? [lane] : []))
    const slots: Slot[] = counts.flatMap((n, lane) => Array.from({ length: n }, (_, within) => ({ lane, lanes, back, ...(stack.length ? { stack } : {}), fan: counts, within })))
    for (const pose of [REST, { s: 1, lam: [] }]) {
      for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const at = slots.map(s => offsetOf(s) + bulge(t) * displacement(s, pose, length, PITCH))
        for (let i = 1; i < at.length; i++) assert.ok(at[i] > at[i - 1] - 0.0001, `t ${t}: ${at.join(' ')}`)
      }
    }
    // The ends do not move.
    for (const s of slots) assert.equal(Math.abs(bulge(0) * displacement(s, REST, length, PITCH)), 0)
  }), { numRuns: 200 })
})

test('an open trunk\'s fan clears its neighbours by a pitch in the middle', () => {
  const counts = [1, 5, 1]
  const slots = (lane: number): Slot[] => Array.from({ length: counts[lane] }, (_, within) => ({ lane, lanes: 3, back: 0, stack: [1], fan: counts, within }))
  const mid = (s: Slot) => offsetOf(s) + displacement(s, REST, 400, PITCH)
  const left = mid(slots(0)[0])
  const fan = slots(1).map(mid)
  const right = mid(slots(2)[0])
  assert.ok(Math.abs(fan[1] - fan[0] - PITCH) < 0.0001)
  // Left of the fan: rest gap (a pitch) at the ends and in the middle as well; right of it: the pitch and the room of the hairlines.
  assert.ok(Math.abs(fan[0] - left - PITCH) < 0.0001)
  assert.ok(Math.abs(right - fan.at(-1)! - (PITCH + TRUNK_EXTRA)) < 0.0001)
})

test('the lane words of the key', () => {
  assert.deepEqual(LANE_KEY, { inUse: 'In use', stacked: 'Stacked lines' })
})

// -- a view: the room across the shapes decides where a pair folds -----------------------------------------------------------------------

/** Two systems `a` and `b` with `n` connections one way (the first `plainCount` of no kind, the rest of a kind) in a project that draws a line for each, `b` at (x, y) and `a` at the origin. */
function twoShapes(n: number, [x, y]: [number, number], extra: Connection[] = [], kind?: KindId): Model {
  const connections: Connection[] = Array.from({ length: n }, (_, i) => ({ from: 'a', to: 'b', label: `Line ${i + 1}`, ...(kind === undefined ? {} : { kind }) }))
  return {
    ...emptyModel(), meta: { pairs: 'separate' }, objects: { a: { type: 'system', name: 'A' }, b: { type: 'system', name: 'B' }, c: { type: 'system', name: 'C' } },
    connections: [...connections, ...extra], layout: { root: { a: [0, 0], b: [x, y], c: [x + 600, y] } },
  }
}

test('a pair meeting at the wide sides draws eight lines and folds the ninth; at the short sides it folds from the sixth', () => {
  const lines = (model: Model, style: 'straight' | 'curved' | 'angled' = 'straight') => drawnView(model, 'root', style).view.strands!
  assert.equal(lines(twoShapes(8, [0, 300])).length, 8) // above and below: 100 of room each side
  assert.equal(lines(twoShapes(9, [0, 300])).length, 1)
  assert.equal(lines(twoShapes(5, [400, 0])).length, 5) // beside: 36 of room each side, five fit one way
  assert.equal(lines(twoShapes(6, [400, 0])).length, 1)
  assert.equal(lines(twoShapes(6, [400, 0]), 'curved').length, 1)
  assert.equal(lines(twoShapes(6, [400, 0]), 'angled').length, 1)
  const [trunk] = lines(twoShapes(9, [0, 300]))
  assert.equal(trunk.trunk!.size, 9)
  assert.equal(trunk.id, `a b|a>b|${TRUNK_MARK}`)
})

test('the view as it is drawn keeps computeView\'s and says which trunk each folded strand is in; one that folds nothing is the same', () => {
  const model = twoShapes(9, [0, 300], [{ from: 'b', to: 'c', label: 'Other' }])
  const drawn = drawnView(model, 'root')
  assert.equal(drawn.unfolded.strands!.length, 10)
  assert.deepEqual(drawn.view.edges, drawn.unfolded.edges) // the pair-level lines are the same
  assert.equal(drawn.view.strands!.length, 2)
  assert.equal(drawn.stands.size, 9)
  assert.equal(drawn.stands.get('a b|a>b|Line 3'), `a b|a>b|${TRUNK_MARK}`)
  assert.ok(!drawn.stands.has('b c|b>c|Other'))
  const fits = drawnView(twoShapes(3, [0, 300]), 'root')
  assert.deepEqual(fits.view.strands, fits.unfolded.strands)
  assert.equal(fits.stands.size, 0)
  // A view that draws one line for each pair has no strands, and folding leaves it alone.
  const merged = drawnView({ ...twoShapes(20, [0, 300]), meta: {} }, 'root')
  assert.equal(merged.view.strands, undefined)
  assert.deepEqual(merged.view, computeView({ ...twoShapes(20, [0, 300]), meta: {} }, 'root'))
})

test('the room is measured where the shapes are drawn and with their outlines', () => {
  const model = (shape: 'rectangle' | 'diamond') => ({ ...twoShapes(6, [300, 300]), objects: { a: { type: 'system' as const, name: 'A', shape }, b: { type: 'system' as const, name: 'B', shape }, c: { type: 'system' as const, name: 'C' } } })
  // Across a pair on a diagonal a box has 51 px of room each side of the line between the centres (7 lines), a diamond 37 (5 lines).
  assert.equal(drawnView(model('rectangle'), 'root').view.strands!.length, 6)
  assert.equal(drawnView(model('diamond'), 'root').view.strands!.length, 1)
})

test('a step that rides a line in a trunk rides the trunk; one that rides a line alone rides it', () => {
  const model: Model = {
    ...twoShapes(9, [0, 300], [{ from: 'b', to: 'c', label: 'Other' }]),
    flows: { f: { name: 'F', view: 'root', steps: [{ from: 'a', to: 'b', text: 'Asks', via: 'Line 4' }, { from: 'b', to: 'c', text: 'Goes on' }, { from: 'a', to: 'b', text: 'Again' }] } },
  }
  const drawn = drawnView(model, 'root')
  const placed = (i: number): [string, string] => [model.flows.f.steps[i].from, model.flows.f.steps[i].to!]
  assert.equal(drawnStrandOf(model, drawn, model.flows.f.steps[0], placed(0)), `a b|a>b|${TRUNK_MARK}`)
  assert.equal(drawnStrandOf(model, drawn, model.flows.f.steps[1], placed(1)), 'b c|b>c|Other')
  assert.equal(drawnStrandOf(model, drawn, model.flows.f.steps[2], placed(2)), `a b|a>b|${TRUNK_MARK}`)
  assert.equal(drawnStrandOf(model, drawn, { from: 'c', to: 'a', text: '' }, ['c', 'a']), undefined)
  // Which of the lines in the trunk a step names does not matter for what is drawn, but strandOf still finds it.
  assert.equal(lineKey('a', 'b'), 'a b')
})

test('the code of lanes and trunks uses no hypot, trigonometry or pow, so the C# twin gets the same numbers', () => {
  for (const file of ['src/core/lanes.ts', 'src/core/trunks.ts']) {
    const code = readFileSync(join(import.meta.dirname, '..', file), 'utf8').split('\n').filter(l => !/^\s*(\/?\*|\/\/)/.test(l)).join('\n')
    assert.equal(/Math\.(hypot|atan2|sin|cos|tan|pow|atan|exp|log)\b/.test(code), false, file)
  }
})
