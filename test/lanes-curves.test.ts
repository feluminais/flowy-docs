import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react'
import fc from 'fast-check'
import { endsOfPath } from '../src/core/heads.ts'
import type { Point } from '../src/core/heads.ts'
import {
  ANGLE_RUN, bundleReach, GAP_LEAST, gapBeside, KAPPA_MAX, laneGeometry, MIN_ROUTE_GAP, nearestStrand, PITCH, pitchFor, ports, REST, roomOf, round3, SAMPLES, SPREAD,
} from '../src/core/lanes.ts'
import type { HitLane, LaneBox, Outline, Pose, Slot } from '../src/core/lanes.ts'
import { SHAPE_DEFS } from '../src/core/look.ts'
import type { LineStyle } from '../src/core/model.ts'
import { depthIn, lineEnds } from '../ui/src/graph.ts'
import { clip, placeLabels, SAMPLE } from '../ui/src/labels.ts'
import type { LabelItem } from '../ui/src/labels.ts'
import { createLaneStore } from '../ui/src/lanes.ts'
import type { LaneEnd } from '../ui/src/lanes.ts'

// Curved and right-angled lanes (src/core/lanes.ts, spec 2.4): the formulas by hand, the places they fall back to straight lanes, and what must hold whatever the shapes and the pose.

const STYLES: LineStyle[] = ['straight', 'curved', 'angled']
const ROUTED: LineStyle[] = ['curved', 'angled']

/** A box `width` by `height` whose centre is (cx, cy), with the outline of a shape. */
const box = (id: string, cx: number, cy: number, edge: Outline = [], width = 200, height = 72): LaneBox => ({ id, rect: { x: cx - width / 2, y: cy - height / 2, width, height }, edge })
const slot = (lane: number, lanes: number, back: number): Slot => ({ lane, lanes, back })

/** The lanes of a pair as the lane store asks for them: `ways` lists the lanes in order, true for one that runs from the later id to the earlier. */
function bundle(a: LaneBox, b: LaneBox, ways: boolean[], pose: Pose = REST, style: LineStyle = 'curved') {
  const back = ways.filter(w => w).length
  return ways.map((backwards, lane) => laneGeometry(backwards ? b : a, backwards ? a : b, slot(lane, ways.length, back), pose, style))
}
const forward = (n: number) => Array.from({ length: n }, () => false)

test('the worked example of a staircase: S (0, 0), T (100, 50), the middle at 50, the third of three lanes 10 apart', () => {
  // Two boxes whose facing sides meet at (0, 0) and (100, 50), 40 high so that three lanes are 10 apart (the room across is 20, less the margin of 10 each side).
  const a: LaneBox = { id: 'a', rect: { x: -100, y: -20, width: 100, height: 40 }, edge: [] }
  const b: LaneBox = { id: 'b', rect: { x: 100, y: 30, width: 100, height: 40 }, edge: [] }
  assert.deepEqual(ports(a.rect, b.rect), { from: { x: 0, y: 0 }, fromSide: 'right', to: { x: 100, y: 50 }, toSide: 'left' })
  assert.equal(pitchFor(roomOf(a, b, 'angled'), slot(0, 3, 0)), 10)
  const [first, middle, last] = bundle(a, b, forward(3), REST, 'angled')
  // The lane 10 to the lower left: out of (0, 10), across to 40, down to 60 and across to (100, 60). Its first corner is inside the turn (radius 6), its second outside it (25, all the run allows).
  assert.equal(last.path, 'M0 10L34 10Q40 10 40 16L40 35Q40 60 65 60L100 60')
  assert.deepEqual([last.x, last.y], [40, 35])
  assert.equal(middle.path, 'M0 0L34 0Q50 0 50 16L50 34Q50 50 66 50L100 50')
  assert.equal(first.path, 'M0 -10L35 -10Q60 -10 60 15L60 34Q60 40 66 40L100 40')
  // The corners are the corners of the spec: (40, 10) and (40, 60) for the third lane.
  assert.ok(last.path.includes('Q40 10 ') && last.path.includes('Q40 60 '))
})

