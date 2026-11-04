import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beatsFor, partOf, PART_LEAD, PART_MS } from '../../src/core/animation.ts'
import type { Animation } from '../../src/core/animation.ts'
import { endsOfPath } from '../../src/core/heads.ts'
import type { Point } from '../../src/core/heads.ts'
import {
  bulge, bundleReach, dashPhase, displacement, easedSpread, gapBeside, GUTTER, HIT_WIDTH, JUMP_MS, KIN_OPACITY, laneCapacity, laneGeometry, leaveAt, LIT_FLOOR_LANES, litLanes, MARGIN, markReach, MOST, MOVE_WORDS, nearestStrand,
  offsetOf, PART_CLEAR, partEase, partingFor, PITCH, pitchFor, poseAt, REACH, REST, roomOf, round3, SAMPLES, SHIFT_MS, SIBLING_OPACITY, slotsOf, SPREAD, SPREAD_MS, SPREAD_PITCH, spreadProgress, usableOf,
} from '../../src/core/lanes.ts'
import type { HitLane, LaneBox, Parting, Pose, Slot } from '../../src/core/lanes.ts'
import { SHAPE_DEFS } from '../../src/core/look.ts'
import type { Shape } from '../../src/core/look.ts'
import { modelOf } from '../../src/core/state.ts'
import { strandOf } from '../../src/core/strands.ts'
import { computeView, placeStep } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { pairOf, strandName } from '../../ui/src/graph.ts'
import { clip, placeLabels, SAMPLE } from '../../ui/src/labels.ts'
import type { LabelItem } from '../../ui/src/labels.ts'
import { LIT_FLOOR, litOpacity, markerSpot } from '../../ui/src/motion.ts'
import { planOf, STEPS } from '../../ui/src/parts.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

// The lines of a pair of shapes side by side (src/core/lanes.ts): where each lane runs for pairs of 1 to 8 lines, beside, above and across from each other, between boxes and
// between shapes with an outline; the poses (rest, spread, parted around a lit line); the capacity of a pair; which lane a pointer means; and, for the draft-lanes case, the slot,
// the lane and the screen-reader name of each line of its view. The C# tests compare their own.

const SHAPES = new WeakMap<LaneBox, Shape>()
const box = (id: string, cx: number, cy: number, shape: Shape = 'rectangle', width = 200, height = 72): LaneBox => {
  const made: LaneBox = { id, rect: { x: cx - width / 2, y: cy - height / 2, width, height }, edge: SHAPE_DEFS[shape].edge }
  SHAPES.set(made, shape)
  return made
}

/** A box as the C# tests build it: its id, where it is and how big, and the shape whose outline it has. */
const boxJson = (b: LaneBox) => ({ id: b.id, shape: SHAPES.get(b) ?? 'rectangle', ...b.rect })

/** Pairs of shapes in the relations that matter: the lines meet the short sides, the wide sides, a corner, and shapes whose outline is not the box. */
const CONFIGS: { name: string; a: LaneBox; b: LaneBox }[] = [
  { name: 'beside (short sides)', a: box('a', 0, 0), b: box('b', 400, 0) },
  { name: 'above (wide sides)', a: box('a', 0, 0), b: box('b', 0, 300) },
  { name: 'diagonal', a: box('a', 0, 0), b: box('b', 330, 190) },
  { name: 'diagonal, the other way', a: box('a', 330, 190), b: box('b', 0, 0) },
  { name: 'up and left', a: box('a', 0, 0), b: box('b', -250, -180) },
  { name: 'diamond and ellipse', a: box('a', 0, 0, 'diamond'), b: box('b', 400, 120, 'ellipse') },
  { name: 'hexagon and pill', a: box('a', 0, 0, 'hexagon'), b: box('b', 60, 330, 'pill') },
  { name: 'close together', a: box('a', 0, 0), b: box('b', 230, 20) },
]

/** The numbers of lines and how many of them run from the pair's later id to its earlier (the first lanes). */
const MIXES: [lanes: number, back: number][] = [[1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 3], [3, 1], [5, 2], [5, 0], [8, 0], [8, 4], [9, 4]]

const round = (p: Point): [number, number] => [round3(p.x), round3(p.y)]

