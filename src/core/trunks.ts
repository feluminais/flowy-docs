import { kindName, sameLook } from './kinds.ts'
import type { KindId } from './kinds.ts'
import { BOX, spotsOf } from './layout.ts'
import { FOLD_FROM, laneCapacity, OPEN_MOST, roomOf, round3 } from './lanes.ts'
import type { LaneBox } from './lanes.ts'
import { SHAPE_DEFS, shapeOf } from './look.ts'
import { getObject } from './model.ts'
import type { LineStyle, Model, Step } from './model.ts'
import { strandOf } from './strands.ts'
import { computeView } from './views.ts'
import type { Strand, View } from './views.ts'

/**
 * Many lines between two shapes. A pair draws at most `MOST` lines side by side, fewer where the shapes are short across the pair (see laneCapacity). A pair with more has its lines
 * folded into trunks: the lines that run the same way and share a kind become one lane with two hairlines behind it and a chip with the number of connections it holds. A trunk opens
 * into its lines (up to `OPEN_MOST`) while its pair is selected. A trunk never hides a connection: the panel of the pair lists every one.
 *
 * Where the folding stops depends on the room across the shapes, so it is worked out from where they are drawn (see drawnView). Everything here is pure; both readers use it, and the
 * desktop app has a twin of it, held equal by desktop/fixtures.
 */

/** The text between a trunk id's pair and ends and its kind: a control character, which YAML cannot hold, so no label can make a trunk's id the id of a strand. */
export const TRUNK_MARK = '\u0002'

/** The id of the trunk that stands for the lines of one direction and kind of a pair; `kind` is left out for a trunk of lines of different kinds, or of none. */
export const trunkId = (pair: string, from: string, to: string, kind: KindId | undefined): string => `${pair}|${from}>${to}|${TRUNK_MARK}${kind ?? ''}`

/** The words a trunk goes by where it has a name (its pill, its accessible name): the kind and the number of connections, or just the number for lines of no one kind. */
export const trunkLabel = (kind: KindId | undefined, size: number): string => (kind === undefined ? `${size} connections` : `${kindName(kind)} x${size}`)

/** Whether a strand runs from the later id of its pair to the earlier: the lanes of one way and the other are told apart by it (see slotsOf). */
const backward = (s: Strand): boolean => s.from > s.to

/** The strands grouped by the way they run and, with `byKind`, by kind; in the order of each group's first strand (the lanes are in order, the back ones first, so that is lane order). */
function groupsOf(strands: readonly Strand[], byKind: boolean): Strand[][] {
  const out = new Map<string, Strand[]>()
  for (const s of strands) {
    const key = `${backward(s) ? 'b' : 'f'}|${byKind ? s.kind ?? '' : ''}`
    const group = out.get(key)
    if (group) group.push(s)
    else out.set(key, [s])
  }
  return [...out.values()]
}

/** What folding a pair gave: its strands as they are drawn, and for each strand that was folded into a trunk, the id of the trunk. */
export type Folding = { strands: Strand[]; stands: Map<string, string> }

/** One trunk for a group of strands of one pair that run the same way. */
function trunkOf(group: readonly Strand[], lane: number, lanes: number): Strand {
  const first = group[0]
  const kind = group.every(s => s.kind === first.kind) ? first.kind : undefined
  const look = group.every(s => (s.look === undefined && first.look === undefined) || (s.look !== undefined && first.look !== undefined && sameLook(s.look, first.look))) ? first.look : undefined
  const connections = group.flatMap(s => s.connections)
  return {
    id: trunkId(first.pair, first.from, first.to, kind), pair: first.pair, from: first.from, to: first.to, label: trunkLabel(kind, connections.length), connections, lane, lanes,
    ...(kind === undefined ? {} : { kind }), ...(look === undefined ? {} : { look }), trunk: { size: connections.length, members: group.map(s => s.id) },
  }
}

/**
 * The lines of one pair as they are drawn, given `half`, the smaller half-room of its two shapes across it (see roomOf). `strands` are the pair's strands in lane order.
 * - They all fit (`laneCapacity`): as they are.
 * - They do not: one trunk for each way and kind (a group of one stays a lane). If the lanes that makes, with `TRUNK_EXTRA` more room for each trunk, fit, that is the folding.
 * - They do not: one trunk for each way, whatever the kinds. That is two lanes at most.
 * The lanes are numbered again (`lane`, `lanes`) for what is drawn.
 */