test('the worked example of a curve: boxes 400 apart on one level, one lane each way, 9 above and below the line between the centres', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const [back, there] = bundle(a, b, [true, false])
  assert.equal(there.path, 'M100 9C200 9 200 9 300 9')
  assert.equal(back.path, 'M300 -9C200 -9 200 -9 100 -9')
  assert.deepEqual([there.x, there.y, back.x, back.y], [200, 9, 200, -9])
  // The head is at the end of the path whichever way the lane runs.
  assert.deepEqual(endsOfPath(back.path)?.end, { x: 100, y: -9 })
  assert.deepEqual(endsOfPath(there.path)?.end, { x: 300, y: 9 })
  assert.deepEqual(endsOfPath(there.path)?.endDir, { x: 1, y: 0 })
})

test('a curve is the curve of a lone line moved along the sides by the offset times kappa, so the lanes are a pitch apart across the curve in the middle', () => {
  // One box 80 lower than the other: the curve leaves at (100, 0), arrives at (300, 80), and runs (150, 120) / |...| = 0.781 along the way out in the middle.
  const [a, b] = [box('a', 0, 0), box('b', 400, 80)]
  const kappa = Math.sqrt(200 * 200 + 4 * 80 * 80) / 200 // 1 / |m|, below the cap of 1.3
  assert.ok(kappa < KAPPA_MAX)
  const lanes = bundle(a, b, forward(3))
  lanes.forEach((lane, k) => {
    const d = round3((k - 1) * PITCH * kappa)
    assert.equal(lane.path.split('C')[0], `M100 ${d}`)
    assert.match(lane.path, new RegExp(` 300 ${round3(80 + d)}$`))
  })
  // Across the curve, in the middle, the neighbours are a pitch apart (the tangent in the middle is (150, 120) over its length).
  const [m0, m1] = [lanes[0], lanes[1]]
  const [tx, ty] = [150, 120]
  const across = Math.abs((m1.x - m0.x) * ty - (m1.y - m0.y) * tx) / Math.sqrt(tx * tx + ty * ty)
  assert.ok(Math.abs(across - PITCH) < 0.01, `${across}`)
  // Where the curve is steeper than the cap allows for, kappa stays at the cap: 140 lower (gap 200, |m| = 0.58): 1 / 0.58 = 1.7 > 1.3.
  const steep = bundle(box('a', 0, 0), box('b', 400, 140), forward(3))
  assert.equal(steep[2].path.split('C')[0], `M100 ${round3(PITCH * KAPPA_MAX)}`)
})

test('a staircase moves its run across the legs by the offset, the other way from the legs, and the lanes never get nearer than a pitch', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 80)]
  const lanes = bundle(a, b, forward(3), REST, 'angled')
  // Run at x = 200 - offset for the lane at y = offset (the way the route goes: right and down).
  lanes.forEach((lane, k) => {
    const d = (k - 1) * PITCH
    assert.equal(lane.x, 200 - d)
    assert.equal(lane.y, round3(40 + d))
    assert.ok(lane.path.startsWith(`M100 ${d}L`))
    assert.ok(lane.path.endsWith(`L300 ${80 + d}`))
  })
  // Going the other way (up and to the left) puts the lanes on the same side of the line between the centres: the lane at the larger offset is still the lower one at its ends.
  const up = bundle(box('a', 0, 0), box('b', -400, -80), forward(3), REST, 'angled')
  up.forEach((lane, k) => assert.ok(lane.path.startsWith(`M-100 ${-(k - 1) * PITCH}L`), lane.path))
})