/** One lane as the readers need it: its path, anchor, the points it is made of, and the head and tail with the way they point. */
function laneDump(source: LaneBox, target: LaneBox, slot: Slot, pose: Pose) {
  const lane = laneGeometry(source, target, slot, pose)
  const ends = endsOfPath(lane.path)!
  return {
    slot, path: lane.path, anchor: [lane.x, lane.y], points: lane.points.map(round),
    head: { at: round(ends.end), dir: round(ends.endDir) }, tail: { at: round(ends.start), dir: round(ends.startDir) },
  }
}

/** The lanes of a pair: the first `back` run from b to a (the later id to the earlier), the others from a to b. */
function bundle(a: LaneBox, b: LaneBox, lanes: number, back: number, pose: Pose) {
  return Array.from({ length: lanes }, (_, lane) => {
    const backwards = lane < back
    return laneDump(backwards ? b : a, backwards ? a : b, { lane, lanes, back }, pose)
  })
}

/** The lanes at rest for every arrangement: what both readers draw for a pair of several lines. */
export function dumpLanes(): unknown {
  return CONFIGS.map(({ name, a, b }) => ({
    name, a: boxJson(a), b: boxJson(b),
    room: round3(roomOf(a, b)),
    mixes: MIXES.map(([lanes, back]) => ({
      lanes, back, pitch: round3(pitchFor(roomOf(a, b), { lane: 0, lanes, back })),
      lines: bundle(a, b, lanes, back, REST),
    })),
  }))
}

/** The poses: spread and parted, at two lengths, for pairs of 3 and 5 and one with both ways. */
const POSES: { name: string; pose: Pose }[] = [
  { name: 'rest', pose: REST },
  { name: 'spread', pose: SPREAD },
  { name: 'half spread', pose: { s: 0.5, lam: [] } },
  { name: 'parted around the second', pose: { s: 0, lam: [0, 1] } },
  { name: 'parted around the first', pose: { s: 0, lam: [1] } },
  { name: 'two lit, side by side', pose: { s: 0, lam: [0, 1, 1, 0, 0] } },
  { name: 'half lit', pose: { s: 0, lam: [0, 0.5, 0] } },
]

/** How a pair eases between rest and spread: the time it takes, how far a pair has gone after a few frames either way (and when turned round half way), and the `s` each progress gives. */
const dumpEasing = () => ({
  ms: SPREAD_MS, sibling: SIBLING_OPACITY,
  progress: ([[0, 1, 0], [0, 1, 16], [0, 1, 80], [0, 1, 160], [0, 1, 400], [1, 0, 40], [1, 0, 160], [0.5, 1, 40], [0.5, 0, 40], [0.25, 0, 100], [1, 1, 50], [0, 0, 50]] as const)
    .map(([from, goal, ms]) => ({ from, goal, ms, to: round3(spreadProgress(from, goal, ms)) })),
  eased: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(progress => ({ progress, s: round3(easedSpread(progress)) })),
})

export function dumpPoses(): unknown {
  return {
    easing: dumpEasing(),
    bulge: [0, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(t => ({ t, w: round3(bulge(t)) })),
    displacements: [60, 150, 400].flatMap(length => [[3, 0], [4, 2]].flatMap(([lanes, back]) =>
      POSES.map(({ name, pose }) => ({ length, lanes, back, pose: name, s: pose.s, lam: pose.lam, moved: Array.from({ length: lanes }, (_, lane) => round3(displacement({ lane, lanes, back }, pose, length, 12))) })))),
    lanes: CONFIGS.filter(c => ['beside (short sides)', 'diagonal', 'diamond and ellipse'].includes(c.name)).map(({ name, a, b }) => ({
      name, a: boxJson(a), b: boxJson(b), poses: POSES.map(({ name: pose, pose: p }) => ({ pose, s: p.s, lam: p.lam, lanes: [[3, 0], [5, 2]].map(([lanes, back]) => ({ lanes, back, lines: bundle(a, b, lanes, back, p) })) })),
    })),
  }
}

/** Where a ray meets an outline: from the centre of the shape and from a point away from it, in a box and in shapes with an outline of their own. */
const LEAVES: { name: string; shape: Shape; from?: [number, number]; rays: [number, number][] }[] = [
  { name: 'the box, from its centre', shape: 'rectangle', rays: [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.6, -0.8]] },
  { name: 'the box, from a point off its centre', shape: 'rectangle', from: [50, 40], rays: [[1, 0], [-1, 0], [0, 1], [0, -1], [0.6, 0.8], [-0.6, -0.8]] },
  { name: 'the box, from a point on the line along its edge', shape: 'rectangle', from: [-50, 0], rays: [[1, 0], [0, 1], [0, -1], [-1, 0]] },
  { name: 'a diamond, from its centre', shape: 'diamond', rays: [[1, 0], [0, 1], [0.6, 0.8], [-0.6, 0.8]] },
  { name: 'a diamond, from a point off its centre', shape: 'diamond', from: [50, 40], rays: [[1, 0], [0, 1], [0, -1], [-1, 0], [0.6, 0.8]] },
  { name: 'an ellipse, from a point off its centre', shape: 'ellipse', from: [50, 20], rays: [[1, 0], [-1, 0], [0, 1], [0, -1]] },
  { name: 'a pill, from a point off its centre', shape: 'pill', from: [30, 30], rays: [[1, 0], [-1, 0], [0, 1], [0, -1]] },
]