export function foldPair(strands: readonly Strand[], half: number): Folding {
  const bothWays = strands.some(backward) && strands.some(s => !backward(s))
  const same: Folding = { strands: [...strands], stands: new Map() }
  if (strands.length < 2 || strands.length <= laneCapacity(half, bothWays)) return same
  const byKind = groupsOf(strands, true)
  const groups = byKind.length <= laneCapacity(half, bothWays, byKind.filter(g => g.length > 1).length) ? byKind : groupsOf(strands, false)
  const out: Strand[] = []
  const stands = new Map<string, string>()
  groups.forEach((group, lane) => {
    if (group.length === 1) {
      out.push({ ...group[0], lane, lanes: groups.length })
      return
    }
    const trunk = trunkOf(group, lane, groups.length)
    for (const s of group) stands.set(s.id, trunk.id)
    out.push(trunk)
  })
  return { strands: out, stands }
}

/**
 * The view's strands folded pair by pair, and the id of the trunk for each strand that was folded. `half` says the smaller half-room of the shapes at the ends of a pair (see
 * roomOf), and is asked only for a pair with `FOLD_FROM` strands or more. A view that draws one line for each pair has no strands and nothing to fold.
 */
export function foldStrands(strands: readonly Strand[] | undefined, half: (from: string, to: string) => number): Folding | undefined {
  if (strands === undefined) return undefined
  const pairs = new Map<string, Strand[]>()
  for (const s of strands) {
    const list = pairs.get(s.pair)
    if (list) list.push(s)
    else pairs.set(s.pair, [s])
  }
  const out: Strand[] = []
  const stands = new Map<string, string>()
  for (const list of pairs.values()) {
    if (list.length < FOLD_FROM) {
      out.push(...list)
      continue
    }
    const folded = foldPair(list, half(list[0].from, list[0].to))
    out.push(...folded.strands)
    for (const [member, trunk] of folded.stands) stands.set(member, trunk)
  }
  return { strands: out, stands }
}

/**
 * The strands to draw when the pairs in `opened` are selected: a trunk of such a pair is replaced by the strands it folded, each in the trunk's lane, which then fan out of its place
 * (see Slot.fan), unless it holds more than `OPEN_MOST` of them. `unfolded` are the strands before folding, by id.
 */
export function openTrunks(strands: readonly Strand[], unfolded: ReadonlyMap<string, Strand>, opened: ReadonlySet<string>): Strand[] {
  if (opened.size === 0) return [...strands]
  return strands.flatMap(s => {
    if (s.trunk === undefined || !opened.has(s.pair) || s.trunk.members.length > OPEN_MOST) return [s]
    return s.trunk.members.map(id => ({ ...unfolded.get(id)!, lane: s.lane, lanes: s.lanes }))
  })
}

/** The pairs a selected line opens: the pair of the strand whose id it is, or the pair whose id it is. */
export function pairsOpenedBy(unfolded: readonly Strand[], selected: string | undefined): Set<string> {
  if (selected === undefined) return new Set()
  return new Set(unfolded.filter(s => s.id === selected || s.pair === selected).map(s => s.pair))
}

/** A view with its pairs folded where their lines do not fit: `view.strands` are the strands to draw, `stands` the trunk each folded strand is in, `unfolded` the view as computeView made it. */
export type Drawn = { view: View; stands: ReadonlyMap<string, string>; unfolded: View }

/**
 * The view as it is drawn in a line `style`: computeView's, with the strands of each pair that has too many for the room between its shapes folded into trunks. The room is measured
 * where the shapes are laid out (see spotsOf), each BOX big and with the outline of its shape; it is worked out only for a pair with `FOLD_FROM` strands or more.
 */
export function drawnView(model: Model, view: string, style: LineStyle = 'straight', computed: View = computeView(model, view)): Drawn {
  let at: ReturnType<typeof spotsOf> | undefined
  const box = (id: string): LaneBox => {
    at ??= spotsOf(model, view, computed, [...computed.members, ...computed.outsiders])
    const p = at.get(id) ?? { x: 0, y: 0 }
    const object = getObject(model, id)
    return { id, rect: { x: p.x, y: p.y, width: BOX.width, height: BOX.height }, edge: object === undefined ? [] : SHAPE_DEFS[shapeOf(object)].edge }
  }
  const folded = foldStrands(computed.strands, (from, to) => round3(roomOf(box(from), box(to), style)))
  if (folded === undefined) return { view: computed, stands: new Map(), unfolded: computed }
  return { view: { ...computed, strands: folded.strands }, stands: folded.stands, unfolded: computed }
}

/**
 * The id of the line a step rides as it is drawn: the id of the strand strandOf gives, or of its trunk where the pair folded its lines. Undefined for a step that rides none. `placed` is
 * where the step lands on the view (see placeStep).
 */
export function drawnStrandOf(model: Model, drawn: Drawn, step: Step, placed: readonly [string, string]): string | undefined {
  const id = strandOf(model, drawn.unfolded, step, placed)?.id
  return id === undefined ? undefined : drawn.stands.get(id) ?? id
}
