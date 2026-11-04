import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { endsOfPath } from '../../src/core/heads.ts'
import type { Point } from '../../src/core/heads.ts'
import { KIND_IDS } from '../../src/core/kinds.ts'
import type { KindId } from '../../src/core/kinds.ts'
import { laneCounts, tangle } from '../../src/core/layout.ts'
import {
  displacement, FOLD_FROM, GUTTER, HAIRLINE_GAP, isLaned, laneCapacity, laneGeometry, LANE_KEY, MOST, offsetOf, offsetsOf, OPEN_MOST, pitchFor, REST, roomOf, round3, slotsOf, SPREAD, stackStep, TRUNK_EXTRA,
} from '../../src/core/lanes.ts'
import type { LaneBox, Pose, Slot } from '../../src/core/lanes.ts'
import { SHAPE_DEFS } from '../../src/core/look.ts'
import type { Shape } from '../../src/core/look.ts'
import type { LineStyle, Model } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import { drawnStrandOf, drawnView, foldPair, foldStrands, openTrunks, pairsOpenedBy, TRUNK_MARK, trunkId, trunkLabel } from '../../src/core/trunks.ts'
import { computeView, placeStep } from '../../src/core/views.ts'
import type { Strand, View } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { inTrunk, toGraph } from '../../ui/src/graph.ts'
import { kindsOnScreen } from '../../ui/src/kindkey.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

// Many lines between two shapes (src/core/trunks.ts, and the room a trunk takes in src/core/lanes.ts): how many lanes fit, how a pair that has more folds into trunks, how a trunk opens, where
// its lanes and hairlines run, the trunks case's views in each line style, the key items, and what the layout makes of a bundle. The C# tests compare their own.

const box = (id: string, cx: number, cy: number, shape: Shape = 'rectangle', width = 200, height = 72): LaneBox => ({ id, rect: { x: cx - width / 2, y: cy - height / 2, width, height }, edge: SHAPE_DEFS[shape].edge })
const boxJson = (b: LaneBox, shape: Shape) => ({ id: b.id, shape, ...b.rect })
const round = (p: Point): [number, number] => [round3(p.x), round3(p.y)]

/** A pair a < b the way computeView makes its strands: the ones that run from b to a first, then the others, each in the order given. */
type Spec = { way: 'back' | 'ahead'; kind?: KindId; connections?: number }
function pairOf(specs: readonly Spec[]): Strand[] {
  const ordered = [...specs.filter(s => s.way === 'back'), ...specs.filter(s => s.way === 'ahead')]
  let next = 0
  return ordered.map((s, lane) => {
    const [from, to] = s.way === 'back' ? ['b', 'a'] : ['a', 'b']
    const label = `${s.way} ${lane}`
    return { id: `a b|${from}>${to}|${label}`, pair: 'a b', from, to, label, connections: Array.from({ length: s.connections ?? 1 }, () => next++), lane, lanes: ordered.length, ...(s.kind === undefined ? {} : { kind: s.kind }) }
  })
}
const many = (n: number, way: Spec['way'], kind?: KindId): Spec[] => Array.from({ length: n }, () => ({ way, ...(kind === undefined ? {} : { kind }) }))

/** A strand as the readers need it: all it says, with nothing left out that a reader reads. */
const strandJson = (s: Strand) => ({
  id: s.id, pair: s.pair, from: s.from, to: s.to, label: s.label, connections: s.connections, lane: s.lane, lanes: s.lanes, kind: s.kind ?? null, look: s.look ?? null,
  trunk: s.trunk === undefined ? null : s.trunk,
})

const HALVES = [10, 20, 26, 36, 50, 100, 140]

