import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { beatsFor, partOf, PART_LEAD, PART_MS, travelMs } from '../src/core/animation.ts'
import type { Animation } from '../src/core/animation.ts'
import {
  bundleReach, dashPhase, displacement, gapBeside, JUMP_MS, KIN_OPACITY, laneGeometry, LIT_FLOOR_LANES, litLanes, markReach, partEase, partingFor, PART_CLEAR, PITCH, poseAt, REST, round3, SHIFT_MS,
} from '../src/core/lanes.ts'
import type { LaneBox, Parting, Pose, Slot } from '../src/core/lanes.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { strandOf } from '../src/core/strands.ts'
import { computeView } from '../src/core/views.ts'
import { PlayerClock } from '../ui/src/clock.ts'
import { toGraph } from '../ui/src/graph.ts'
import { litOpacity, LIT_FLOOR, markerSpot } from '../ui/src/motion.ts'
import { createPartStore, NO_PLANS, planOf, STEPS } from '../ui/src/parts.ts'
import type { PartPlan } from '../ui/src/parts.ts'

// The lines of a pair side by side while a flow plays on them: the beat that opens them, the pose as a pure function of the player's clock, what stays clear of what, and how much
// each line fades.

const box = (id: string, cx: number, cy: number): LaneBox => ({ id, rect: { x: cx - 100, y: cy - 36, width: 200, height: 72 }, edge: [] })
const [A, B] = [box('a', 0, 0), box('b', 400, 0)]
const slot = (lane: number, lanes: number, back = 0): Slot => ({ lane, lanes, back })
/** The middle point of every lane of a horizontal pair of `lanes` lines, all running from a to b, in `pose`. */
const middles = (lanes: number, pose: Pose, a = A, b = B) => Array.from({ length: lanes }, (_, lane) => { const { x, y } = laneGeometry(a, b, slot(lane, lanes), pose); return { x, y } })

const CALL: Animation = { kind: 'call', trigger: 'inside' }

// -- the beat ---------------------------------------------------------------------------------------------------------------------------------------------------------------

test('a step on a pair of several lines has a part beat after the tube; on a lone line it has none, and nothing else moves', () => {
  for (const a of [CALL, { kind: 'send' }, { kind: 'event' }, { kind: 'call', outcome: 'rejected' }, { kind: 'call', outcome: 'timeout' }, { kind: 'send', outcome: 'lost', share: 30 }] as Animation[]) {
    const alone = beatsFor(a, { length: 250, afterLanding: false })
    for (const lanes of [undefined, 0, 1]) {
      const same = beatsFor(a, { length: 250, afterLanding: false, ...(lanes === undefined ? {} : { lanes }) })
      assert.deepEqual(same, alone, `${a.kind}: no part with ${lanes ?? 'no'} lanes`)
    }
    assert.equal(alone.beats.some(b => b.do === 'part'), false)
    const among = beatsFor(a, { length: 250, afterLanding: false, lanes: 3 })
    // The part beat is the only difference, it follows the tube (and the marker, if any), and the step lasts as long as it did.
    assert.deepEqual(among.beats.filter(b => b.do !== 'part'), alone.beats)
    assert.equal(among.total, alone.total)
    assert.equal(among.beats.filter(b => b.do === 'part').length, 1)
    assert.equal(among.beats[0].do, 'pipe')
    assert.ok(among.beats.findIndex(b => b.do === 'part') > 0)
  }
})

test('the lines part 250 ms before the first dot leaves, or at once, and take 225 ms', () => {
  const part = (a: Animation, afterLanding = false) => partOf(beatsFor(a, { length: 250, afterLanding, lanes: 3 }).beats)
  assert.equal(PART_MS, 225)
  assert.equal(PART_LEAD, 250)
  // Send, call and event: the dot leaves 250 ms in, so the lines are parting from the first moment.
  for (const kind of ['send', 'call', 'event'] as const) assert.deepEqual(part({ kind, trigger: 'inside' }), { at: 0, dur: 225 })
  // A callback: the dot leaves at 450 ms (set off inside), 300 (outside, just kicked by the step before) or 850 (a bolt falls first, 600 ms), so the lines open with the flash.
  assert.deepEqual(part({ kind: 'callback', trigger: 'inside' }), { at: 200, dur: 225 })
  assert.deepEqual(part({ kind: 'callback', trigger: 'outside' }, true), { at: 50, dur: 225 })
  assert.deepEqual(part({ kind: 'callback', trigger: 'outside' }), { at: 600, dur: 225 })
  // A burst opens them once, for the whole step.
  const burst = beatsFor({ kind: 'call', trigger: 'inside', outcome: 'rejected', share: 30 }, { length: 250, afterLanding: false, lanes: 3 }).beats
  assert.equal(burst.filter(b => b.do === 'part').length, 1)
  assert.deepEqual(partOf(burst), { at: 0, dur: 225 })
  // The lines are open before the first dot leaves, whatever the step: the dot starts at least PART_MS after the part does.
  for (const a of [CALL, { kind: 'callback', trigger: 'outside' }, { kind: 'callback', trigger: 'inside' }, { kind: 'event' }] as Animation[]) {
    const { beats } = beatsFor(a, { length: 250, afterLanding: false, lanes: 2 })
    const first = Math.min(...beats.filter(b => b.do === 'blob').map(b => b.at))
    const found = partOf(beats)!
    assert.ok(found.at + found.dur <= first, `${a.kind}: parted by the time the dot leaves`)
  }
})