/** The capacity of a pair, the usable room and the offsets, as the geometry reads them. */
export function dumpCapacity(): unknown {
  return {
    usable: [10, 20, 36, 50, 100, 140].map(half => ({ half, usable: usableOf(half) })),
    capacity: [10, 20, 36, 50, 100, 140].map(half => ({ half, oneWay: laneCapacity(half, false), bothWays: laneCapacity(half, true) })),
    offsets: MIXES.map(([lanes, back]) => ({ lanes, back, at: Array.from({ length: lanes }, (_, lane) => round3(offsetOf({ lane, lanes, back }))) })),
    pitches: [20, 36, 100].flatMap(half => MIXES.map(([lanes, back]) => ({ half, lanes, back, pitch: round3(pitchFor(half, { lane: 0, lanes, back })) }))),
    constants: { PITCH, GUTTER, MARGIN, MOST, SAMPLES, SPREAD_PITCH, REACH, HIT_WIDTH, SAMPLE },
    leaveAt: LEAVES.map(({ name, shape, from, rays }) => {
      const b = box('a', 50, 30, shape)
      return { name, shape, from: from ?? null, rays: rays.map(([dx, dy]) => ({ dx, dy, at: round(leaveAt(b.rect, b.edge, dx, dy, from === undefined ? undefined : { x: from[0], y: from[1] })) })) }
    }),
    round3: [0, 0.0004, 0.0005, -0.0004, -0.0005, -0.0015, 1 / 3, 2 / 3, 100.1235, -7.5555, 1e-7].map(value => ({ value, rounded: round3(value) })),
  }
}

/** Where a pointer means which lane: probes on, between and away from the lanes of a pair, at rest and spread, at a few zooms (the reach is in screen pixels, so what a probe means depends on the zoom). */
export function dumpHits(): unknown {
  const { a, b } = CONFIGS[0]
  const probes: Point[] = [[200, -12], [200, 0], [200, 12], [200, 5.9], [200, 6.1], [200, -20], [200, -30], [200, 40], [120, 11], [90, 12], [310, 12], [200, 22], [200, -22]].map(([x, y]) => ({ x, y }))
  const poses: [string, Pose][] = [['rest', REST], ['spread', SPREAD]]
  return poses.flatMap(([name, pose]) => [[3, 0], [4, 2], [1, 0]].flatMap(([lanes, back]) => [1, 0.5, 2].map(zoom => {
    const lines: HitLane[] = bundle(a, b, lanes, back, pose).map((l, lane) => ({ id: `l${lane}`, pair: 'p', lane, points: l.points.map(([x, y]) => ({ x, y })) }))
    return { pose: name, s: pose.s, zoom, a: boxJson(a), b: boxJson(b), lanes, back, probes: probes.map(p => ({ at: round(p), strand: nearestStrand(lines, p, zoom) ?? null })) }
  })))
}

/** The draft-lanes case: where each shape sits, then each line of the root view with its slot, its lane at rest and spread, its name, and the line each step rides. */
const SPOTS: Record<string, [number, number, Shape?]> = {
  ui: [0, 0], management: [420, 0], linux: [420, 330, 'diamond'], cloud: [840, 0, 'ellipse'], bus: [420, -260], sensor: [0, 330],
}

