import { compareOf, partnersOf } from '../../src/core/compare.ts'
import type { CompareTag } from '../../src/core/compare.ts'
import type { Change, FlowDiff, SideMarks } from '../../src/core/flowdiff.ts'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { isView, nameOf } from '../../src/core/views.ts'

/** What the comparison view shows: two flows or two runs, `a` first, side by side or swapped (one pane, flipping between them). The tag holder is `b`. */
export type Compare = { kind: 'flow' | 'run'; a: string; b: string; mode: 'side' | 'swap' }

/** One thing the picker offers: the flow or run, which side of a tagged pair it stands on, and whether the tag points at something that is not there. */
export type Choice = { id: string; name: string; side?: 'before' | 'after'; missing?: boolean }

/**
 * Name, lower-cased, then id, each by UTF-16 code unit: not a locale collation (like `lower()` in core/outline.ts), so the C# readers' ordinal compare of
 * `ToLowerInvariant()` text gives the same order for every name, accented and Cyrillic ones included.
 */
const byLowerName = (x: { id: string; name: string }, y: { id: string; name: string }): number => {
  const [a, b] = [x.name.toLowerCase(), y.name.toLowerCase()]
  if (a !== b) return a < b ? -1 : 1
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}
const byName = (x: Choice, y: Choice): number => byLowerName(x, y)

/**
 * What `id` can be compared with: `linked` are the ones it tags (the older) and then the ones that tag it (the newer), the order `partnersOf` gives; a
 * tag to something that is not there stays, marked `missing`, named by its id. `others` is every other flow (or run), by name. `id` is never listed.
 */
export function choicesFor(model: Model, runs: Record<string, Run>, kind: 'flow' | 'run', id: string): { linked: Choice[]; others: Choice[] } {
  const items: Record<string, { name?: string; compare?: unknown }> = kind === 'flow' ? model.flows : runs
  const nameOf = (key: string): string => items[key]?.name || key
  const linked: Choice[] = partnersOf(items, id).map(p => (Object.hasOwn(items, p.id) ? { id: p.id, name: nameOf(p.id), side: p.side } : { id: p.id, name: p.id, side: p.side, missing: true }))
  const taken = new Set([id, ...linked.map(c => c.id)])
  const others: Choice[] = Object.keys(items).filter(key => !taken.has(key)).map(key => ({ id: key, name: nameOf(key) })).sort(byName)
  return { linked, others }
}

/** One flow the edit form can show as a tile: its id, its name (the id when it has none) and the name of the view it plays in. */
export type FlowTile = { id: string; name: string; view: string }

/** The tile of a flow that is there. */
export const flowTile = (model: Model, id: string): FlowTile => ({ id, name: model.flows[id].name || id, view: nameOf(model, model.flows[id].view) })
const byTileName = (x: FlowTile, y: FlowTile): number => byLowerName(x, y)

/** What the edit form's Compare with offers for flow `flowId`: every other flow, by name. The flow itself is never offered, since a flow can't compare with itself. */
export const partnerChoices = (model: Model, flowId: string): FlowTile[] => Object.keys(model.flows).filter(id => id !== flowId).map(id => flowTile(model, id)).sort(byTileName)

/** The flows that tag flow `flowId` (its newer partners), by name. A flow that tags it and is tagged by it back is the form's own partner, so it is not listed again. */
export const taggedBy = (model: Model, flowId: string): FlowTile[] =>
  partnersOf(model.flows as Record<string, { name?: string; compare?: unknown }>, flowId).filter(p => p.side === 'after' && Object.hasOwn(model.flows, p.id)).map(p => flowTile(model, p.id)).sort(byTileName)

/** The tag flow `flowId` gets when `partner` is picked, keeping the note it had; no partner is no tag. */
export function tagWith(model: Model, flowId: string, partner: string | undefined): CompareTag | undefined {
  if (partner === undefined) return undefined
  const note = Object.hasOwn(model.flows, flowId) ? compareOf(model.flows[flowId].compare)?.note : undefined
  return note === undefined ? { with: partner } : { with: partner, note }
}

/** Whether taking a tag out loses something the reader wrote: a note belongs to its link, so removing the link asks first. With no note, removing is one click. */
export const removeNeedsConfirm = (tag: CompareTag | undefined): boolean => tag?.note !== undefined

/** The pair in the order it reads: the one that holds the tag (the newer) second. With no tag between them, the order given. */
export function orderPair(kind: 'flow' | 'run', items: Record<string, { name?: string; compare?: unknown }>, a: string, b: string): [string, string] {
  void kind
  if (a !== b && compareOf(items[a]?.compare)?.with === b) return [b, a]
  return [a, b]
}

type Tagged = Record<string, { name?: string; compare?: unknown }>

/**
 * The saved note of the pair `a` and `b`, whichever way round they are given, and which of them holds the line that has it (`holder`; none when no tag joins them).
 * When both tag each other, the line with a note is the one shown, the newer's (see orderPair) first. A tag to some other item is not this pair's.
 */
