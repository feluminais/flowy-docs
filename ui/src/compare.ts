import { compareOf, partnersOf } from '../../src/core/compare.ts'
import type { CompareTag } from '../../src/core/compare.ts'
import type { Change, FlowDiff, SideMarks } from '../../src/core/flowdiff.ts'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { isView } from '../../src/core/views.ts'

/** What the comparison view shows: two flows or two runs, `a` first, side by side or swapped (one pane, flipping between them). The tag holder is `b`. */
export type Compare = { kind: 'flow' | 'run'; a: string; b: string; mode: 'side' | 'swap' }

/** One thing the picker offers: the flow or run, which side of a tagged pair it stands on, and whether the tag points at something that is not there. */
export type Choice = { id: string; name: string; side?: 'before' | 'after'; missing?: boolean }

const byName = (x: Choice, y: Choice): number => x.name.toLowerCase().localeCompare(y.name.toLowerCase()) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0)

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
 * older. `note` is trimmed; blank is no note, which writes the short form.
 */
export function saveTarget(kind: 'flow' | 'run', items: Tagged, a: string, b: string, note = ''): { id: string; tag: CompareTag } {
  const [older, newer] = orderPair(kind, items, a, b)
  const id = noteOf(items, a, b).holder ?? newer
  const text = note.trim()
  return { id, tag: text === '' ? { with: id === newer ? older : newer } : { with: id === newer ? older : newer, note: text } }
}

/** Why a note can't be written, or undefined when it can: the page has to be one that saves. The reason is the tooltip of the greyed control. */
export const noteOff = (live: boolean, readOnly: boolean): string | undefined => (live && !readOnly ? undefined : "This page can't save")

/** Why a pair can't be saved as one (a pair needs two), or undefined. */
export const pairOff = (kind: 'flow' | 'run', a: string, b: string): string | undefined => (a === b ? `Needs two different ${kind}s` : undefined)

/** Whether the text in the note editor would be lost by leaving: it is not what the pair holds, and it is not just blank where nothing is held. */
export const unsaved = (draft: string | undefined, saved: string): boolean => draft !== undefined && draft.trim() !== saved

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

/** The comparison an address names, in the mode it asked for. `unplayable` when a flow of it is not there or can't play. */
export function fromAddress(model: Model, named: Compare | undefined): { compare?: Compare; unplayable?: boolean } {
  if (named === undefined || named.kind !== 'flow') return {}
  return playable(model, named.a) && playable(model, named.b) ? { compare: named } : { unplayable: true }
}

/** The two sides the other way round. */
export const flipped = (c: Compare): Compare => ({ ...c, a: c.b, b: c.a })

/** The comparison of flow `id` with the pick `other`: the one that holds the tag (the newer) second, else `id` first. */
export function pairOf(model: Model, id: string, other: string): Compare {
  const [a, b] = orderPair('flow', model.flows, id, other)
  return { kind: 'flow', a, b, mode: 'side' }
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