test('where the sides do not face each other with room between them, or a flat curve would put the lanes on top of one another, the lanes are straight', () => {
  const same = (a: LaneBox, b: LaneBox, style: LineStyle, why: string) => {
    for (const ways of [forward(2), forward(3), [true, false, false]]) {
      const [made, straight] = [bundle(a, b, ways, REST, style), bundle(a, b, ways, REST, 'straight')]
      assert.deepEqual(made.map(l => l.path), straight.map(l => l.path), `${style}: ${why}`)
    }
  }
  for (const style of ROUTED) {
    same(box('a', 0, 0), box('b', 150, 0), style, 'overlapping boxes')
    same(box('a', 0, 0), box('b', 200 + MIN_ROUTE_GAP - 1, 0), style, 'less than the least gap between the sides')
    same(box('a', 0, 0), box('b', 0, 0), style, 'at one spot')
  }
  same(box('a', 0, 0), box('b', 400, 12), 'angled', 'a staircase with a run shorter than the least')
  same(box('a', 0, 0), box('b', 400, ANGLE_RUN - 1), 'angled', 'a staircase with a run shorter than the least')
  same(box('a', 0, 0), box('b', 330, 230), 'curved', 'a curve that runs along the sides in the middle')
  // And the least of each is the least: a curve and a staircase are drawn at the limits.
  assert.notEqual(bundle(box('a', 0, 0), box('b', 200 + MIN_ROUTE_GAP, 0), forward(2), REST, 'curved')[0].path, bundle(box('a', 0, 0), box('b', 200 + MIN_ROUTE_GAP, 0), forward(2), REST, 'straight')[0].path)
  assert.ok(bundle(box('a', 0, 0), box('b', 400, ANGLE_RUN), forward(2), REST, 'angled')[0].path.includes('Q'))
  // A curve whose middle runs at the least a share of the way out (GAP_LEAST over the cap) is a curve; with a little less it is straight.
  // 40 between the sides: the curve is level with the sides in the middle at 4 * rise^2 = gap^2 * (1 / m^2 - 1), with m = GAP_LEAST / KAPPA_MAX the least share of it along the way out.
  const flat = (rise: number) => bundle(box('a', 0, 0), box('b', 240, rise), forward(2), REST, 'curved')[0].path.includes('C')
  const m = GAP_LEAST / KAPPA_MAX
  const rise = (40 * Math.sqrt(1 / (m * m) - 1)) / 2
  assert.ok(rise < 0.36 * 240, 'the sides still face left and right there')
  assert.equal(flat(Math.floor(rise) - 1), true)
  assert.equal(flat(Math.ceil(rise) + 1), false)
})

test('a pair of one line is drawn exactly as the browser always drew it, in the three styles, whether or not it is a back lane', () => {
  const sides = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }
  const drawn = (style: LineStyle, a: LaneEnd, b: LaneEnd) => {
    if (style === 'straight') {
      const [from, to] = lineEnds(a.rect, b.rect, a.edge, b.edge)
      return getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    }
    const p = ports(a.rect, b.rect, a.edge, b.edge)
    const ends = { sourceX: p.from.x, sourceY: p.from.y, sourcePosition: sides[p.fromSide], targetX: p.to.x, targetY: p.to.y, targetPosition: sides[p.toSide] }
    return style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  }
  const store = createLaneStore()
  const shapes = [[], SHAPE_DEFS.diamond.edge, SHAPE_DEFS.ellipse.edge, SHAPE_DEFS.hexagon.edge]
  const spots: [number, number][] = [[400, 0], [0, 300], [330, 190], [400, 80], [-250, -180], [150, 0], [400, 12], [230, 20]]
  for (const style of STYLES) {
    for (const [x, y] of spots) {
      for (const edge of shapes) {
        const [a, b] = [box('a', 0, 0, edge), box('b', x, y, edge)]
        for (const [from, to] of [[a, b], [b, a]]) {
          const [path, lx, ly] = drawn(style, from, to)
          for (const lone of [slot(0, 1, 0), slot(0, 1, 1)]) {
            const lane = store.laneFor(`${from.id}|${to.id}`, style, from, to, REST, lone)
            assert.deepEqual([lane.path, lane.x, lane.y], [path, lx, ly], `${style} ${from.id}>${to.id} at ${x},${y}`)
            assert.deepEqual([store.laneFor(`${from.id}|${to.id}|p`, style, from, to, SPREAD, lone).path], [path])
          }
        }
      }
    }
  }
})

test('a lane runs the same way whichever shape it starts at: the other lane\'s points, the other way round', () => {
  const [a, b] = [box('a', 0, 0, SHAPE_DEFS.diamond.edge), box('b', 400, 110, SHAPE_DEFS.ellipse.edge)]
  for (const style of ROUTED) {
    for (const pose of [REST, SPREAD, { s: 0, lam: [0, 1, 0] }]) {
      for (let lane = 0; lane < 3; lane++) {
        const [there, back] = [laneGeometry(a, b, slot(lane, 3, 0), pose, style), laneGeometry(b, a, slot(lane, 3, 0), pose, style)]
        assert.deepEqual(back.points, [...there.points].reverse(), `${style} lane ${lane}`)
        assert.deepEqual([back.x, back.y], [there.x, there.y])
        assert.deepEqual(endsOfPath(back.path)?.end, there.points[0])
        assert.deepEqual(endsOfPath(there.path)?.end, there.points.at(-1))
      }
    }
  }
})