/** Pairs to fold: the lines of a pair as specs, and the half-rooms to fold them across. */
const FOLDS: { name: string; specs: Spec[]; halves: number[] }[] = [
  { name: 'five one way fit across a short side', specs: many(5, 'ahead'), halves: [36] },
  { name: 'six one way, no kind', specs: many(6, 'ahead'), halves: [36, 100] },
  { name: 'nine one way, of a kind', specs: many(9, 'ahead', 'request'), halves: [100] },
  { name: 'nine and the one the other way', specs: [...many(9, 'ahead', 'stream'), ...many(1, 'back', 'publish')], halves: [36, 100] },
  { name: 'one trunk for each way and kind, a group of one stays a lane', specs: [...many(5, 'back', 'request'), { way: 'back', kind: 'stream' }, { way: 'ahead', kind: 'publish' }, ...many(2, 'ahead'), ...many(2, 'ahead', 'publish')], halves: [100] },
  { name: 'twelve lines in six kinds, both ways', specs: [...KIND_IDS.flatMap(kind => many(2, 'back', kind))], halves: [36, 100] },
  { name: 'every kind twice both ways', specs: [...KIND_IDS.flatMap(kind => [...many(2, 'back', kind), ...many(2, 'ahead', kind)])], halves: [36, 50, 100, 140] },
  { name: 'seven kinds one way, none repeated', specs: [...KIND_IDS.map(kind => ({ way: 'ahead' as const, kind })), { way: 'ahead' }], halves: [36, 100] },
  { name: 'strands of several connections', specs: [{ way: 'ahead', connections: 3 }, ...many(9, 'ahead'), { way: 'back', connections: 2 }], halves: [100] },
  { name: 'fourteen of a kind (more than a trunk opens)', specs: many(14, 'ahead', 'publish'), halves: [100] },
  { name: 'a wide mix', specs: [...many(3, 'back', 'request'), ...many(2, 'back', 'cached'), ...many(4, 'ahead', 'object'), ...many(3, 'ahead', 'stream'), { way: 'ahead' as const }, { way: 'ahead' as const, kind: 'extension' }], halves: [36, 26, 100] },
]

const SLOTS: Slot[] = [
  { lane: 0, lanes: 3, back: 0 }, { lane: 0, lanes: 3, back: 0, stack: [1] }, { lane: 0, lanes: 3, back: 0, stack: [0] }, { lane: 0, lanes: 3, back: 0, stack: [2] },
  { lane: 0, lanes: 2, back: 1, stack: [0, 1] }, { lane: 0, lanes: 4, back: 0, stack: [1] }, { lane: 0, lanes: 4, back: 2, stack: [0, 3] }, { lane: 0, lanes: 5, back: 2, stack: [1, 2, 4] },
  { lane: 0, lanes: 8, back: 3, stack: [0, 2, 3, 5, 7] }, { lane: 0, lanes: 1, back: 0, stack: [0] }, { lane: 0, lanes: 2, back: 0, stack: [0, 1] },
]

/** The half-room, the capacity with trunks, the offsets with the room they take and the pitch they are squeezed to. */
function dumpRoom() {
  return {
    constants: { TRUNK_EXTRA, HAIRLINE_GAP, OPEN_MOST, FOLD_FROM, MOST, GUTTER, TRUNK_MARK },
    words: LANE_KEY,
    capacity: HALVES.flatMap(half => [false, true].flatMap(bothWays => [0, 1, 2, 3, 4, 5].map(trunks => ({ half, bothWays, trunks, lanes: laneCapacity(half, bothWays, trunks) })))),
    offsets: SLOTS.map(slot => ({ slot, offsets: offsetsOf(slot).map(round3), at: Array.from({ length: slot.lanes }, (_, lane) => round3(offsetOf({ ...slot, lane }))) })),
    pitches: [20, 36, 100].flatMap(half => SLOTS.map(slot => ({ half, slot, pitch: round3(pitchFor(half, slot)) }))),
    labels: [undefined, ...KIND_IDS].flatMap(kind => [1, 2, 9, 14, 120].map(size => ({ kind: kind ?? null, size, label: trunkLabel(kind, size) }))),
    ids: [undefined, ...KIND_IDS].map(kind => ({ pair: 'a b', from: 'a', to: 'b', kind: kind ?? null, id: trunkId('a b', 'a', 'b', kind) })),
  }
}