test('a recursion is a loop on one shape: it has no pair to part, whatever the lanes', () => {
  assert.equal(partOf(beatsFor({ kind: 'recurse', trigger: 'inside', depth: 3 }, { length: 250, afterLanding: false, lanes: 4 }).beats), undefined)
})

test('the beats do not depend on the length of the line, with lanes either', () => {
  const kinds = (length: number) => beatsFor(CALL, { length, afterLanding: false, lanes: 3 }).beats.map(b => b.do)
  assert.deepEqual(kinds(0), kinds(1000))
  assert.deepEqual(partOf(beatsFor(CALL, { length: 0, afterLanding: false, lanes: 3 }).beats), partOf(beatsFor(CALL, { length: 1000, afterLanding: false, lanes: 3 }).beats))
  // Parting does not change how long a step takes: travel is measured on the rest lengths.
  assert.equal(beatsFor(CALL, { length: 400, afterLanding: false, lanes: 3 }).total, 550 + 2 * travelMs(400) + 600)
})

// -- the pose ---------------------------------------------------------------------------------------------------------------------------------------------------------------

test('the pose is a pure function of the clock: before the beat, the pose before; after it, the pose it opens; on the way, the ease between', () => {
  const opens: Parting = { from: [0, 0, 0], to: [0, 1, 0], at: 100, dur: 225, ease: 'out' }
  assert.equal(poseAt(opens, -50), REST)
  assert.equal(poseAt(opens, 100), REST)
  assert.deepEqual(poseAt(opens, 100 + 225 / 2), { s: 0, lam: [0, 0.875, 0] }) // 1 - (1 - 0.5)^3
  assert.deepEqual(poseAt(opens, 325), { s: 0, lam: [0, 1, 0] })
  assert.deepEqual(poseAt(opens, 100000), { s: 0, lam: [0, 1, 0] }) // held until the stop is left, through the rests of a repeat
  // The same clock gives the same pose, whoever asks and in whatever order.
  const first = [50, 200, 120, 400].map(t => poseAt(opens, t))
  assert.deepEqual([50, 200, 120, 400].map(t => poseAt(opens, t)), first)
  // From one lit lane to another: the smoothstep, nothing closes between them.
  const shifts: Parting = { from: [0, 1, 0], to: [0, 0, 1], at: 0, dur: SHIFT_MS, ease: 'smooth' }
  assert.deepEqual(poseAt(shifts, SHIFT_MS / 2), { s: 0, lam: [0, 0.5, 0.5] })
  assert.deepEqual(poseAt(shifts, 0), { s: 0, lam: [0, 1, 0] })
  // Back to rest: lands on the rest pose itself.
  assert.equal(poseAt({ from: [0, 1, 0], to: [0, 0, 0], at: 0, dur: SHIFT_MS, ease: 'smooth' }, SHIFT_MS), REST)
  // A pose is never spread: a step playing on a pair wins over its selection.
  assert.ok([0, 40, 100, 225].every(t => poseAt(opens, t + 100).s === 0))
})

test('the eases: out is fast then slow, smooth is slow at both ends, both reach 0 and 1', () => {
  for (const kind of ['out', 'smooth'] as const) {
    assert.equal(partEase(kind, 0), 0)
    assert.equal(partEase(kind, 1), 1)
  }
  assert.equal(partEase('out', 0.5), 0.875)
  assert.equal(partEase('smooth', 0.5), 0.5)
  assert.ok(partEase('out', 0.2) > 0.4 && partEase('smooth', 0.2) < 0.2)
})

test('how a stop changes the pose: a first parting at the beat, a shift or a close at the start, a jump from where it is', () => {
  const beat = { at: 200, dur: 225 }
  assert.deepEqual(partingFor([0, 0, 0], [0, 1, 0], { beat }), { from: [0, 0, 0], to: [0, 1, 0], at: 200, dur: 225, ease: 'out' })
  assert.deepEqual(partingFor([0, 0, 0], [0, 1, 0]), { from: [0, 0, 0], to: [0, 1, 0], at: 0, dur: 225, ease: 'out' }) // a step with no motion parts at once
  assert.deepEqual(partingFor([0, 1, 0], [0, 0, 1], { beat }), { from: [0, 1, 0], to: [0, 0, 1], at: 0, dur: SHIFT_MS, ease: 'smooth' }) // next step on the same pair: no gap, no beat
  assert.deepEqual(partingFor([0, 1, 0], [0, 0, 0], { beat }), { from: [0, 1, 0], to: [0, 0, 0], at: 0, dur: SHIFT_MS, ease: 'smooth' }) // the stop is left
  assert.deepEqual(partingFor([0, 0.4, 0], [0, 0, 1], { beat, jump: true }), { from: [0, 0.4, 0], to: [0, 0, 1], at: 0, dur: JUMP_MS, ease: 'out' }) // scrubbed across stops
  assert.equal(SHIFT_MS, 195)
  assert.equal(JUMP_MS, 225)
})