export function noteOf(items: Tagged, a: string, b: string): { text: string; holder?: string } {
  if (a === b) return { text: '' }
  const [older, newer] = orderPair('flow', items, a, b)
  const lines = [[newer, older], [older, newer]].flatMap(([id, other]) => {
    const tag = compareOf(items[id]?.compare)
    return tag?.with === other ? [{ id, note: tag.note }] : []
  })
  const line = lines.find(l => l.note !== undefined) ?? lines[0]
  return line === undefined ? { text: '' } : { text: line.note ?? '', holder: line.id }
}

/**
 * Where a note on the pair `a`, `b` is saved and with what tag: on the line the pair has, else on the second of the pair (the newer, on the right), naming the first as the
 * older. A pair with no line never takes a link away without saying: when the newer already links to some other flow and the older links to none, the line goes to the older
 * instead; when both link elsewhere, the newer is the target and `replaces` is the id its old link named, for the confirm to say. `note` is trimmed; blank is no note, which
 * writes the short form.
 */
export function saveTarget(kind: 'flow' | 'run', items: Tagged, a: string, b: string, note = ''): { id: string; tag: CompareTag; replaces?: string } {
  const [older, newer] = orderPair(kind, items, a, b)
  const held = noteOf(items, a, b).holder
  const linked = (id: string): string | undefined => compareOf(items[id]?.compare)?.with
  const id = held ?? (linked(newer) !== undefined && linked(older) === undefined ? older : newer)
  const text = note.trim()
  const tag: CompareTag = { with: id === newer ? older : newer, ...(text === '' ? {} : { note: text }) }
  const replaces = held === undefined ? linked(id) : undefined
  return replaces === undefined ? { id, tag } : { id, tag, replaces }
}

/** One key for the pair whichever way round it is given: the draft note and the confirm belong to the pair, not to a side. */
export const pairKey = (a: string, b: string): string => [a, b].sort().join('|')

/** Why a note can't be written, or undefined when it can: the page has to be one that saves. The reason is the tooltip of the greyed control. */
export const noteOff = (live: boolean, readOnly: boolean): string | undefined => (live && !readOnly ? undefined : "This page can't save")

/** Why a pair can't be saved as one (a pair needs two), or undefined. */
export const pairOff = (kind: 'flow' | 'run', a: string, b: string): string | undefined => (a === b ? `Needs two different ${kind}s` : undefined)

/** Whether the text in the note editor would be lost by leaving: it is not what the pair holds, and it is not just blank where nothing is held. */
export const unsaved = (draft: string | undefined, saved: string): boolean => draft !== undefined && draft.trim() !== saved.trim()

/** A note typed on a pair and not yet saved, with the note the pair held when it was typed (to tell a draft that differs from it). */
export type Draft = { text: string; saved: string }

/** The drafts of every pair that has one, by `draftKey`. A new map on every change, so a state hook sees it. */
export type Drafts = ReadonlyMap<string, Draft>

/** The key of the pair `a`, `b` of `kind` in the drafts: the same whichever way round the pair is given. */
export const draftKey = (kind: 'flow' | 'run', a: string, b: string): string => `${kind}:${pairKey(a, b)}`

/** The drafts with `text` kept for pair `key`, or with that pair's draft taken out when `text` is undefined. The other pairs' drafts stay as they are. */
export function withDraft(drafts: Drafts, key: string, text: string | undefined, saved: string): Drafts {
  const next = new Map(drafts)
  if (text === undefined) next.delete(key)
  else next.set(key, { text, saved })
  return next
}

/** Whether leaving the page would lose a note: some pair, not just the one on show, has a draft that differs from what it held. */
export const keepsDrafts = (drafts: Drafts): boolean => [...drafts.values()].some(d => unsaved(d.text, d.saved))

/** What a click in a pane picked: a shape, or a line with the view its pane draws (the same two shapes can be joined differently in another view). */
export type Picked = { kind: 'object'; id: string } | { kind: 'line'; from: string; to: string; view: string }

/** Whether the panel already shows what was clicked, so a second click on it closes the panel, as on the single canvas. */
export function samePick(shown: { kind: string; id?: string; from?: string; to?: string; view?: string } | undefined, picked: Picked): boolean {
  if (shown === undefined || shown.kind !== picked.kind) return false
  return picked.kind === 'object' ? shown.id === picked.id : shown.from === picked.from && shown.to === picked.to && shown.view === picked.view
}

/** A flow the player can play: it has steps and its view opens. Opening a comparison needs both flows to be one. */
export const playable = (model: Model, id: string): boolean => Object.hasOwn(model.flows, id) && model.flows[id].steps.length > 0 && isView(model, model.flows[id].view)

/** Why Compare is blocked, or undefined when it is not: the reason goes in the button's tooltip. */
export const compareOff = (model: Model, editing: boolean): string | undefined =>
  editing ? 'Not while editing' : Object.keys(model.flows).length < 2 ? 'No other flow' : undefined