/** How pairs fold, and what opens. */
function dumpFolds() {
  const folds = FOLDS.flatMap(({ name, specs, halves }) => halves.map(half => {
    const strands = pairOf(specs)
    const { strands: out, stands } = foldPair(strands, half)
    return { name, half, strands: strands.map(strandJson), folded: out.map(strandJson), stands: [...stands] }
  }))
  // The same through foldStrands: a pair with fewer strands than FOLD_FROM is not asked about, and the rooms asked about are the ones of pairs that have enough.
  const asked: string[] = []
  const two = pairOf(many(3, 'ahead')).map(s => ({ ...s, pair: 'c d', id: `c d|${s.id}` }))
  const mixed = [...two, ...pairOf(many(9, 'ahead')), ...pairOf(many(2, 'back')).map(s => ({ ...s, pair: 'e f', from: 'f', to: 'e', id: `e f|${s.id}` }))]
  const viaFold = foldStrands(mixed, (from, to) => {
    asked.push(`${from} ${to}`)
    return 100
  })!
  const opens = FOLDS.filter(f => f.halves.includes(100)).map(({ name, specs }) => {
    const strands = pairOf(specs)
    const folded = foldPair(strands, 100).strands
    const unfolded = new Map(strands.map(s => [s.id, s]))
    const opened = openTrunks(folded, unfolded, new Set(['a b']))
    const slots = slotsOf(opened)
    return {
      name, folded: folded.map(s => s.id), opened: opened.map(s => ({ id: s.id, lane: s.lane, lanes: s.lanes })), slots: opened.map(s => slots.get(s.id)),
      closedSlots: folded.map(s => slotsOf(folded).get(s.id)), laned: opened.map(s => isLaned(slots.get(s.id))),
    }
  })
  const selected = pairOf(many(3, 'ahead'))
  return {
    folds,
    foldStrands: { asked, strands: viaFold.strands.map(strandJson), stands: [...viaFold.stands], none: foldStrands(undefined, () => 36) ?? null },
    opens,
    opened: [selected[1].id, 'a b', 'x y', `a b|a>b|nothing`, undefined].map(sel => ({ selected: sel ?? null, pairs: [...pairsOpenedBy(selected, sel)] })),
  }
}

/** Pairs of shapes for the lanes of trunks and the lines of an open trunk. */
const PLACES: { name: string; a: LaneBox; b: LaneBox; shapes: [Shape, Shape] }[] = [
  { name: 'beside (short sides)', a: box('a', 0, 0), b: box('b', 400, 0), shapes: ['rectangle', 'rectangle'] },
  { name: 'above (wide sides)', a: box('a', 0, 0), b: box('b', 0, 300), shapes: ['rectangle', 'rectangle'] },
  { name: 'diagonal', a: box('a', 0, 0), b: box('b', 330, 190), shapes: ['rectangle', 'rectangle'] },
  { name: 'diamond and ellipse', a: box('a', 0, 0, 'diamond'), b: box('b', 400, 120, 'ellipse'), shapes: ['diamond', 'ellipse'] },
  { name: 'lower level', a: box('a', 0, 0), b: box('b', 400, 80), shapes: ['rectangle', 'rectangle'] },
]

function laneDump(source: LaneBox, target: LaneBox, slot: Slot, pose: Pose, style: LineStyle) {
  const lane = laneGeometry(source, target, slot, pose, style)
  const ends = endsOfPath(lane.path)!
  return { slot, path: lane.path, anchor: [lane.x, lane.y], points: lane.points.map(round), head: { at: round(ends.end), dir: round(ends.endDir) }, tail: { at: round(ends.start), dir: round(ends.startDir) } }
}

/**
 * The lanes of a pair of trunks and lanes, shut and open: for a pair a < b, the strands of the folds above across the room of the boxes (as the view has it); each as the lane a
 * reader draws, at rest and spread, in each line style, with the step along the normal its hairlines lie on.
 */