test('the lanes that a stop lights, by pair, one for each lane its steps ride, all at once', () => {
  const strands = (lanes: number, pair = 'a b') => Array.from({ length: lanes }, (_, lane) => ({ id: `${pair}|${lane}`, pair, from: 'a', to: 'b', label: '', connections: [lane], lane, lanes }))
  const all = [...strands(4), ...strands(1, 'c d'), ...strands(2, 'e f')]
  assert.deepEqual([...litLanes(all, ['a b|1'])], [['a b', [0, 1, 0, 0]]])
  assert.deepEqual([...litLanes(all, ['a b|0', 'a b|2', 'e f|1'])], [['a b', [1, 0, 1, 0]], ['e f', [0, 1]]]) // an event to several subscribers on one pair: every lit lane at once
  assert.deepEqual([...litLanes(all, ['c d|0'])], []) // a line alone has nothing to part
  assert.deepEqual([...litLanes(all, [])], [])
})

test('the ends never move, and nothing crosses, at any moment of a parting, for any number of lanes and any lit lane', () => {
  for (const [lanes, back] of [[2, 0], [3, 0], [3, 1], [5, 2], [8, 4]]) {
    for (let lit = 0; lit < lanes; lit++) {
      const lam = Array.from({ length: lanes }, (_, k) => (k === lit ? 1 : 0))
      const opens: Parting = { from: Array.from({ length: lanes }, () => 0), to: lam, at: 0, dur: 225, ease: 'out' }
      const rest = Array.from({ length: lanes }, (_, lane) => laneGeometry(lane < back ? B : A, lane < back ? A : B, slot(lane, lanes, back)))
      for (let t = 0; t <= 300; t += 15) {
        const pose = poseAt(opens, t)
        const parted = Array.from({ length: lanes }, (_, lane) => laneGeometry(lane < back ? B : A, lane < back ? A : B, slot(lane, lanes, back), pose))
        // The ends stay on the outline where they were at rest.
        parted.forEach((lane, k) => {
          assert.deepEqual(lane.points[0], rest[k].points[0])
          assert.deepEqual(lane.points[lane.points.length - 1], rest[k].points[rest[k].points.length - 1])
        })
        // The lanes keep their order all along: at every sample the lane k is nearer the left-hand side than lane k + 1.
        for (let i = 1; i < 24; i++) {
          const ys = parted.map(lane => (lane.points.length === 2 ? lane.points[0].y : lane.points[i].y))
          for (let k = 1; k < lanes; k++) assert.ok(ys[k] > ys[k - 1], `${lanes} lanes, lane ${lit} lit, t ${t}, sample ${i}: lane ${k} is below lane ${k - 1}`)
        }
      }
    }
  }
})

test('nothing crosses while the pair moves from one lit lane to another or closes', () => {
  const lanes = 5
  const lit = (k: number) => Array.from({ length: lanes }, (_, i) => (i === k ? 1 : 0))
  for (const [from, to] of [[1, 3], [3, 1], [0, 4], [2, 2]]) {
    const shift: Parting = { from: lit(from), to: lit(to), at: 0, dur: SHIFT_MS, ease: 'smooth' }
    for (let t = 0; t <= 200; t += 10) {
      const ys = middles(lanes, poseAt(shift, t)).map(p => p.y)
      for (let k = 1; k < lanes; k++) assert.ok(ys[k] > ys[k - 1], `from lane ${from} to ${to}, t ${t}: lane ${k} is below lane ${k - 1}`)
    }
  }
})

