import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import fc from 'fast-check'
import { endsOfPath } from '../src/core/heads.ts'
import type { Point } from '../src/core/heads.ts'
import {
  bulge, displacement, easedSpread, laneCapacity, laneGeometry, leaveAt, MOST, nearestStrand, offsetOf, PITCH, REST, round3, slotsOf, SPREAD, SPREAD_MS, SPREAD_PITCH, spreadProgress, usableOf,
} from '../src/core/lanes.ts'
import type { HitLane, LaneBox, Outline, Pose, Slot } from '../src/core/lanes.ts'
import { SHAPE_DEFS } from '../src/core/look.ts'
import { computeView } from '../src/core/views.ts'
import { depthIn, lineEnds } from '../ui/src/graph.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Model } from '../src/core/model.ts'

/** A model of systems with the given ids and connections, that draws a line for each connection. */
const systems = (ids: string[], connections: Connection[]): Model => ({
  ...emptyModel(), meta: { pairs: 'separate' }, objects: Object.fromEntries(ids.map(id => [id, { type: 'system' as const, name: id }])), connections,
})

/** A box 200 by 72 whose centre is (cx, cy), with the outline of a shape. */
const box = (id: string, cx: number, cy: number, edge: Outline = [], width = 200, height = 72): LaneBox => ({ id, rect: { x: cx - width / 2, y: cy - height / 2, width, height }, edge })
const slot = (lane: number, lanes: number, back: number): Slot => ({ lane, lanes, back })

/** The lanes of a pair as the lane store asks for them: `ways` lists the lanes in order, true for one that runs from the later id to the earlier. */
function bundle(a: LaneBox, b: LaneBox, ways: boolean[], pose: Pose = REST) {
  const back = ways.filter(w => w).length
  return ways.map((backwards, lane) => laneGeometry(backwards ? b : a, backwards ? a : b, slot(lane, ways.length, back), pose))
}

test('the worked example: two lanes, one each way, between boxes 400 apart', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const [back, forward] = bundle(a, b, [true, false])
  assert.equal(forward.path, 'M100 9L300 9')
  assert.equal(back.path, 'M300 -9L100 -9')
  assert.deepEqual([forward.x, forward.y, back.x, back.y], [200, 9, 200, -9])
  assert.deepEqual(forward.points, [{ x: 100, y: 9 }, { x: 300, y: 9 }])
  // The head is at the end of the path whichever way the lane runs.
  assert.deepEqual(endsOfPath(back.path)?.end, { x: 100, y: -9 })
  assert.deepEqual(endsOfPath(forward.path)?.end, { x: 300, y: 9 })
})

test('the lanes are centred on the line between the centres: 1, 2 and 3 lanes one way, and the gutter between two ways', () => {
  const offsets = (lanes: number, back: number) => Array.from({ length: lanes }, (_, lane) => offsetOf(slot(lane, lanes, back)))
  assert.deepEqual(offsets(1, 0), [0])
  assert.deepEqual(offsets(2, 0), [-6, 6])
  assert.deepEqual(offsets(3, 0), [-12, 0, 12])
  assert.deepEqual(offsets(3, 3), [-12, 0, 12])
  assert.deepEqual(offsets(2, 1), [-9, 9])
  assert.deepEqual(offsets(5, 2), [-27, -15, 3, 15, 27])
  for (const [lanes, back] of [[4, 2], [5, 1], [7, 3], [6, 5]]) {
    const o = offsets(lanes, back)
    // Inside a direction the pitch is the pitch; across the two directions it is the pitch and the gutter.
    for (let i = 1; i < lanes; i++) assert.equal(round3(o[i] - o[i - 1]), i === back ? PITCH + 6 : PITCH)
  }
})

