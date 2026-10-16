import type { Model } from '../../src/core/model.ts'

/**
 * Objects whose name and id, together, hold every word of `query`, ignoring case. Names that start
 * with the first word come first, then the rest in model order. At most `limit` of them.
 */
export function findObjects(model: Model, query: string, limit = 8): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const name = (id: string) => String(model.objects[id].name ?? '').toLowerCase()
  const hits = Object.keys(model.objects).filter(id => words.every(w => `${name(id)} ${id}`.includes(w)))
  const starts = (id: string) => name(id).startsWith(words[0])
  return [...hits.filter(starts), ...hits.filter(id => !starts(id))].slice(0, limit)
}