test('seeded property: at any moment of any parting the lanes keep their order and their ends, and a lit lane has its neighbours a fifth of the way further off once it is open', () => {
  fc.assert(fc.property(
    fc.integer({ min: 2, max: 8 }), fc.integer({ min: 0, max: 8 }), fc.integer({ min: 300, max: 900 }), fc.integer({ min: -300, max: 300 }),
    fc.boolean(), fc.integer({ min: 0, max: 7 }), fc.double({ min: 0, max: 1, noNaN: true }), fc.integer({ min: 0, max: 800 }),
    (lanes, backs, x, y, jump, litLane, before, beatAt) => {
      const back = Math.min(backs, lanes)
      const b = box('b', x, y)
      const lit = Array.from({ length: lanes }, (_, k) => (k === litLane % lanes ? 1 : 0))
      const from = Array.from({ length: lanes }, (_, k) => (k % 2 === 0 ? before : 0))
      const parting = partingFor(from, lit, { jump, beat: { at: beatAt, dur: 225 } })
      const lanesAt = (pose: Pose) => Array.from({ length: lanes }, (_, lane) => laneGeometry(lane < back ? b : A, lane < back ? A : b, slot(lane, lanes, back), pose))
      const rest = lanesAt(REST)
      for (let t = 0; t <= parting.at + parting.dur + 50; t += 25) {
        const parted = lanesAt(poseAt(parting, t))
        parted.forEach((lane, k) => {
          assert.deepEqual(lane.points[0], rest[k].points[0])
          assert.deepEqual(lane.points.at(-1), rest[k].points.at(-1))
        })
        // The lanes of a pair stay in their order along the normal: the anchor of lane k is nearer the pair's left than the anchor of lane k + 1 (measured across the line between the centres).
        const [dx, dy] = [x, y]
        const length = Math.sqrt(dx * dx + dy * dy)
        const across = parted.map(lane => (lane.x * -dy + lane.y * dx) / length)
        for (let k = 1; k < lanes; k++) assert.ok(across[k] > across[k - 1] - 1e-9, `lane ${k} crossed lane ${k - 1} at ${t} ms`)
      }
      // Settled, with one lit lane: it keeps its slot and its neighbours are `a` (a fifth of the way, 18 px at most) further off on each side in the middle.
      if (!jump && from.every(l => l === 0)) {
        const open = lanesAt(poseAt(parting, parting.at + parting.dur))
        const length = Math.sqrt(x * x + y * y)
        const across = open.map(lane => (lane.x * -y + lane.y * x) / length)
        const k = litLane % lanes
        const room = Math.min(18, 0.2 * length)
        const still = rest.map(lane => (lane.x * -y + lane.y * x) / length)
        // A pair that does not fit across the short sides squeezes its lanes closer than the pitch, so the gap is the lanes' own spacing plus `a`.
        for (const n of [k - 1, k + 1]) if (n >= 0 && n < lanes) assert.ok(Math.abs(across[n] - across[k]) >= Math.abs(still[n] - still[k]) + room - 0.01, `lane ${n} is only ${Math.abs(across[n] - across[k])} from the lit lane ${k}`)
      }
    },
  ), { seed: 20261104, numRuns: 150 })
})

test('beside a lit lane there are 30 px clear in the middle, 12 apart at the ends; two lit lanes side by side are 48 apart', () => {
  const lit = (...ks: number[]): Pose => ({ s: 0, lam: Array.from({ length: 5 }, (_, i) => (ks.includes(i) ? 1 : 0)) })
  const ys = (pose: Pose) => middles(5, pose).map(p => p.y)
  const [rest, parted] = [ys(REST), ys(lit(2))]
  assert.deepEqual(rest.map((y, k) => round3(y - (k === 0 ? 0 : rest[k - 1]))).slice(1), [12, 12, 12, 12])
  // Lane 2 is lit: it stays in its slot, the lanes either side move off by `a` = 18 (a fifth of the 400 px between the shapes, at most 18).
  assert.equal(parted[2], rest[2])
  assert.equal(round3(parted[2] - parted[1]), PART_CLEAR)
  assert.equal(round3(parted[3] - parted[2]), PART_CLEAR)
  assert.ok(round3(parted[2] - parted[1]) >= 28 && round3(parted[3] - parted[2]) >= 28)
  // The lanes beyond move with them, a pitch apart still.
  assert.equal(round3(parted[1] - parted[0]), 12)
  assert.equal(round3(parted[4] - parted[3]), 12)
  const two = ys(lit(1, 2))
  assert.equal(round3(two[2] - two[1]), PITCH + 2 * 18) // P + 2a
  // The gap function says the same, at the middle and near the ends.
  assert.equal(gapBeside(A, B, slot(2, 5), lit(2), 0.5), 30)
  assert.equal(gapBeside(A, B, slot(2, 5), lit(2), 0), 12)
  assert.equal(gapBeside(A, B, slot(2, 5), lit(2), 1), 12)
  assert.equal(gapBeside(A, B, slot(2, 5), REST, 0.5), 12)
  assert.equal(gapBeside(A, B, slot(0, 1), REST, 0.5), Infinity)
  assert.equal(PART_CLEAR, PITCH + 18)
})

test('the gap is a fifth of the way between the shapes, 18 px at most, so on a short pair it never reaches into them', () => {
  const lit: Pose = { s: 0, lam: [0, 1, 0] }
  assert.equal(displacement(slot(0, 3), lit, 60, 12), -12) // 0.2 * 60
  assert.equal(displacement(slot(2, 3), lit, 60, 12), 12)
  assert.equal(displacement(slot(1, 3), lit, 60, 12), 0) // the lit lane keeps its slot
  assert.equal(displacement(slot(0, 3), lit, 400, 12), -18)
  assert.equal(gapBeside(A, box('b', 400, 0), slot(1, 3), lit, 0.5), 30)
})