test('the head of a lane points the way out of the side, on a shape whose outline is not straight across it', () => {
  // A diamond's side is a point: lanes off its middle meet the outline further in, and a short straight stub takes the lane out to where the curve starts.
  const [a, b] = [box('a', 0, 0, SHAPE_DEFS.diamond.edge), box('b', 400, 0, SHAPE_DEFS.ellipse.edge)]
  for (const style of ROUTED) {
    const lanes = bundle(a, b, forward(3), REST, style)
    for (const lane of lanes) {
      const ends = endsOfPath(lane.path)!
      assert.deepEqual([ends.startDir, ends.endDir], [{ x: -1, y: 0 }, { x: 1, y: 0 }], style)
      for (const p of [ends.start, ends.end]) assert.ok(Math.min(Math.abs(depthIn(a.rect, a.edge, p.x, p.y)), Math.abs(depthIn(b.rect, b.edge, p.x, p.y))) < 0.01, `${style} ${p.x},${p.y}`)
    }
  }
  // On a rectangle there is no stub at all: the path starts where the curve does.
  const rect = bundle(box('a', 0, 0), box('b', 400, 80), forward(3), REST, 'curved')
  assert.ok(rect.every(l => !l.path.includes('L')))
})

test('the room across the lanes is measured along the sides the lanes are moved along', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 120)]
  // The line between the centres is tilted, so across it a box is a little more than half its height; along the sides it is exactly half.
  assert.ok(Math.abs(roomOf(a, b, 'straight') - 36 / (400 / Math.sqrt(400 * 400 + 120 * 120))) < 0.01)
  assert.equal(roomOf(a, b, 'curved'), 36)
  assert.equal(roomOf(a, b, 'angled'), 36)
  assert.equal(roomOf(a, b), roomOf(a, b, 'straight'))
  // Where the pair falls back to straight lanes the room is the straight room.
  assert.equal(roomOf(box('a', 0, 0), box('b', 150, 0), 'curved'), roomOf(box('a', 0, 0), box('b', 150, 0)))
})

test('lanes stay inside the room: the outermost lane of a crowded pair is on its side, however steep the curve', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 100)]
  const lanes = bundle(a, b, forward(9))
  for (const lane of lanes) {
    const [p, q] = [lane.points[0], lane.points.at(-1)!]
    assert.ok(Math.abs(depthIn(a.rect, [], p.x, p.y)) < 0.01 && Math.abs(depthIn(b.rect, [], q.x, q.y)) < 0.01)
    assert.ok(p.y > a.rect.y + 1 && p.y < a.rect.y + a.rect.height - 1)
  }
})

test('spread and parted pairs put the middle where the spec says: a 22 pitch when spread, and a pitch plus 18 beside a lit lane', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  // On one level a curve is a straight run, so its anchors are the lanes' middles.
  const spread = bundle(a, b, forward(3), SPREAD)
  assert.deepEqual(spread.map(l => l.y), [-22, 0, 22])
  const parted = bundle(a, b, forward(3), { s: 0, lam: [0, 1, 0] })
  assert.deepEqual(parted.map(l => l.y), [-30, 0, 30])
  // The ends do not move.
  const rest = bundle(a, b, forward(3))
  parted.forEach((lane, k) => assert.deepEqual([lane.points[0], lane.points.at(-1)], [rest[k].points[0], rest[k].points.at(-1)]))
  // A staircase moves its run: the lit lane's neighbours are 30 away in the run, and the legs are where they were.
  const [c, d] = [box('a', 0, 0), box('b', 400, 80)]
  const stairs = bundle(c, d, forward(3), { s: 0, lam: [0, 1, 0] }, 'angled')
  assert.deepEqual(stairs.map(l => l.x), [230, 200, 170])
  const stairsRest = bundle(c, d, forward(3), REST, 'angled')
  stairs.forEach((lane, k) => {
    assert.ok(lane.path.startsWith(`M100 ${(k - 1) * 12}L`))
    assert.ok(lane.path.endsWith(`L300 ${80 + (k - 1) * 12}`))
    assert.equal(lane.y, stairsRest[k].y) // the run stays at the middle height, it only moves across
  })
  const spreadStairs = bundle(c, d, forward(3), SPREAD, 'angled')
  assert.deepEqual(spreadStairs.map(l => l.x), [200 + 22, 200, 200 - 22])
})