function dumpLanes() {
  const specs: { name: string; specs: Spec[] }[] = [
    { name: 'nine one way and the one the other', specs: [...many(9, 'ahead', 'stream'), ...many(1, 'back', 'publish')] },
    { name: 'eight in four kinds', specs: [...many(2, 'back', 'request'), ...many(2, 'back', 'cached'), ...many(2, 'ahead', 'object'), ...many(2, 'ahead', 'extension')] },
    { name: 'two trunks beside a lane, one way and the other', specs: [...many(6, 'back', 'request'), { way: 'back' as const }, ...many(7, 'ahead', 'publish')] },
  ]
  return PLACES.flatMap(({ name: place, a, b, shapes }) => (['straight', 'curved', 'angled'] as const).flatMap(style => specs.map(({ name, specs: lines }) => {
    const strands = pairOf(lines)
    const folded = foldStrands(strands, () => roomJson(a, b, style))!
    const unfolded = new Map(strands.map(s => [s.id, s]))
    const closed = folded.strands
    const open = openTrunks(closed, unfolded, new Set(['a b']))
    const closedSlots = slotsOf(closed)
    const openSlots = slotsOf(open)
    const lane = (s: Strand, slots: Map<string, Slot>, pose: Pose) => {
      const slot = slots.get(s.id)!
      const [source, target] = s.from === 'a' ? [a, b] : [b, a]
      return { id: s.id, ...laneDump(source, target, slot, pose, style), ...(slot.stack === undefined ? {} : { step: stackStep(source, target, slot) }) }
    }
    return {
      name, place, style, a: boxJson(a, shapes[0]), b: boxJson(b, shapes[1]), room: roomJson(a, b, style),
      closed: closed.map(s => ({ strand: strandJson(s), rest: lane(s, closedSlots, REST), spread: lane(s, closedSlots, SPREAD) })),
      open: open.map(s => ({ id: s.id, rest: lane(s, openSlots, REST), spread: lane(s, openSlots, SPREAD) })),
    }
  })))
}

const roomJson = (a: LaneBox, b: LaneBox, style: LineStyle): number => round3(roomOf(a, b, style))

/** The trunks case: each line style's view as it is drawn, what a selected line or pair opens, and the line each step of its flow rides. */
async function dumpDrawn() {
  const state = await loadState(join(root, 'desktop/fixtures/cases/trunks/flowy'))
  if ('parseError' in state) throw new Error("the trunks case can't be read")
  const model = modelOf(state)
  const flow = model.flows.tour
  const unfolded = computeView(model, 'root')
  const ends = flow.steps.map(s => placeStep(model, flow.view, s))
  // Whether a line is one a trunk stands for (a pointer on a line in a panel lights its trunk).
  const edges = toGraph(model, 'root').edges
  const trunks = edges.filter(e => e.data?.trunk !== undefined)
  const membership = trunks.map(e => ({ trunk: e.id, tests: [...(e.data!.trunk as { members: string[] }).members.slice(0, 2), ...(e.data!.trunk as { members: string[] }).members.slice(-1), 'nowhere', ''].map(id => ({ id, in: inTrunk(e, id) })) }))
  return { membership, styles: (['straight', 'curved', 'angled'] as const).map(style => drawnStyle(model, flow, unfolded, ends, style)) }
}

/** The view as a line style draws it: its strands and slots, the trunk each line folded into, the line each step rides, and what selecting a pair opens. */
function drawnStyle(model: Model, flow: Model['flows'][string], unfolded: View, ends: ([string, string] | null)[], style: LineStyle) {
  const drawn = drawnView(model, 'root', style)
  const slots = slotsOf(drawn.view.strands!)
  const label = (id: string) => unfolded.strands!.find(s => s.id === id)!.label
  return {
    style,
    strands: drawn.view.strands!.map(s => ({ ...strandJson(s), slot: slots.get(s.id) })),
    stands: [...drawn.stands].map(([member, trunk]) => ({ member: label(member), trunk })),
    rides: flow.steps.map((step, i) => ({ step: i, ride: (ends[i] ? drawnStrandOf(model, drawn, step, ends[i]!) : undefined) ?? null })),
    opens: ['hub ui', 'hub store', 'hub bus', 'hub sensor', 'nowhere'].map(pair => {
      const opened = openTrunks(drawn.view.strands!, new Map(unfolded.strands!.map(s => [s.id, s])), pairsOpenedBy(unfolded.strands!, pair))
      const openSlots = slotsOf(opened)
      return { pair, lines: opened.map(s => ({ id: s.id, lane: s.lane, lanes: s.lanes, slot: openSlots.get(s.id) })) }
    }),
  }
}