test('the marks of an outcome keep to the gap beside them: the 44 px bar near the receiver is about 18 px, the clock and the puff in the middle keep their size', () => {
  const lit: Pose = { s: 0, lam: [0, 1, 0] }
  const gapAt = (along: number) => gapBeside(A, B, slot(1, 3), lit, along)
  // The bar sits at 0.97 of the route, where the gap is nearly the pitch.
  const bar = markReach(22, gapAt(0.97))
  assert.ok(bar > 8 && bar < 10, `a bar's half is ${bar}`)
  assert.ok(Math.abs(2 * bar - 18) < 1.5, 'the bar is about 18 px long')
  // A delayed request waits at 0.4 with a clock 48 px across: the gap there is wide enough.
  assert.equal(markReach(24, gapAt(0.4)), 24)
  // A lost one pops at 0.55: the cross and the first ticks fit; the outermost ticks are held to the gap.
  assert.equal(markReach(7, gapAt(0.55)), 7)
  assert.ok(markReach(40, gapAt(0.55)) < 40 && markReach(40, gapAt(0.55)) >= 26)
  // A mark never shrinks below 6, and a lone line keeps its whole size.
  assert.equal(markReach(22, 5), 6)
  assert.equal(markReach(22, Infinity), 22)
  assert.equal(markReach(22, 100), 22)
})

test('whoever takes an intercepted request hangs below the whole bundle', () => {
  assert.equal(bundleReach(A, B, slot(1, 3)), 12 + 18) // widest lane 12 off the middle, and the gap a lit lane opens
  assert.equal(bundleReach(A, B, slot(1, 8)), 26 + 18) // eight lanes squeeze to fit the 52 px a side leaves: 7.43 apart, 26 px to the outermost
  assert.equal(bundleReach(A, B, slot(0, 1)), 0)
  const size = { width: 100, height: 28 }
  const plain = markerSpot(300, 0, size)
  const among = markerSpot(300, 0, size, bundleReach(A, B, slot(1, 5)))
  assert.equal(round3(among.y - plain.y), 24 + 18)
  assert.equal(markerSpot(300, 0, size, 0).y, plain.y)
})

test('streams on neighbouring lanes start their dashes at different places', () => {
  assert.deepEqual([0, 1, 2, 3].map(lane => dashPhase(slot(lane, 4))), [0, 3.025, 6.05, 9.075])
  assert.ok(new Set([0, 1, 2].map(lane => dashPhase(slot(lane, 3)))).size === 3)
})

// -- fading -----------------------------------------------------------------------------------------------------------------------------------------------------------------

test('a lit line that times out among its pair fades to half, never fainter than the lines beside it', () => {
  const fade = [{ do: 'fade', at: 1000, dur: 600 }]
  assert.equal(LIT_FLOOR_LANES, 0.5)
  assert.ok(LIT_FLOOR < KIN_OPACITY && KIN_OPACITY < LIT_FLOOR_LANES) // a lone line fades to a quarter, below what a kin shows; among kin it stops above them
  assert.equal(litOpacity(fade, 0), 1)
  assert.equal(litOpacity(fade, 5000), LIT_FLOOR)
  assert.equal(litOpacity(fade, 5000, LIT_FLOOR_LANES), 0.5)
  assert.equal(litOpacity(fade, 1300, LIT_FLOOR_LANES), 0.75)
  assert.equal(litOpacity([], 5000, LIT_FLOOR_LANES), 1)
})

// -- the canvas -------------------------------------------------------------------------------------------------------------------------------------------------------------

const wlan = (): Model => ({
  ...emptyModel(),
  meta: { name: 'WLAN', pairs: 'separate' },
  objects: { ui: { type: 'system', name: 'UI' }, management: { type: 'system', name: 'Management' }, linux: { type: 'system', name: 'Linux' }, bus: { type: 'system', name: 'Bus' } },
  connections: [
    { from: 'ui', to: 'management', label: 'Request and reply', kind: 'request' },
    { from: 'ui', to: 'management', label: 'Start scan', kind: 'stream' },
    { from: 'management', to: 'ui', label: 'Scan results', kind: 'publish' },
    { from: 'management', to: 'ui', label: 'Radio state', kind: 'cached' },
    { from: 'management', to: 'linux', label: 'Apply config', kind: 'request' },
    { from: 'linux', to: 'management', label: 'Link state', kind: 'cached' },
    { from: 'management', to: 'bus', label: 'Events', kind: 'publish' },
  ],
  flows: {
    scan: {
      name: 'Scan', view: 'root', steps: [
        { from: 'ui', to: 'management', text: 'Asks', via: 'Request and reply' },
        { from: 'management', to: 'ui', text: 'The answer comes back on the same line' },
        { from: 'bus', to: 'management', text: 'Nothing returns on a publish' },
        { from: 'management', to: 'linux', text: 'Applies' },
        { from: 'linux', to: 'management', text: 'Answers' },
      ],
    },
  },
})
const IDS = {
  request: 'management ui|ui>management|Request and reply', scan: 'management ui|ui>management|Start scan', results: 'management ui|management>ui|Scan results', radio: 'management ui|management>ui|Radio state',
  apply: 'linux management|management>linux|Apply config', link: 'linux management|linux>management|Link state', events: 'bus management|management>bus|Events',
}