test('lanes run exactly parallel to the line between the centres, a pitch apart, whatever the angle', () => {
  const a = box('a', 0, 0)
  for (const [x, y] of [[400, 0], [0, 300], [330, 190], [-250, 120], [120, -400]]) {
    const b = box('b', x, y)
    const lanes = bundle(a, b, [false, false, false])
    const dx = (p: Point, q: Point) => [q.x - p.x, q.y - p.y]
    const [d0, d1, d2] = lanes.map(l => dx(l.points[0], l.points[1]))
    // Parallel: the sine of the angle between their directions is nothing, within the rounding of three decimals.
    const turn = (p: number[], q: number[]) => Math.abs(p[0] * q[1] - p[1] * q[0]) / Math.sqrt((p[0] * p[0] + p[1] * p[1]) * (q[0] * q[0] + q[1] * q[1]))
    assert.ok(turn(d0, d1) < 0.01 && turn(d1, d2) < 0.01, `${x},${y}`)
    // And a pitch apart, measured across: the distance of a point of one lane from the line through the other.
    const across = (p: Point, line: Point[]) => Math.abs((line[1].x - line[0].x) * (line[0].y - p.y) - (line[0].x - p.x) * (line[1].y - line[0].y)) / Math.sqrt((line[1].x - line[0].x) ** 2 + (line[1].y - line[0].y) ** 2)
    assert.ok(Math.abs(across(lanes[1].points[0], lanes[0].points) - PITCH) < 0.05, `${x},${y}`)
    assert.ok(Math.abs(across(lanes[2].points[0], lanes[1].points) - PITCH) < 0.05, `${x},${y}`)
  }
})

test('the ends are on the outline of the shape, for every outline', () => {
  const edges = [[], SHAPE_DEFS.diamond.edge, SHAPE_DEFS.ellipse.edge, SHAPE_DEFS.hexagon.edge, SHAPE_DEFS.pill.edge]
  for (const edgeA of edges) {
    for (const edgeB of edges) {
      const [a, b] = [box('a', 0, 0, edgeA), box('b', 380, 150, edgeB)]
      for (const lane of bundle(a, b, [true, false, false], SPREAD)) {
        const [start, end] = [lane.points[0], lane.points.at(-1)!]
        const near = (p: Point) => Math.min(Math.abs(depthIn(a.rect, edgeA, p.x, p.y)), Math.abs(depthIn(b.rect, edgeB, p.x, p.y)))
        assert.ok(near(start) < 0.01 && near(end) < 0.01)
      }
    }
  }
})

test('a ray from the centre leaves a shape where it always did; one from another point is cut by the same sides', () => {
  /** The function as it was in ui/src/graph.ts before it took a starting point, copied. */
  function before(r: LaneBox['rect'], edge: Outline, dx: number, dy: number): Point {
    const cx = r.x + r.width / 2
    const cy = r.y + r.height / 2
    if (edge.length === 0) {
      const k = Math.min(r.width / 2 / Math.abs(dx), r.height / 2 / Math.abs(dy))
      return { x: cx + dx * k, y: cy + dy * k }
    }
    let best = Infinity
    edge.forEach(([px, py], i) => {
      const [qx, qy] = edge[(i + 1) % edge.length]
      const ex = qx - px
      const ey = qy - py
      const den = dx * ey - dy * ex
      if (den === 0) return
      const t = ((r.x + px - cx) * ey - (r.y + py - cy) * ex) / den
      const s = ((r.x + px - cx) * dy - (r.y + py - cy) * dx) / den
      if (t > 0 && s >= 0 && s <= 1 && t < best) best = t
    })
    return best === Infinity ? { x: cx, y: cy } : { x: cx + dx * best, y: cy + dy * best }
  }
  const rect = { x: 10.5, y: -20.25, width: 200, height: 72 }
  for (const edge of [[], SHAPE_DEFS.diamond.edge, SHAPE_DEFS.ellipse.edge, SHAPE_DEFS.cloud.edge]) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.28, 0.96], [0.96, -0.28], [-0.6, -0.8]]) {
      assert.deepEqual(leaveAt(rect, edge, dx, dy), before(rect, edge, dx, dy))
    }
  }
  // From the centre given as a point, the rectangle gives the same answer within a rounding.
  const c = { x: rect.x + 100, y: rect.y + 36 }
  const [p, q] = [leaveAt(rect, [], 0.6, 0.8), leaveAt(rect, [], 0.6, 0.8, c)]
  assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9)
  // From a point 10 above the centre, a ray to the right meets the right side 10 above its middle; one straight up meets the top.
  assert.deepEqual(leaveAt(rect, [], 1, 0, { x: c.x, y: c.y - 10 }), { x: rect.x + 200, y: c.y - 10 })
  assert.deepEqual(leaveAt(rect, [], 0, -1, { x: c.x + 30, y: c.y }), { x: c.x + 30, y: rect.y })
  assert.deepEqual(leaveAt(rect, [], -1, 0, { x: c.x, y: c.y + 5 }), { x: rect.x, y: c.y + 5 })
})

