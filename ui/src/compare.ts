import { compareOf, partnersOf } from '../../src/core/compare.ts'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'

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