const rpc = (connections: Model['connections']): Model => ({
  ...emptyModel(),
  meta: { pairs: 'separate' },
  objects: { client: { type: 'system', name: 'Client' }, server: { type: 'system', name: 'Server' } },
  connections,
  flows: {
    f: {
      name: 'F', view: 'root', steps: [
        { from: 'client', to: 'server', text: 'Asks' },
        { from: 'server', to: 'client', text: 'Answers' },
        { from: 'server', to: 'client', text: 'Streams', via: 'Watch' },
      ],
    },
  },
})
const GET = 'client server|client>server|Get'
const WATCH = 'client server|client>server|Watch'

test('a reply step rides the line of its request, and the lit line is that one; against a publish there is nothing to ride, so it keeps the dashed step line', () => {
  const model = rpc([{ from: 'client', to: 'server', label: 'Get', kind: 'request' }, { from: 'client', to: 'server', label: 'Watch', kind: 'stream' }, { from: 'client', to: 'server', label: 'Log', kind: 'publish' }])
  const view = computeView(model, 'root')
  const [ask, answer, streams] = model.flows.f.steps
  const toClient: [string, string] = ['server', 'client']
  // The request goes out on its line; the answer comes back along the request's, since no line of the pair runs from the server to the client: the first request or stream.
  assert.equal(strandOf(model, view, ask, ['client', 'server'])?.id, GET)
  assert.equal(strandOf(model, view, answer, toClient)?.id, GET)
  // A reply that names the stream rides the stream.
  assert.equal(strandOf(model, view, streams, toClient)?.id, WATCH)
  // The publish is not a candidate for a reply, so a reply never rides it.
  const log = 'client server|client>server|Log'
  assert.ok([answer, streams].every(step => strandOf(model, view, step, toClient)?.id !== log))
  // The graph lights that line and draws no step line, and its kin are faded.
  const lit = toGraph(model, 'root', { ends: [['client', 'server'], toClient], step: 1, strands: [GET, GET, WATCH] }).edges
  assert.deepEqual(lit.map(e => [e.id, e.className]), [[GET, 'active several'], [WATCH, 'kin'], [log, 'kin']])
  // A pair of publishes only: nothing returns on a publish, so the reply gets the dashed step line and no line of the pair is lit.
  const only = rpc([{ from: 'client', to: 'server', label: 'Log', kind: 'publish' }, { from: 'client', to: 'server', label: 'Log 2', kind: 'cached' }])
  const viewOnly = computeView(only, 'root')
  assert.equal(strandOf(only, viewOnly, answer, toClient), undefined)
  const against = toGraph(only, 'root', { ends: [toClient], step: 0, strands: [undefined] }).edges
  assert.deepEqual(against.map(e => e.className), ['dim', 'dim', 'step'])
  assert.equal(against.at(-1)?.id, 'step')
})

test('opacity: the line a step rides, then the lanes of the flow, then its kin, then the rest', () => {
  const model = wlan()
  const ends = model.flows.scan.steps.map(s => [s.from, s.to!] as [string, string])
  const classOf = (playing: Parameters<typeof toGraph>[2]) => Object.fromEntries(toGraph(model, 'root', playing).edges.map(e => [e.id, e.className]))
  const lit = classOf({ ends, step: 0, strands: [IDS.request, undefined, undefined, undefined, undefined] })
  assert.equal(lit[IDS.request], 'active several')
  assert.deepEqual([lit[IDS.scan], lit[IDS.results], lit[IDS.radio]], ['kin', 'kin', 'kin'])
  assert.deepEqual([lit[IDS.apply], lit[IDS.link], lit[IDS.events]], ['dim', 'dim', 'dim'])
  // A faint step (a lane of the flow's other branch) on the same pair is a lane, not a kin: lane wins over kin. A faint step's own line is picked by strandOf like any other.
  const faint = classOf({ ends, step: 0, faint: [1], strands: [IDS.request, IDS.results, undefined, undefined, undefined] })
  assert.equal(faint[IDS.request], 'active several')
  assert.equal(faint[IDS.results], 'lane')
  assert.deepEqual([faint[IDS.scan], faint[IDS.radio]], ['kin', 'kin'])
  // A faint step on another pair does not make its pair kin.
  const elsewhere = classOf({ ends, step: 0, faint: [3], strands: [IDS.request, undefined, undefined, IDS.apply, undefined] })
  assert.equal(elsewhere[IDS.apply], 'lane')
  assert.equal(elsewhere[IDS.link], 'dim')
  // Nothing playing: nothing is faded.
  assert.ok(Object.values(classOf(undefined)).every(c => c === undefined))
  // Several lit lanes of one pair (an event to several subscribers) are all active.
  const both = classOf({ ends, steps: [0, 1], strands: [IDS.scan, IDS.radio, undefined, undefined, undefined] })
  assert.deepEqual([both[IDS.scan], both[IDS.radio], both[IDS.request], both[IDS.results]], ['active several', 'active several', 'kin', 'kin'])
})