test('with one lane in the pair the line is the one between the centres, within a rounding', () => {
  for (const edge of [[], SHAPE_DEFS.diamond.edge, SHAPE_DEFS.ellipse.edge]) {
    for (const [x, y] of [[400, 0], [0, 220], [330, 190], [-100, -300]]) {
      const [a, b] = [box('a', 0, 0, edge), box('b', x, y, edge)]
      const [lane] = bundle(a, b, [false])
      const [from, to] = lineEnds(a.rect, b.rect, edge, edge)
      assert.ok(Math.abs(lane.points[0].x - from.x) < 0.001 && Math.abs(lane.points[0].y - from.y) < 0.001)
      assert.ok(Math.abs(lane.points[1].x - to.x) < 0.001 && Math.abs(lane.points[1].y - to.y) < 0.001)
    }
  }
})

test('the capacity of a pair: lanes across the smaller half-room of the two shapes', () => {
  // Boxes 200 by 72: the sides meet a pair beside each other across 36, a pair above each other across 100.
  assert.equal(usableOf(36), 52)
  assert.equal(usableOf(100), 180)
  assert.equal(laneCapacity(36, false), 5)
  assert.equal(laneCapacity(36, true), 4)
  assert.equal(laneCapacity(100, false), MOST)
  assert.equal(laneCapacity(100, true), MOST)
  assert.equal(laneCapacity(10, false), 1) // never fewer than one
  // The lanes that fit keep their pitch; more than fit are drawn closer, so every lane still meets the outline.
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const gap = (lanes: number) => {
    const l = bundle(a, b, Array.from({ length: lanes }, () => false))
    return round3(l[1].points[0].y - l[0].points[0].y)
  }
  assert.equal(gap(5), PITCH)
  assert.ok(gap(8) < PITCH)
  for (const lane of bundle(a, b, Array.from({ length: 8 }, () => false))) assert.ok(Math.abs(lane.points[0].y) <= 36 - 10 + 0.001)
})

test('slotsOf counts the lanes that run from the later id to the earlier', () => {
  const model = systems(['a', 'b', 'c'], [
    { from: 'a', to: 'b', label: 'one' }, { from: 'b', to: 'a', label: 'two' }, { from: 'b', to: 'a', label: 'three' }, { from: 'a', to: 'c', label: 'four' },
  ])
  const view = computeView(model, 'root')
  const slots = slotsOf(view.strands!)
  const ofLabel = (label: string) => slots.get(view.strands!.find(s => s.label === label)!.id)
  assert.deepEqual(ofLabel('two'), { lane: 0, lanes: 3, back: 2 })
  assert.deepEqual(ofLabel('three'), { lane: 1, lanes: 3, back: 2 })
  assert.deepEqual(ofLabel('one'), { lane: 2, lanes: 3, back: 2 })
  assert.deepEqual(ofLabel('four'), { lane: 0, lanes: 1, back: 0 })
})

test('the order of the lanes depends on the way and the order in the file; a new connection moves only its own pair', () => {
  const connections: Connection[] = [
    { from: 'a', to: 'b', label: 'one' }, { from: 'b', to: 'a', label: 'two' }, { from: 'a', to: 'b', label: 'three' }, { from: 'a', to: 'c', label: 'four' }, { from: 'c', to: 'a', label: 'five' },
  ]
  const draw = (list: Connection[], ids: [string, string, string]) => {
    const model = systems(['a', 'b', 'c'], list)
    const view = computeView(model, 'root')
    const slots = slotsOf(view.strands!)
    const at = { a: box(ids[0], 0, 0), b: box(ids[1], 400, 0), c: box(ids[2], 0, 300) }
    return new Map(view.strands!.map(s => {
      const lane = laneGeometry(at[s.from as 'a'], at[s.to as 'a'], slots.get(s.id)!)
      return [s.label, lane.path]
    }))
  }
  const base = draw(connections, ['a', 'b', 'c'])
  // The ids only name the shapes; the lane order does not read them beyond which is the earlier of the pair, so the same file with the same ids gives the same lanes.
  assert.deepEqual(draw(connections, ['a', 'b', 'c']), base)
  const more = draw([...connections, { from: 'a', to: 'b', label: 'six' }], ['a', 'b', 'c'])
  assert.equal(more.get('four'), base.get('four'))
  assert.equal(more.get('five'), base.get('five'))
  assert.notEqual(more.get('one'), base.get('one'))
  // The back lane is on the right of its own way: 'two' runs b to a, so it is drawn on the side of a-to-b's left.
  const yOf = (path: string) => Number(path.match(/^M[-\d.]+ ([-\d.]+)/)![1])
  assert.ok(yOf(base.get('two')!) < yOf(base.get('one')!))
})