/** The first flow `id` is linked to that is there, or undefined: what C opens beside the flow playing. */
export const firstLinked = (model: Model, id: string): string | undefined => choicesFor(model, {}, 'flow', id).linked.find(c => !c.missing)?.id

/** Why the Compare button of the Performance tab is blocked, or undefined: there has to be a second run. */
export const runCompareOff = (runs: Record<string, Run>, editing: boolean): string | undefined =>
  editing ? 'Not while editing' : Object.keys(runs).length < 2 ? 'No other run' : undefined

/** The first run `id` is linked to that is there, or undefined: what C opens beside the run the Performance tab shows. */
export const firstLinkedRun = (model: Model, runs: Record<string, Run>, id: string): string | undefined => choicesFor(model, runs, 'run', id).linked.find(c => !c.missing)?.id

/** The runs that are linked to another run that is there, either way round: the Performance tab's run picker marks them. */
export function linkedRuns(runs: Record<string, Run>): Set<string> {
  const linked = new Set<string>()
  for (const id of Object.keys(runs)) {
    const to = compareOf(runs[id].compare)?.with
    if (to !== undefined && to !== id && Object.hasOwn(runs, to)) {
      linked.add(id)
      linked.add(to)
    }
  }
  return linked
}

/** A run the comparison can open: it is there. (A run needs no steps to be played: it is drawn at any place along it.) */
export const openable = (runs: Record<string, Run>, id: string): boolean => Object.hasOwn(runs, id)

/**
 * The comparison an address names, in the mode it asked for. `notice` says why none opened when a flow of it is not there or can't play, or a run of it is not there: a link
 * to a comparison that can't open shows it, and the page stays as it was.
 */
export function fromAddress(model: Model, runs: Record<string, Run>, named: Compare | undefined): { compare?: Compare; notice?: string } {
  if (named === undefined) return {}
  if (named.kind === 'run') return openable(runs, named.a) && openable(runs, named.b) ? { compare: named } : { notice: "That run can't open." }
  return playable(model, named.a) && playable(model, named.b) ? { compare: named } : { notice: "That flow can't play yet." }
}

/** The two sides the other way round. */
export const flipped = (c: Compare): Compare => ({ ...c, a: c.b, b: c.a })

/** The comparison of flow `id` with the pick `other`: the one that holds the tag (the newer) second, else `id` first. */
export function pairOf(model: Model, id: string, other: string): Compare {
  const [a, b] = orderPair('flow', model.flows, id, other)
  return { kind: 'flow', a, b, mode: 'side' }
}

/** The comparison of run `id` with the pick `other`: the one that holds the tag (the newer) second, else `id` first. */
export function runPairOf(runs: Record<string, Run>, id: string, other: string): Compare {
  const [a, b] = orderPair('run', runs, id, other)
  return { kind: 'run', a, b, mode: 'side' }
}

/** What the key and the marks call each kind of change. */
export const CHANGE_NAMES: Record<Change, string> = { new: 'New', removed: 'Removed', changed: 'Changed' }

/** The kinds in the order the key lists them. */
const CHANGE_ORDER: Change[] = ['new', 'removed', 'changed']

/** The marks one side of the comparison draws: the older flow's pane takes `older`, the newer flow's pane (the one that holds the tag) takes `newer`. */
export const marksFor = (diff: FlowDiff, which: 'older' | 'newer'): SideMarks => diff[which]

/** The kind of change a record marks for `key`, or nothing. The key may be any text an id can be, so only its own entries count. */
export const changeAt = <K extends string | number>(marks: Record<K, Change> | undefined, key: K): Change | undefined => (marks && Object.hasOwn(marks, key) ? marks[key] : undefined)

/** The mark of a stop's cell in the progress bar, from the file step numbers it plays: that of its steps when they agree, else Changed (parallel steps can hold a new one and an old one). */
export function changeOfStop(steps: number[], changes: Record<number, Change>): Change | undefined {
  const kinds = new Set(steps.flatMap(i => changeAt(changes, i) ?? []))
  return kinds.size === 0 ? undefined : kinds.size === 1 ? [...kinds][0] : 'changed'
}

/**
 * The kinds of change the key lists: those present on the sides on screen (both side by side, the one on show in Swap), in a fixed order. Flows that share no shape have no marks
 * and no key items, only `related: false`, for the key to say so; it is never "everything changed".
 */
export function keyItems(diff: FlowDiff, sides: ('older' | 'newer')[] = ['older', 'newer']): { items: Change[]; related: boolean } {
  if (!diff.related) return { items: [], related: false }
  const present = new Set<Change>()
  for (const side of sides.map(which => diff[which])) for (const marks of [side.steps, side.shapes, side.lines]) for (const kind of Object.values(marks)) present.add(kind)
  return { items: CHANGE_ORDER.filter(kind => present.has(kind)), related: true }
}