/** The key items: the kinds, a trunk on show, and a lane a step plays on among others. */
function dumpKey() {
  const line = (id: string, className?: string, data?: Record<string, unknown>) => ({ id, ...(className === undefined ? {} : { className }), ...(data === undefined ? {} : { data }) })
  const cases: { name: string; lines: ReturnType<typeof line>[] }[] = [
    { name: 'no lines', lines: [] },
    { name: 'plain lines', lines: [line('a b'), line('b c')] },
    { name: 'a trunk', lines: [line('a b|a>b|\u0002', undefined, { trunk: { size: 3, members: ['x'] }, lanes: 1 })] },
    { name: 'lanes, none lit', lines: [line('x', undefined, { lanes: 3 }), line('y', 'kin', { lanes: 3 })] },
    { name: 'a lane in use among others', lines: [line('x', 'active several', { lanes: 3 }), line('y', 'kin', { lanes: 3 })] },
    { name: 'a lit line alone', lines: [line('x', 'active', { lanes: 1 }), line('y', 'dim')] },
    { name: 'a trunk beside a lit lane', lines: [line('x', 'active several', { lanes: 2 }), line('y', 'kin', { lanes: 2, trunk: { size: 4, members: ['m'] } })] },
    { name: 'a step line is not a connection', lines: [line('step', 'step active', { lanes: 3, trunk: { size: 2, members: [] } })] },
  ]
  return cases.map(({ name, lines }) => ({ name, lines, result: kindsOnScreen(lines) }))
}

export async function dumpTrunks(): Promise<unknown> {
  return {
    room: dumpRoom(),
    ...dumpFolds(),
    places: PLACES.map(p => ({ name: p.name, a: boxJson(p.a, p.shapes[0]), b: boxJson(p.b, p.shapes[1]), step: [{ lane: 0, lanes: 1, back: 0, stack: [0] }, { lane: 0, lanes: 2, back: 1, stack: [0, 1] }, { lane: 1, lanes: 2, back: 1, stack: [0, 1] }].map(slot => ({ slot, step: stackStep(p.a, p.b, slot) })) })),
    lanes: dumpLanes(),
    drawn: await dumpDrawn(),
    key: dumpKey(),
    fan: [[1, 5, 1], [7], [2, 2], [1, 12, 3, 1]].map(counts => ({
      counts, moved: counts.flatMap((n, lane) => Array.from({ length: n }, (_, within) => ({ lane, within, moved: round3(displacement({ lane, lanes: counts.length, back: 0, fan: counts, within }, REST, 400, 12)) }))),
    })),
  }
}

/** What the layout makes of a bundle: crossings counted N times M, a box a bundle runs through, the lanes a view hands the layout. */
export async function dumpLayoutLanes(): Promise<unknown> {
  const at2 = (...spots: [string, number, number][]) => new Map(spots.map(([id, x, y]) => [id, { x, y }]))
  const cross = at2(['a', 0, 0], ['b', 600, 0], ['c', 300, -300], ['d', 300, 300])
  const crossings = [[1, 1], [3, 2], [4, 1], [1, 5], [8, 8], [2, 3]].map(([n, m]) => ({ lanes: [n, m], score: tangle(cross, [{ from: 'a', to: 'b', lanes: n }, { from: 'c', to: 'd', lanes: m }]) }))
  const through = [-47, -42, 42, 47, 300].flatMap(y => [undefined, 1, 2, 3, 4, 8].map(lanes => ({
    y, lanes: lanes ?? null, score: tangle(at2(['a', -500, 0], ['b', 500, 0], ['c', 0, y]), [{ from: 'a', to: 'b', ...(lanes === undefined ? {} : { lanes }) }]),
  })))
  const moved = (() => {
    const edges = [{ from: 'a', to: 'b', lanes: 3 }, { from: 'c', to: 'd', lanes: 2 }, { from: 'a', to: 'd' }]
    const before = at2(['a', 0, 0], ['b', 600, 0], ['c', 300, -300], ['d', 300, 300])
    const after = at2(['a', 0, 0], ['b', 600, 0], ['c', 300, 100], ['d', 300, 400])
    return { edges, before: [...before], after: [...after], whole: [tangle(before, edges), tangle(after, edges)], onlyMoved: [tangle(before, edges, new Set(['c', 'd'])), tangle(after, edges, new Set(['c', 'd']))] }
  })()
  const state = await loadState(join(root, 'desktop/fixtures/cases/trunks/flowy'))
  if ('parseError' in state) throw new Error("the trunks case can't be read")
  const model = modelOf(state)
  return { crossings, through, moved, counts: [...laneCounts(computeView(model, 'root'))], mostLanes: MOST }
}