export async function dumpDraftLanes(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/draft-lanes/flowy'))
  if ('parseError' in state) throw new Error("the draft-lanes case can't be read")
  const model = modelOf(state)
  const view = computeView(model, 'root')
  const slots = slotsOf(view.strands!)
  const at = (id: string) => box(id, SPOTS[id][0], SPOTS[id][1], SPOTS[id][2])
  const spots = Object.entries(SPOTS).map(([id, [x, y, shape]]) => ({ id, x, y, shape: shape ?? 'rectangle' }))
  const lines = (pose: Pose, pick?: string) => view.strands!.map(s => {
    const selected = pick !== undefined && s.pair === pick
    return { id: s.id, slot: slots.get(s.id), lane: laneDump(at(s.from), at(s.to), slots.get(s.id)!, selected ? pose : REST) }
  })
  return {
    words: MOVE_WORDS, spots,
    slots: [...slots].map(([id, slot]) => ({ id, slot })),
    names: view.strands!.map(s => ({ id: s.id, pair: pairOf({ id: s.id, data: { pair: s.pair } }), name: strandName(model, s) })),
    rest: lines(REST),
    spread: lines(SPREAD, 'management ui'),
    rides: Object.entries(model.flows).flatMap(([flow, f]) => f.steps.map((step, i) => {
      const placed = placeStep(model, f.view, step)
      return { flow, step: i, strand: (placed ? strandOf(model, view, step, placed)?.id : undefined) ?? null }
    })),
  }
}


/** The labels of a pair of lanes: each label starts with a sample of its line and keeps off the other lanes of its pair (src/core/lanes.ts, ui/src/labels.ts). The C# side takes a label's size, as geometry.json's labels do. */
export function dumpLaneLabels(): unknown {
  const CHAR = 6.2
  const cases: { name: string; a: LaneBox; b: LaneBox; lanes: number; back: number; pose: Pose; chars: number[]; pinned?: number }[] = [
    { name: 'three lanes at rest', a: CONFIGS[0].a, b: CONFIGS[0].b, lanes: 3, back: 0, pose: REST, chars: [12, 6, 20] },
    { name: 'three lanes spread', a: CONFIGS[0].a, b: CONFIGS[0].b, lanes: 3, back: 0, pose: SPREAD, chars: [12, 6, 20] },
    { name: 'five lanes both ways, spread', a: CONFIGS[0].a, b: CONFIGS[0].b, lanes: 5, back: 2, pose: SPREAD, chars: [14, 14, 9, 22, 7] },
    { name: 'four lanes above and below, one pinned', a: CONFIGS[1].a, b: CONFIGS[1].b, lanes: 4, back: 1, pose: SPREAD, chars: [10, 10, 10, 10], pinned: 2 },
    { name: 'two lanes on a diagonal', a: CONFIGS[2].a, b: CONFIGS[2].b, lanes: 2, back: 0, pose: REST, chars: [30, 30] },
    { name: 'one lane with others far away', a: CONFIGS[0].a, b: CONFIGS[0].b, lanes: 8, back: 4, pose: SPREAD, chars: [5, 5, 5, 5, 5, 5, 5, 5] },
  ]
  return cases.map(({ name, a, b, lanes, back, pose, chars, pinned }) => {
    const bundleLines = bundle(a, b, lanes, back, pose)
    const items: LabelItem[] = bundleLines.map((l, i) => ({
      id: `l${i}`, path: l.path, mid: { x: l.anchor[0], y: l.anchor[1] }, chars: clip('x'.repeat(chars[i])).length, pinned: pinned === i,
      across: bundleLines.filter((_, k) => k !== i).map(o => o.points.map(([x, y]) => ({ x, y }))), extra: SAMPLE,
    }))
    const boxes = [a.rect, b.rect]
    const spots = placeLabels(items, boxes)
    return {
      name, a: boxJson(a), b: boxJson(b), lanes, back, spread: pose === SPREAD, boxes,
      items: items.map(i => ({ id: i.id, path: i.path, mid: i.mid, width: i.chars * CHAR + 10, height: 18, pinned: i.pinned === true, extra: i.extra, across: i.across })),
      spots: items.map(i => spots.get(i.id)),
    }
  })
}


