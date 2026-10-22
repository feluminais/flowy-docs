import { compareOf, partnersOf } from '../../src/core/compare.ts'
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

/** The comparison an address names, side by side whatever mode it asked for (Swap is not built yet). `unplayable` when a flow of it is not there or can't play. */
export function fromAddress(model: Model, named: Compare | undefined): { compare?: Compare; unplayable?: boolean } {
  if (named === undefined || named.kind !== 'flow') return {}
  return playable(model, named.a) && playable(model, named.b) ? { compare: { ...named, mode: 'side' } } : { unplayable: true }
}

/** The two sides the other way round. */
export const flipped = (c: Compare): Compare => ({ ...c, a: c.b, b: c.a })

/** The comparison of flow `id` with the pick `other`: the one that holds the tag (the newer) second, else `id` first. */
export function pairOf(model: Model, id: string, other: string): Compare {
  const [a, b] = orderPair('flow', model.flows, id, other)
  return { kind: 'flow', a, b, mode: 'side' }
}