test('the run of a staircase is squeezed to fit the legs when the shapes are near, and the lanes keep their order', () => {
  const [a, b] = [box('a', 0, 0), box('b', 200 + 60, 80)] // 60 between the sides: legs of 30, room for runs 24 from the middle
  const lanes = bundle(a, b, forward(8), REST, 'angled')
  const runs = lanes.map(l => l.x)
  for (let k = 0; k + 1 < runs.length; k++) assert.ok(runs[k] > runs[k + 1], `run ${k} is right of run ${k + 1}`)
  for (const x of runs) assert.ok(x >= 100 + 6 - 0.001 && x <= 160 - 6 + 0.001, `${x} is on the leg`)
  // With room they are a pitch apart.
  const roomy = bundle(box('a', 0, 0), box('b', 500, 80), forward(8), REST, 'angled').map(l => l.x)
  for (let k = 0; k + 1 < roomy.length; k++) assert.ok(Math.abs(roomy[k] - roomy[k + 1] - pitchFor(36, slot(0, 8, 0))) < 0.001)
})

test('the gaps beside a lit lane and the reach of a bundle follow the pitch of the style', () => {
  // On a pair a little off the level the room across is the room along the sides (36), not the room across the line between the centres, so the pitch of 9 lanes is not the same.
  const [a, b] = [box('a', 0, 0), box('b', 400, 120)]
  const pitchOf = (style: LineStyle) => pitchFor(roomOf(a, b, style), slot(0, 9, 0))
  assert.notEqual(pitchOf('straight'), pitchOf('curved'))
  assert.equal(gapBeside(a, b, slot(4, 9, 0), REST, 0, 'curved'), round3(pitchOf('curved')))
  assert.equal(gapBeside(a, b, slot(4, 9, 0), REST, 0), round3(pitchOf('straight')))
  assert.equal(bundleReach(a, b, slot(4, 9, 0), 'curved'), round3(4 * pitchOf('curved') + Math.min(18, 0.2 * Math.sqrt(400 * 400 + 120 * 120))))
  assert.equal(gapBeside(a, b, slot(0, 1, 0), REST, 0.5, 'angled'), Infinity)
})

/** The two segments cross, not counting a shared end. */
function crosses(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const side = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  const [d1, d2, d3, d4] = [side(p3, p4, p1), side(p3, p4, p2), side(p1, p2, p3), side(p1, p2, p4)]
  return d1 * d2 < 0 && d3 * d4 < 0
}

const OUTLINES: Outline[] = [[], SHAPE_DEFS.diamond.edge, SHAPE_DEFS.ellipse.edge, SHAPE_DEFS.hexagon.edge, SHAPE_DEFS.pill.edge, SHAPE_DEFS.cloud.edge, SHAPE_DEFS.cylinder.edge]