test('the displacement field is 0 at both ends, 1 in the middle, and has no slope at the ends', () => {
  assert.equal(bulge(0), 0)
  assert.equal(bulge(1), 0)
  assert.equal(bulge(0.5), 1)
  assert.ok(bulge(0.01) < 0.002)
  assert.ok(bulge(0.99) < 0.002)
})

test('spread: the ends stay, and the middle pitch is 22 where the pair is long enough', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const rest = bundle(a, b, [false, false, false])
  const spread = bundle(a, b, [false, false, false], SPREAD)
  spread.forEach((lane, k) => {
    assert.deepEqual(lane.points[0], rest[k].points[0])
    assert.deepEqual(lane.points.at(-1), rest[k].points[1])
    if (k === 1) return assert.equal(lane.path, rest[k].path) // the middle lane of three is where the others widen from
    assert.equal(lane.points.length, 25)
    assert.ok(lane.path.startsWith(`M${rest[k].points[0].x} ${rest[k].points[0].y}Q`))
    assert.ok(lane.path.endsWith(`L${rest[k].points[1].x} ${rest[k].points[1].y}`))
  })
  const middle = spread.map(l => l.y)
  assert.equal(round3(middle[1] - middle[0]), SPREAD_PITCH)
  assert.equal(round3(middle[2] - middle[1]), SPREAD_PITCH)
  assert.deepEqual([spread[1].x, spread[1].y], [200, 0]) // the anchor is the middle of the lane
  assert.equal(spread[0].points[12].y, -22)
  // A lone line, and the pose of nothing, do not move.
  const [one] = bundle(a, b, [false], SPREAD)
  assert.equal(one.points.length, 2)
  assert.deepEqual(bundle(a, b, [false, false], { s: 0, lam: [0, 0] }).map(l => l.points.length), [2, 2])
  // Shapes very close together widen less: the middle pitch is at most a fifth of the length again as wide as the widest lane is far out.
  const [near, far] = [displacement(slot(1, 2, 0), SPREAD, 60, PITCH), displacement(slot(1, 2, 0), SPREAD, 400, PITCH)]
  assert.ok(near > 0 && near < far)
})

test('part: the lanes open around a lit lane, which keeps its place, to the pitch and the gap', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const parted = bundle(a, b, [false, false, false], { s: 0, lam: [0, 1, 0] })
  const middle = parted.map(l => l.y)
  assert.deepEqual(middle, [-30, 0, 30]) // 12 + 18 on each side of the lit lane
  assert.equal(parted[1].points.length, 2) // the lit lane itself stays straight
  // Two lit lanes next to each other: the gap between them is the pitch and twice the gap beside one.
  const two = bundle(a, b, [false, false, false, false], { s: 0, lam: [0, 1, 1, 0] }).map(l => l.y)
  assert.equal(round3(two[2] - two[1]), 12 + 36) // between two lit lanes: the pitch and a gap beside each
  assert.equal(round3(two[1] - two[0]), 12 + 18)
  // The gap is capped by the length of the pair: it is at most a fifth of it.
  assert.equal(displacement(slot(2, 3, 0), { s: 0, lam: [0, 1, 0] }, 50, PITCH), 10)
  assert.equal(displacement(slot(0, 3, 0), { s: 0, lam: [0, 1, 0] }, 50, PITCH), -10)
  assert.equal(displacement(slot(0, 3, 0), REST, 400, 12), 0)
})