/** The partings: how a pair's lanes go from one pose to the next over a stop, and the pose at several moments of the player's clock. */
const PARTINGS: { name: string; parting: Parting }[] = [
  { name: 'a first parting at the beat', parting: partingFor([0, 0, 0], [0, 1, 0], { beat: { at: 200, dur: PART_MS } }) },
  { name: 'a first parting of a step with no motion', parting: partingFor([0, 0, 0], [1, 0, 0]) },
  { name: 'the next step on another lane', parting: partingFor([0, 1, 0], [0, 0, 1], { beat: { at: 200, dur: PART_MS } }) },
  { name: 'the stop is left', parting: partingFor([0, 0, 1], [0, 0, 0], { beat: { at: 200, dur: PART_MS } }) },
  { name: 'a jump from half way', parting: partingFor([0, 0.4, 0], [1, 0, 0], { beat: { at: 600, dur: PART_MS }, jump: true }) },
  { name: 'two lit lanes at once', parting: partingFor([0, 0, 0, 0, 0], [0, 1, 1, 0, 0]) },
]
const CLOCKS = [-20, 0, 50, 112.5, 195, 200, 225, 312.5, 425, 600, 825, 5000]

/** What a stop asks of the lanes of the draft-lanes case's pairs: the lit lanes by pair, and the earliest part beat. */
async function dumpPlans(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/draft-lanes/flowy'))
  if ('parseError' in state) throw new Error('the draft-lanes case cannot be read')
  const view = computeView(modelOf(state), 'root')
  const strands = view.strands!
  const idOf = (label: string) => strands.find(s => s.label === label)!.id
  const beats = (a: Animation, lanes: number) => beatsFor(a, { length: 250, afterLanding: false, lanes }).beats
  const cases: [string, { strand: string | undefined; animation?: Animation }[]][] = [
    ['one request', [{ strand: idOf('Request and reply'), animation: { kind: 'call', trigger: 'inside' } }]],
    ['a callback', [{ strand: idOf('Start scan'), animation: { kind: 'callback', trigger: 'outside' } }]],
    ['an event to one lane and a callback to another', [{ strand: idOf('Scan results'), animation: { kind: 'event', trigger: 'inside' } }, { strand: idOf('Radio state'), animation: { kind: 'callback', trigger: 'outside' } }]],
    ['a step with no motion', [{ strand: idOf('Set country') }]],
    ['a step on a lone line', [{ strand: idOf('Events'), animation: { kind: 'send', trigger: 'inside' } }]],
    ['a step on no line', [{ strand: undefined, animation: { kind: 'send', trigger: 'inside' } }]],
  ]
  return cases.map(([name, steps]) => ({
    name,
    steps: steps.map(s => ({ strand: s.strand ?? null, animation: s.animation ?? null })),
    plan: [...planOf(strands, steps.map(s => ({ strand: s.strand, ...(s.animation === undefined || s.strand === undefined ? {} : { beats: beats(s.animation, strands.find(x => x.id === s.strand)!.lanes) }) })))],
    lit: [...litLanes(strands, steps.flatMap(s => s.strand ?? []))],
  }))
}

/** The beats of a step among the lines of its pair: with lanes or without, the part beat and the same total. */
const PART_ANIMATIONS: Animation[] = [
  { kind: 'send', trigger: 'inside' }, { kind: 'call', trigger: 'inside' }, { kind: 'event', trigger: 'inside' }, { kind: 'callback', trigger: 'inside' }, { kind: 'callback', trigger: 'outside' },
  { kind: 'call', trigger: 'inside', outcome: 'timeout' }, { kind: 'call', trigger: 'inside', outcome: 'rejected', reason: 'Rate limit' }, { kind: 'send', trigger: 'inside', outcome: 'lost', at: 0.4 },
  { kind: 'call', trigger: 'inside', outcome: 'delayed' }, { kind: 'send', trigger: 'inside', outcome: 'intercepted', by: { name: 'Tap' } }, { kind: 'call', trigger: 'inside', outcome: 'duplicated' },
  { kind: 'call', trigger: 'inside', outcome: 'rejected', share: 30 }, { kind: 'call', trigger: 'inside', opens: 'stream', name: 'Rows' }, { kind: 'recurse', trigger: 'inside', depth: 3 },
]

const litOf = (lanes: number, lit: number): number[] => Array.from({ length: lanes }, (_, k) => (k === lit ? 1 : 0))