test('seeded property: curved and angled lanes never cross at any pose, their ends are on the outlines and do not move, and they keep their order', () => {
  const routed: Record<string, number> = { curved: 0, angled: 0 }
  const lam = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 0, maxLength: 9 })
  fc.assert(fc.property(
    fc.integer({ min: 0, max: OUTLINES.length - 1 }), fc.integer({ min: 0, max: OUTLINES.length - 1 }),
    fc.integer({ min: -700, max: 700 }), fc.integer({ min: -500, max: 500 }),
    fc.integer({ min: 2, max: 9 }), fc.integer({ min: 0, max: 9 }),
    fc.double({ min: 0, max: 1, noNaN: true }), lam, fc.constantFrom(...ROUTED),
    (ia, ib, x, y, lanes, backs, s, lit, style) => {
      // Shapes that overlap have no lanes to speak of.
      if (Math.abs(x) < 260 && Math.abs(y) < 120) return
      const [a, b] = [box('a', 0, 0, OUTLINES[ia]), box('b', x, y, OUTLINES[ib])]
      const back = Math.min(backs, lanes)
      const ways = Array.from({ length: lanes }, (_, lane) => lane < back)
      const poses: Pose[] = [REST, SPREAD, { s, lam: lit.slice(0, lanes) }]
      const rest = bundle(a, b, ways, REST, style)
      if (rest[0].path !== bundle(a, b, ways, REST, 'straight')[0].path) routed[style]++
      for (const pose of poses) {
        const drawn = bundle(a, b, ways, pose, style)
        drawn.forEach((lane, k) => {
          const [start, end] = [lane.points[0], lane.points.at(-1)!]
          for (const p of [start, end]) assert.ok(Math.min(Math.abs(depthIn(a.rect, a.edge, p.x, p.y)), Math.abs(depthIn(b.rect, b.edge, p.x, p.y))) < 0.01, `end ${p.x},${p.y} off the outline`)
          assert.deepEqual([start, end], [rest[k].points[0], rest[k].points.at(-1)], 'the ends do not move')
          // The anchor is on the lane.
          assert.ok(nearestDistance(lane.points, { x: lane.x, y: lane.y }) < 0.6, `anchor ${lane.x},${lane.y} off lane ${k}`)
        })
        for (let i = 0; i < drawn.length; i++) {
          for (let j = i + 1; j < drawn.length; j++) {
            const [p, q] = [drawn[i].points, drawn[j].points]
            for (let k = 0; k + 1 < p.length; k++) for (let m = 0; m + 1 < q.length; m++) assert.ok(!crosses(p[k], p[k + 1], q[m], q[m + 1]), `${style}: lanes ${i} and ${j} cross`)
          }
        }
      }
    },
  ), { seed: 20261104, numRuns: 500 })
  // The property is not vacuous: a good share of the pairs had a curve or a staircase to run along.
  assert.ok(routed.curved > 40 && routed.angled > 40, JSON.stringify(routed))
})

test('seeded property: the lanes of a curve are never nearer one another than GAP_LEAST of a pitch across it, nor further apart than KAPPA_MAX', () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: OUTLINES.length - 1 }), fc.integer({ min: 0, max: OUTLINES.length - 1 }), fc.integer({ min: 260, max: 700 }), fc.integer({ min: -300, max: 300 }), fc.integer({ min: 2, max: 9 }),
    (ia, ib, x, y, lanes) => {
      const [a, b] = [box('a', 0, 0, OUTLINES[ia]), box('b', x, y, OUTLINES[ib])]
      const drawn = bundle(a, b, forward(lanes), REST, 'curved')
      if (drawn[0].path === bundle(a, b, forward(lanes), REST, 'straight')[0].path) return
      const pitch = pitchFor(roomOf(a, b, 'curved'), slot(0, lanes, 0))
      for (let k = 0; k + 1 < lanes; k++) {
        // Not near the ends, where the lanes are on the outlines (and a stub may be).
        const samples = drawn[k].points.slice(3, -3)
        for (const p of samples) {
          const gap = nearestDistance(drawn[k + 1].points, p)
          assert.ok(gap >= GAP_LEAST * pitch * 0.95 - 0.01 && gap <= KAPPA_MAX * pitch * 1.01 + 0.01, `lanes ${k} and ${k + 1} are ${gap} apart, pitch ${pitch}`)
        }
      }
    },
  ), { seed: 20261106, numRuns: 300 })
})

/** The distance from `at` to the polyline. */
function nearestDistance(points: readonly Point[], at: Point): number {
  let best = Infinity
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]]
    const [dx, dy] = [q.x - p.x, q.y - p.y]
    const length = dx * dx + dy * dy
    const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - p.x) * dx + (at.y - p.y) * dy) / length))
    best = Math.min(best, Math.sqrt((at.x - p.x - dx * along) ** 2 + (at.y - p.y - dy * along) ** 2))
  }
  return best
}