test('a pair eases to spread in 160 ms and back in 160 ms, at the same speed either way', () => {
  assert.equal(SPREAD_MS, 160)
  // Frame by frame at 20 ms (a step that is exact in binary): 8 frames to spread, all of them between rest and spread until the last.
  let progress = 0
  let frames = 0
  while (progress < 1) {
    progress = spreadProgress(progress, 1, 20)
    frames++
    assert.ok(progress > 0 && progress <= 1)
  }
  assert.equal(frames, 8)
  assert.equal(spreadProgress(0, 1, 160), 1)
  assert.equal(spreadProgress(1, 0, 160), 0)
  assert.equal(spreadProgress(0, 1, 400), 1) // it stops at the goal
  assert.equal(spreadProgress(1, 0, 400), 0)
  assert.equal(spreadProgress(0.4, 0.4, 100), 0.4) // already there
  // Turned round half way it goes back from where it is, at the same speed: no jump.
  const half = spreadProgress(0, 1, 80)
  assert.equal(half, 0.5)
  assert.equal(spreadProgress(half, 0, 40), 0.25)
})

test('the eased s runs from 0 to 1, never leaves that, only grows with the progress, and is slow at both ends', () => {
  assert.equal(easedSpread(0), 0)
  assert.equal(easedSpread(1), 1)
  assert.equal(easedSpread(0.5), 0.5)
  let before = 0
  for (let i = 1; i <= 100; i++) {
    const s = easedSpread(i / 100)
    assert.ok(s >= before && s <= 1, `at ${i}%`)
    before = s
  }
  assert.ok(easedSpread(0.05) < 0.05 && easedSpread(0.95) > 0.95) // eases in and out
})

test('every frame of the ease is a valid pose: the ends stay on the outline, the lanes keep their order, and the middle widens step by step', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const rest = bundle(a, b, [false, false, false])
  let widest = 0
  for (let progress = 0; progress <= 1.0001; progress += 0.1) {
    const lanes = bundle(a, b, [false, false, false], { s: easedSpread(Math.min(1, progress)), lam: [] })
    lanes.forEach((lane, k) => {
      assert.deepEqual(lane.points[0], rest[k].points[0])
      assert.deepEqual(lane.points.at(-1), rest[k].points[1])
    })
    const middle = lanes.map(l => l.y)
    assert.ok(middle[0] < middle[1] && middle[1] < middle[2], `order at ${progress}`)
    assert.ok(middle[2] - middle[0] >= widest)
    widest = middle[2] - middle[0]
  }
  assert.equal(widest, 2 * SPREAD_PITCH) // it ends on the spread pose
})

/** The two segments cross, not counting a shared end. */
function crosses(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const side = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const [d1, d2, d3, d4] = [side(p3, p4, p1), side(p3, p4, p2), side(p1, p2, p3), side(p1, p2, p4)]
  return d1 * d2 < 0 && d3 * d4 < 0
}

const SHAPES: Outline[] = [[], SHAPE_DEFS.diamond.edge, SHAPE_DEFS.ellipse.edge, SHAPE_DEFS.hexagon.edge, SHAPE_DEFS.pill.edge]