/** The lines of a pair while a flow plays on them: the beats with a part, the pose of the player clock, the lanes at those poses, what stays clear of what, how much each line fades. */
export async function dumpParts(): Promise<unknown> {
  const { a, b } = CONFIGS[0]
  const [diamond, ellipse] = [CONFIGS[5].a, CONFIGS[5].b]
  const slotOf = (lane: number, lanes: number, back: number): Slot => ({ lane, lanes, back })
  const gapCases: [string, LaneBox, LaneBox, number, number][] = [
    ['beside, 3 lanes', a, b, 3, 0], ['beside, 5 lanes, 2 back', a, b, 5, 2], ['diamond and ellipse, 5 lanes, 2 back', diamond, ellipse, 5, 2], ['close together, 3 lanes', a, CONFIGS[7].b, 3, 0],
  ]
  return {
    constants: { PART_MS, PART_LEAD, PART_CLEAR, SHIFT_MS, JUMP_MS, KIN_OPACITY, LIT_FLOOR_LANES, LIT_FLOOR, STEPS },
    eases: (['out', 'smooth'] as const).flatMap(kind => [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(p => ({ kind, p, e: round3(partEase(kind, p)) }))),
    beats: PART_ANIMATIONS.flatMap(animation => [false, true].flatMap(afterLanding => [1, 3].map(lanes => {
      const { beats, total } = beatsFor(animation, { length: 250, afterLanding, lanes })
      return { animation, afterLanding, lanes, beats, total, part: partOf(beats) ?? null }
    }))),
    partings: PARTINGS.map(({ name, parting }) => ({
      name, parting,
      poses: CLOCKS.map(clock => { const pose = poseAt(parting, clock); return { clock, s: pose.s, lam: pose.lam, rest: pose === REST } }),
    })),
    // Three lanes between two boxes 400 apart, and five between a diamond and an ellipse, drawn at the pose of the player clock.
    lanes: ([['beside (short sides)', a, b, 3, 0, 1], ['diamond and ellipse', diamond, ellipse, 5, 2, 3]] as const).flatMap(([name, from, to, lanes, back, lit]) => {
      const parting = partingFor(litOf(lanes, -1), litOf(lanes, lit), { beat: { at: 0, dur: PART_MS } })
      return [0, 60, 112.5, 225, 400].map(clock => ({ name, clock, lanes, back, lit, lines: bundle(from, to, lanes, back, poseAt(parting, clock)) }))
    }),
    plans: await dumpPlans(),
    gaps: gapCases.flatMap(([name, from, to, lanes, back]) => [0, 1, 2].map(lit => ({
      name, lanes, back, lit,
      at: [0, 0.1, 0.4, 0.5, 0.55, 0.9, 0.97, 1].map(t => ({
        t, rest: gapBeside(from, to, slotOf(lit, lanes, back), REST, t), parted: gapBeside(from, to, slotOf(lit, lanes, back), { s: 0, lam: litOf(lanes, lit) }, t),
      })),
      reach: bundleReach(from, to, slotOf(lit, lanes, back)),
    }))),
    alone: { gapIsInfinite: gapBeside(a, b, slotOf(0, 1, 0), REST, 0.5) === Infinity, reach: bundleReach(a, b, slotOf(0, 1, 0)) },
    marks: [[22, 12], [22, 18], [22, 30], [24, 30], [40, 30], [40, 29.7], [7, 30], [22, 5], [22, 9], [22, 100]].map(([half, gap]) => ({ half, gap, reach: markReach(half, gap) })),
    markReachAlone: markReach(22, Infinity),
    phases: [[0, 1], [0, 2], [1, 2], [0, 4], [1, 4], [3, 4], [2, 3], [7, 8]].map(([lane, lanes]) => ({ lane, lanes, px: dashPhase({ lane, lanes }) })),
    // The motion maths the part touches: a lit line that times out fades to a floor, and the marker of whoever takes an intercepted request clears the bundle.
    motion: {
      litOpacity: [0, 999, 1000, 1150, 1300, 1600, 5000].flatMap(t => [undefined, LIT_FLOOR_LANES].map(floor => ({ t, floor: floor ?? null, opacity: litOpacity([{ do: 'fade', at: 1000, dur: 600 }], t, floor) }))),
      markerSpot: [[300, 0], [-300, 0], [0, 300], [200, 100], [0, 0]].flatMap(([dx, dy]) => [0, 24, 44].map(clear => ({ dx, dy, clear, at: markerSpot(dx, dy, { width: 100, height: 28 }, clear) }))),
    },
  }
}
