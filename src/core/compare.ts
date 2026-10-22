/**
 * The `compare` tag. A flow or a performance run can name the one it compares with: `compare: other-id`, or
 * `compare: { with: other-id, note: "text" }`. The holder is the newer one. The tag only helps people find a pair; it limits nothing.
 * This file reads the tag, finds a flow's partners and writes the tag back. Nothing here draws, and nothing needs a browser.
 */
import { hasText, isMap, own } from './text.ts'

export type CompareTag = { with: string; note?: string }

/** The tag a `compare` value says: an id, or a mapping with an id and maybe a note. Anything else is no tag (compareProblem says why). */
export function compareOf(value: unknown): CompareTag | undefined {
  if (hasText(value)) return { with: value }
  if (!isMap(value) || !hasText(value.with)) return undefined
  return hasText(value.note) ? { with: value.with, note: value.note } : { with: value.with }
}

/** What is wrong with a `compare` value, or undefined when it is absent or reads. `noun` is the kind the id names. */
export function compareProblem(value: unknown, noun: 'flow' | 'run'): string | undefined {
  if (value === undefined || compareOf(value)) return undefined
  return `compare must be a ${noun} id, or { with, note } with text`
}

/** Which side of the pair a partner stands on: the older one the item tags, or a newer one that tags the item. */
export type Partner = { id: string; side: 'before' | 'after'; note?: string }

/**
 * The partners of `id`: first what it tags (the older, `before`), then every item that tags it (the newer, `after`), in the order of the
 * keys. A pair that tag each other lists once, as `id`'s own tag. An item never lists itself. A tag to an item that is not there is still
 * listed, so a reader can show it greyed out.
 */
export function partnersOf(items: Record<string, { compare?: unknown }>, id: string): Partner[] {
  const out: Partner[] = []
  const add = (partner: string, side: Partner['side'], tag: CompareTag) => {
    if (partner === id || out.some(p => p.id === partner)) return
    out.push(tag.note === undefined ? { id: partner, side } : { id: partner, side, note: tag.note })
  }
  const mine = compareOf(items[id]?.compare)
  if (mine) add(mine.with, 'before', mine)
  for (const [other, item] of Object.entries(items)) {
    const tag = compareOf(item.compare)
    if (tag?.with === id) add(other, 'after', tag)
  }
  return out
}

/** Every id that tags another item or is tagged by one. A tag to an item that is not there, or to itself, links nothing. */
export function linkedIds(items: Record<string, { compare?: unknown }>): Set<string> {
  const out = new Set<string>()
  for (const [id, item] of Object.entries(items)) {
    const tag = compareOf(item.compare)
    if (!tag || tag.with === id || !Object.hasOwn(items, tag.with)) continue
    out.add(id)
    out.add(tag.with)
  }
  return out
}

/**
 * A copy of `item` with its `compare` set (the short form without a note, the long form with one) or removed when `tag` is undefined.
 * Every other key keeps its place. A tag the item already has stays where it is; a new one goes last.
 */
export function withCompare<T extends object>(item: T, tag: CompareTag | undefined): T {
  const value = tag && (tag.note === undefined ? tag.with : { with: tag.with, note: tag.note })
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(item)) {
    if (key !== 'compare') own(out, key, v)
    else if (value !== undefined) own(out, key, value)
  }
  if (value !== undefined && !('compare' in out)) own(out, 'compare', value)
  return out as T
}