test('seeded property: no two lanes of a pair cross at any pose, and every end is on its outline', () => {
  const lam = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 0, maxLength: 8 })
  fc.assert(fc.property(
    fc.integer({ min: 0, max: SHAPES.length - 1 }), fc.integer({ min: 0, max: SHAPES.length - 1 }),
    fc.integer({ min: -600, max: 600 }), fc.integer({ min: -500, max: 500 }),
    fc.integer({ min: 1, max: 8 }), fc.integer({ min: 0, max: 8 }),
    fc.double({ min: 0, max: 1, noNaN: true }), lam,
    (ia, ib, x, y, lanes, backs, s, lit) => {
      // Shapes that overlap have no lanes to speak of.
      if (Math.abs(x) < 260 && Math.abs(y) < 120) return
      const [a, b] = [box('a', 0, 0, SHAPES[ia]), box('b', x, y, SHAPES[ib])]
      const back = Math.min(backs, lanes)
      const pose: Pose = { s, lam: lit.slice(0, lanes) }
      const drawn = Array.from({ length: lanes }, (_, lane) => {
        const backwards = lane < back
        return laneGeometry(backwards ? b : a, backwards ? a : b, slot(lane, lanes, back), pose)
      })
      for (const lane of drawn) {
        const [start, end] = [lane.points[0], lane.points.at(-1)!]
        for (const p of [start, end]) {
          const onA = Math.abs(depthIn(a.rect, SHAPES[ia], p.x, p.y))
          const onB = Math.abs(depthIn(b.rect, SHAPES[ib], p.x, p.y))
          assert.ok(Math.min(onA, onB) < 0.01, `end ${p.x},${p.y} off the outline`)
        }
      }
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const [p, q] = [drawn[i].points, drawn[j].points]
          for (let k = 0; k + 1 < p.length; k++) for (let m = 0; m + 1 < q.length; m++) assert.ok(!crosses(p[k], p[k + 1], q[m], q[m + 1]), `lanes ${i} and ${j} cross`)
        }
      }
    },
  ), { seed: 20261103, numRuns: 400 })
})

test('seeded property: the lanes of a pair at rest stay a pitch apart across the whole length, within the gutter', () => {
  fc.assert(fc.property(fc.integer({ min: 2, max: 4 }), fc.integer({ min: 0, max: 4 }), fc.integer({ min: 300, max: 700 }), fc.integer({ min: -300, max: 300 }), (lanes, backs, x, y) => {
    const [a, b] = [box('a', 0, 0), box('b', x, y)]
    const back = Math.min(backs, lanes)
    const drawn = bundle(a, b, Array.from({ length: lanes }, (_, lane) => lane < back))
    for (let i = 1; i < lanes; i++) {
      const gap = (at: number) => {
        const [p, q] = [drawn[i].points, drawn[i - 1].points]
        return Math.sqrt((p[at].x - q[at].x) ** 2 + (p[at].y - q[at].y) ** 2)
      }
      const expected = i === back && back > 0 && back < lanes ? PITCH + 6 : PITCH
      // The ends are cut by the outline at different depths, so the lanes' ends are further apart along the way than across it; the lines themselves are exactly a pitch apart.
      const [p0, p1, q0] = [drawn[i].points[0], drawn[i].points[1], drawn[i - 1].points[0]]
      const length = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2)
      const across = Math.abs((p1.x - p0.x) * (p0.y - q0.y) - (p0.x - q0.x) * (p1.y - p0.y)) / length
      assert.ok(Math.abs(across - expected) < 0.05 + 0.002 * length / 100, `across ${across} for ${expected}`)
      assert.ok(gap(0) >= expected - 0.01)
    }
  }), { seed: 20261104, numRuns: 200 })
})

const HIT = (id: string, pair: string, lane: number, ...points: [number, number][]): HitLane => ({ id, pair, lane, points: points.map(([x, y]) => ({ x, y })) })

test('nearestStrand picks the lane within reach, and the lower lane when two are equally near', () => {
  const lanes = [HIT('x', 'p', 0, [0, -6], [100, -6]), HIT('y', 'p', 1, [0, 6], [100, 6])]
  assert.equal(nearestStrand(lanes, { x: 50, y: -5 }), 'x')
  assert.equal(nearestStrand(lanes, { x: 50, y: 8 }), 'y')
  assert.equal(nearestStrand(lanes, { x: 50, y: 0 }), 'x') // 6 from each: the lower lane
  assert.equal(nearestStrand(lanes, { x: 50, y: 40 }), undefined)
  assert.equal(nearestStrand(lanes, { x: 150, y: -6 }), undefined) // past the end
  assert.equal(nearestStrand(lanes, { x: 100, y: -6 }), 'x')
  assert.equal(nearestStrand([], { x: 0, y: 0 }), undefined)
})