test('a step with the opacity classes keeps the lit line over the faded boxes, and the kin do not get its zIndex', () => {
  const model = wlan()
  const ends = model.flows.scan.steps.map(s => [s.from, s.to!] as [string, string])
  const edges = toGraph(model, 'root', { ends, step: 0, strands: [IDS.request, undefined, undefined, undefined, undefined] }).edges
  assert.equal(edges.find(e => e.id === IDS.request)?.zIndex, 1)
  assert.equal(edges.find(e => e.id === IDS.scan)?.zIndex, undefined)
})

// -- the plan and the store ------------------------------------------------------------------------------------------------------------------------------------------------

test('what a stop asks of its pairs: the lit lanes, and the earliest part beat of the steps on each', () => {
  const model = wlan()
  const view = computeView(model, 'root')
  const beats = (a: Animation, lanes = 4) => beatsFor(a, { length: 250, afterLanding: false, lanes }).beats
  const plan = planOf(view.strands!, [{ strand: IDS.request, beats: beats(CALL) }])
  assert.deepEqual([...plan], [['management ui', { lit: [1, 0, 0, 0], beat: { at: 0, dur: 225 } }]])
  // A callback parts late (600 ms in); with an event on the same pair, which parts at once, the earliest wins and both lanes are lit together.
  const fanOut = planOf(view.strands!, [{ strand: IDS.scan, beats: beats({ kind: 'callback', trigger: 'outside' }) }, { strand: IDS.radio, beats: beats({ kind: 'event', trigger: 'inside' }) }])
  assert.deepEqual([...fanOut], [['management ui', { lit: [0, 1, 0, 1], beat: { at: 0, dur: 225 } }]])
  const late = planOf(view.strands!, [{ strand: IDS.scan, beats: beats({ kind: 'callback', trigger: 'outside' }) }])
  assert.deepEqual(late.get('management ui')?.beat, { at: 600, dur: 225 })
  // A step with no motion parts at once (no beat); a step riding no line, or a lone one, asks for nothing.
  assert.deepEqual([...planOf(view.strands!, [{ strand: IDS.scan }])], [['management ui', { lit: [0, 1, 0, 0] }]])
  assert.equal(planOf(view.strands!, [{ strand: undefined, beats: beats(CALL) }]), NO_PLANS)
  assert.equal(planOf(view.strands!, [{ strand: IDS.events, beats: beats(CALL, 1) }]), NO_PLANS)
})

/** A clock and the frames a store asks for, both under the test's hand. */
function stage() {
  let now = 0
  const clock = new PlayerClock(() => now)
  const asked: (() => void)[] = []
  const store = createPartStore(clock, fn => {
    asked.push(fn)
    return () => void asked.splice(asked.indexOf(fn), 1)
  })
  store.attach() // as the canvas's effect does
  const at = (ms: number) => {
    now = ms
    store.tick()
  }
  return { clock, store, asked, at, now: () => now }
}
const plan = (lit: number[], beat?: { at: number; dur: number }): ReadonlyMap<string, PartPlan> => new Map([['p', { lit, ...(beat ? { beat } : {}) }]])

test('the store draws the pose of the player clock: it opens at the beat, holds, pauses, scrubs and goes at the speed', () => {
  const { clock, store, at, asked } = stage()
  store.set('flow:0:0', plan([0, 1, 0], { at: 100, dur: 225 }), { jump: false, still: false })
  assert.deepEqual(store.lam('p'), []) // not open yet
  assert.equal(asked.length, 1, 'a frame is asked for while the pair is on its way')
  at(100)
  assert.deepEqual(store.lam('p'), [])
  at(100 + 112.5)
  assert.deepEqual(store.lam('p'), [0, 0.875, 0])
  at(325)
  assert.deepEqual(store.lam('p'), [0, 1, 0])
  assert.equal(asked.length, 0, 'it has settled, so it asks for no more frames')
  at(60000) // held through the rests of a repeat
  assert.deepEqual(store.lam('p'), [0, 1, 0])
  // Scrubbing back to the start closes it, because the pose is the clock's: the same moment is the same pose.
  clock.seek(0)
  assert.deepEqual(store.lam('p'), [])
  clock.seek(200)
  assert.deepEqual(store.lam('p'), [0, 0.84375, 0]) // 1 - (1 - 100/225)^3 = 0.8285, cut to 27/32
  clock.seek(400)
  assert.deepEqual(store.lam('p'), [0, 1, 0])
})

