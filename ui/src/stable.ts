import { useCallback, useRef } from 'react'

/** What was handed on last time: each item by its id, and the list they made. */
export type Kept<T> = { byId: ReadonlyMap<string, T>; list: readonly T[] }

/** Nothing kept yet. Typed as holding anything, since there is nothing in it to be wrong. */
export const nothingKept: Kept<any> = { byId: new Map(), list: [] } // eslint-disable-line @typescript-eslint/no-explicit-any

const isPlain = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Whether two values say the same: equal, or plain objects and arrays whose parts say the same, `depth` levels down. Functions and class instances are the same only when they are. */
export function sameInside(a: unknown, b: unknown, depth = 3): boolean {
  if (a === b) return true
  if (depth === 0) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameInside(x, b[i], depth - 1))
  if (!isPlain(a) || !isPlain(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b, k) && sameInside(a[k], b[k], depth - 1))
}

/**
 * The items of the canvas, as the same objects as last time wherever they say the same thing. React Flow rebuilds what it holds for a node or a line it is handed as a new object, and
 * every shape and line re-draws with it; a hover or a drag changes one or two. The list is the same list too when nothing in it changed.
 */
export function keepSame<T extends { id: string }>(was: Kept<T>, next: readonly T[]): Kept<T> {
  const byId = new Map<string, T>()
  const list = next.map(item => {
    const before = was.byId.get(item.id)
    const kept = before !== undefined && sameInside(before, item) ? before : item
    byId.set(item.id, kept)
    return kept
  })
  const unchanged = list.length === was.list.length && list.every((item, i) => item === was.list[i])
  return unchanged ? was : { byId, list }
}

/** A function that never changes and calls the one it was last given, so what is handed it (a prop of a memoised part) does not see a new function on every render. */
export function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const latest = useRef(fn)
  latest.current = fn
  return useCallback((...args: A) => latest.current(...args), [])
}