test('the lanes of a routed pair are in the order of their places: the one with the larger place is further to the right of the way from the earlier id to the later', () => {
  fc.assert(fc.property(
    fc.integer({ min: 260, max: 700 }), fc.integer({ min: -300, max: 300 }), fc.integer({ min: 2, max: 8 }), fc.constantFrom(...ROUTED), fc.boolean(),
    (x, y, lanes, style, swap) => {
      const [from, to] = swap ? [box('a', x, y), box('b', 0, 0)] : [box('a', 0, 0), box('b', x, y)]
      const drawn = bundle(from, to, forward(lanes), REST, style)
      // Left to right along the way from the earlier id to the later: the cross product of that way with the vector between two anchors is positive.
      const u = { x: to.rect.x + to.rect.width / 2 - from.rect.x - from.rect.width / 2, y: to.rect.y + to.rect.height / 2 - from.rect.y - from.rect.height / 2 }
      for (let k = 0; k + 1 < drawn.length; k++) {
        const v = { x: drawn[k + 1].x - drawn[k].x, y: drawn[k + 1].y - drawn[k].y }
        assert.ok(u.x * v.y - u.y * v.x > 0, `lane ${k + 1} is on the right of lane ${k}`)
      }
    },
  ), { seed: 20261105, numRuns: 200 })
})

test('the label of a lane is on its lane, and the labels of a pair in the three poses are placed clear of the lanes beside', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 80)]
  for (const style of ROUTED) {
    for (const pose of [REST, SPREAD, { s: 0, lam: [0, 1, 0] }]) {
      const drawn = bundle(a, b, forward(3), pose, style)
      const items: LabelItem[] = drawn.map((l, i) => ({
        id: `l${i}`, path: l.path, mid: { x: l.x, y: l.y }, chars: clip('x'.repeat(10)).length, pinned: pose.lam.length > 0 && i === 1,
        across: drawn.filter((_, k) => k !== i).map(o => o.points), extra: SAMPLE,
      }))
      const spots = placeLabels(items, [a.rect, b.rect])
      drawn.forEach((lane, i) => {
        assert.ok(nearestDistance(lane.points, { x: lane.x, y: lane.y }) < 0.6, `${style}: the anchor of lane ${i} is on it`)
        const spot = spots.get(`l${i}`)!
        // A label slides along its own lane and no further, so it is near it.
        assert.ok(nearestDistance(lane.points, spot) < 1, `${style}: label ${i} at ${spot.x},${spot.y} is on its lane`)
      })
    }
  }
})

test('the pointer means the nearest lane of a curved or staircase pair', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 80)]
  for (const style of ROUTED) {
    for (const pose of [REST, SPREAD]) {
      const drawn = bundle(a, b, forward(3), pose, style)
      const lanes: HitLane[] = drawn.map((l, lane) => ({ id: `l${lane}`, pair: 'p', lane, points: l.points }))
      // On the middle of each lane (its anchor) the pointer means it; two pitches away from the pair it means none.
      drawn.forEach((l, lane) => assert.equal(nearestStrand(lanes, { x: l.x, y: l.y }), `l${lane}`, `${style} lane ${lane}`))
      assert.equal(nearestStrand(lanes, { x: drawn[1].x, y: drawn[1].y - 120 }), undefined)
    }
  }
})

test('a lane has 24 samples between its ends, plus a stub at an end that is not on a straight side; the anchor is the middle sample of a lane that is displaced', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 80)]
  const rest = bundle(a, b, forward(3), REST, 'curved')
  for (const lane of rest) assert.equal(lane.points.length, SAMPLES + 1)
  const parted = bundle(a, b, forward(3), { s: 0, lam: [0, 1, 0] }, 'curved')
  parted.forEach(lane => assert.deepEqual([lane.x, lane.y], [lane.points[SAMPLES / 2].x, lane.points[SAMPLES / 2].y]))
  const outlined = bundle(box('a', 0, 0, SHAPE_DEFS.diamond.edge), box('b', 400, 0, SHAPE_DEFS.diamond.edge), forward(3), REST, 'curved')
  assert.equal(outlined[1].points.length, SAMPLES + 1) // the middle lane is on the vertex: no stub; the others have a stub at each end
  assert.equal(outlined[0].points.length, SAMPLES + 3)
  assert.equal(outlined[2].points.length, SAMPLES + 3)
})