test('a pause holds the pose and asks for no frames; play goes on; at double speed it is there twice as soon', () => {
  const { clock, store, at, asked, now } = stage()
  store.set('k', plan([1, 0], { at: 0, dur: 225 }), { jump: false, still: false })
  at(50)
  const early = store.lam('p')
  clock.pause()
  at(5000)
  assert.deepEqual(store.lam('p'), early) // paused at 50 ms: nothing moves
  assert.equal(asked.length, 0)
  clock.play()
  assert.equal(asked.length, 1)
  at(now() + 50)
  assert.notDeepEqual(store.lam('p'), early)
  const fast = stage()
  fast.clock.setRate(2)
  fast.store.set('k', plan([1, 0], { at: 0, dur: 225 }), { jump: false, still: false })
  fast.at(112.5) // 225 ms of player time
  assert.deepEqual(fast.store.lam('p'), [1, 0])
})

test('lines are told only when their pair changes', () => {
  const { store, at } = stage()
  let told = 0
  const off = store.subscribe(() => told++)
  store.set('k', plan([0, 1], { at: 0, dur: 225 }), { jump: false, still: false })
  const first = told
  at(0)
  at(0)
  assert.equal(told, first, 'the same moment says nothing')
  at(1)
  assert.equal(told, first, 'under 1/32 of a step says nothing')
  at(60)
  assert.equal(told, first + 1)
  const held = store.lam('p')
  at(60)
  assert.equal(store.lam('p'), held, 'the same pose is the same array')
  off()
  at(200)
  assert.equal(told, first + 1)
})

test('the next stop: from one lit lane to another with no gap in between, and back to rest when the stop is left', () => {
  const { clock, store, at } = stage()
  store.set('flow:0:0', plan([1, 0, 0], { at: 0, dur: 225 }), { jump: false, still: false })
  at(1000)
  assert.deepEqual(store.lam('p'), [1, 0, 0])
  // The next step rides the third lane: the store begins the clock on it, the pair moves over 195 ms from where it was and stays parted all along.
  at(1000)
  store.set('flow:1:0', plan([0, 0, 1], { at: 0, dur: 225 }), { jump: false, still: false })
  assert.equal(clock.elapsed(), 0, 'the stop begins at its first moment')
  assert.deepEqual(store.lam('p'), [1, 0, 0], 'the clock starting over does not close the pair')
  at(1000 + 97.5)
  assert.deepEqual(store.lam('p'), [0.5, 0, 0.5])
  at(1000 + 195)
  assert.deepEqual(store.lam('p'), [0, 0, 1])
  // The stop after that rides nothing here: the pair closes over 195 ms and the store forgets it.
  at(5000)
  store.set('flow:2:0', NO_PLANS, { jump: false, still: false })
  assert.deepEqual(store.lam('p'), [0, 0, 1])
  at(5000 + 97.5)
  assert.deepEqual(store.lam('p'), [0, 0, 0.5])
  at(5000 + 195)
  assert.equal(store.lam('p'), undefined)
})

test('a change that finds the pair half way goes on from where it is; a jump parts over 225 ms from there', () => {
  const { store, at } = stage()
  store.set('k:0', plan([0, 1, 0], { at: 0, dur: 225 }), { jump: false, still: false })
  at(112.5)
  assert.deepEqual(store.lam('p'), [0, 0.875, 0])
  // Leaving the stop at once: back to rest from 0.875, not from 1 and not from 0.
  store.set('k:1', NO_PLANS, { jump: false, still: false })
  assert.deepEqual(store.lam('p'), [0, 0.875, 0])
  at(112.5 + 97.5)
  assert.deepEqual(store.lam('p'), [0, 0.4375, 0])
  // A jump to a stop that lights the first lane: from where it is to there, easing out over 225 ms from the start of the stop, whatever the beat says.
  store.set('other:5', plan([1, 0, 0], { at: 600, dur: 225 }), { jump: true, still: false })
  assert.deepEqual(store.lam('p'), [0, 0.4375, 0])
  at(112.5 + 97.5 + 112.5)
  assert.deepEqual(store.lam('p'), [0.875, 0.0625, 0]) // lane 0: 0 -> 1 at 0.875; lane 1: 0.4375 -> 0, leaving 0.4375 * 0.125 = 0.0547, cut to 2/32
})

test('reduced motion: the parted pose at once, and gone at once', () => {
  const { store, asked } = stage()
  store.set('k', plan([0, 1], { at: 600, dur: 225 }), { jump: false, still: true })
  assert.deepEqual(store.lam('p'), [0, 1])
  assert.equal(asked.length, 0)
  store.set('k:1', NO_PLANS, { jump: false, still: true })
  assert.equal(store.lam('p'), undefined)
})

test('a clock that has not begun and a pair nobody lights: nothing to draw, no frames', () => {
  const { store, asked } = stage()
  store.set('', NO_PLANS, { jump: false, still: false })
  assert.equal(store.lam('anything'), undefined)
  assert.equal(asked.length, 0)
  assert.equal(STEPS, 32)
})