test('nearestStrand shrinks the reach where the lanes of a pair crowd together, and ignores the lanes of other pairs', () => {
  // Lanes 4 apart: a point 3 above the upper one is within its reach (min(7, 4 / 2 + 1) = 3) and a point 3.5 above is not.
  const close = [HIT('x', 'p', 0, [0, 0], [100, 0]), HIT('y', 'p', 1, [0, 4], [100, 4])]
  assert.equal(nearestStrand(close, { x: 50, y: -3 }), 'x')
  assert.equal(nearestStrand(close, { x: 50, y: -3.5 }), undefined)
  // A lane of another pair 4 away does not shrink it.
  const other = [HIT('x', 'p', 0, [0, 0], [100, 0]), HIT('z', 'q', 0, [0, 4], [100, 4])]
  assert.equal(nearestStrand(other, { x: 50, y: -6 }), 'x')
  // A lone line's reach is 7.
  assert.equal(nearestStrand([HIT('x', 'p', 0, [0, 0], [100, 0])], { x: 50, y: 7 }), 'x')
  assert.equal(nearestStrand([HIT('x', 'p', 0, [0, 0], [100, 0])], { x: 50, y: 7.5 }), undefined)
})

test('nearestStrand measures its reach in screen pixels, so it is 7 pixels at any zoom', () => {
  const lanes = [HIT('x', 'p', 0, [0, -12], [100, -12]), HIT('y', 'p', 1, [0, 12], [100, 12])] // 24 canvas units apart
  // Zoomed in to 2, the lanes are 48 pixels apart: a point 3.5 units (7 pixels) from one is hers, 3.6 is not.
  assert.equal(nearestStrand(lanes, { x: 50, y: -8.5 }, 2), 'x')
  assert.equal(nearestStrand(lanes, { x: 50, y: -8.4 }, 2), undefined)
  // Zoomed out to 0.5, they are 12 pixels apart and 14 units are 7 pixels: a point 14 units from one is hers, unless it is nearer the other.
  assert.equal(nearestStrand(lanes, { x: 50, y: -26 }, 0.5), 'x')
  assert.equal(nearestStrand(lanes, { x: 50, y: -26.2 }, 0.5), undefined)
  assert.equal(nearestStrand(lanes, { x: 50, y: -10 }, 0.5), 'x')
  assert.equal(nearestStrand(lanes, { x: 50, y: -1 }, 0.5), 'x') // 11 from x and 13 from y, in units
  // The reach shrinks with the gap on the screen: 24 units apart is 6 pixels at 0.25, so the reach is 6 / 2 + 1 = 4 pixels.
  assert.equal(nearestStrand(lanes, { x: 50, y: -16 }, 0.25), 'x') // 1 pixel off
  assert.equal(nearestStrand(lanes, { x: 50, y: -28 }, 0.25), 'x') // 4 pixels off
  assert.equal(nearestStrand(lanes, { x: 50, y: -29 }, 0.25), undefined) // 4.25 pixels off
  assert.equal(nearestStrand(lanes, { x: 50, y: -8 }, 1), nearestStrand(lanes, { x: 50, y: -8 })) // no zoom is zoom 1
})

test('nearestStrand follows a lane that is spread, not the line it was at rest', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const lanes = (pose: Pose): HitLane[] => bundle(a, b, [false, false, false], pose).map((l, lane) => ({ id: `l${lane}`, pair: 'p', lane, points: l.points }))
  // At rest the outer lanes are 12 off the middle; spread, 22.
  assert.equal(nearestStrand(lanes(REST), { x: 200, y: -12 }), 'l0')
  assert.equal(nearestStrand(lanes(SPREAD), { x: 200, y: -22 }), 'l0')
  assert.equal(nearestStrand(lanes(SPREAD), { x: 200, y: -11 }), undefined) // halfway between two lanes 22 apart is further than the reach of either
  assert.equal(nearestStrand(lanes(SPREAD), { x: 200, y: -16 }), 'l0')
})

test('the lane geometry uses no hypot, trigonometry or pow, so the C# twin gets the same numbers', () => {
  const text = readFileSync(join(import.meta.dirname, '..', 'src', 'core', 'lanes.ts'), 'utf8')
  assert.deepEqual(text.match(/Math\.(hypot|atan2?|a?sin|a?cos|a?tan|pow|exp|log\d*|cbrt)\b| \*\* /g), null)
})

test('round3 rounds halves up, whatever the sign', () => {
  assert.equal(round3(0.0005), 0.001)
  assert.equal(round3(-0.0005), 0)
  assert.equal(round3(-0.0015), -0.001)
  assert.equal(round3(1 / 3), 0.333)
})
