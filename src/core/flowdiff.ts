import { lineKey } from './failures.ts'
import type { Flow, Step } from './model.ts'
import { isMap, own } from './text.ts'

/**
 * What changed between two flows: an older one and a newer one. The change marks of the compare view read this. A C# twin must give the
 * same answer, so every choice below is spelled out.
 *
 * The flows are compared by their own data (each step's `from`, `to` and `text`), not by what a view draws. A shape's identity is its
 * object id. A line's identity is the canvas's line id (`lineKey` of the two ends). A step with no `to` touches its `from` shape only and
 * no line. Steps are numbered from 0 in file order.
 *
 * Steps:
 * 1. A step's key is its `from`, `to` (empty when absent) and `text`. Two steps with the same key are the same step.
 * 2. The steps of the two flows are matched in order with a longest common subsequence of keys. When the older step and the newer step
 *    at the cursor have the same key they are matched. Otherwise, if skipping the older step keeps the best length (it is at least as
 *    long as skipping the newer step), the older step is skipped; if not, the newer step is skipped. So a tie skips the older step.
 * 3. A matched pair is `changed` on both sides when its `animation` or its `description` differ, compared in a canonical form:
 *    a missing value (or, for the animation, an empty text) equals nothing; a bare text animation counts as a mapping with that text as
 *    its `kind` (the model reads it so); then the value is written as JSON text with the keys of every mapping sorted in code point
 *    order, at every level, and lists kept in order. So reordered keys, or `pulse` against `{kind: pulse}`, are not a change. Otherwise
 *    the pair carries no mark.
 * 4. An older step with no match is `removed`, a newer one `new`. Then, taking the unmatched older steps in order, each one is paired
 *    with the first still unpaired unmatched newer step that has the same `from` and `to`. A pair is `changed` on both sides. This is
 *    by position among the leftovers with those ends, and need not keep the order of the two flows (older A, B against newer D, C can
 *    pair A with C and B with D).
 *
 * Shapes and lines: one that only the older flow's steps use is `removed` (marked on the older side); one that only the newer flow's
 * steps use is `new` (marked on the newer side). One that both flows use is `changed` on both sides when any step of either flow that
 * uses it is marked (changed, new or removed), and unmarked otherwise.
 *
 * Known limit: fields other than `from`, `to`, `text`, `animation` and `description` (states, group, lane, flow and any extra) are not compared.
 *
 * `related` is true when the flows share a shape. When they share none, every record is empty: nothing is "everything changed".
 */
export type Change = 'new' | 'removed' | 'changed'
/** Steps by file step number from 0; shapes by object id; lines by the canvas's line id. */
export type SideMarks = { steps: Record<number, Change>; shapes: Record<string, Change>; lines: Record<string, Change> }
export type FlowDiff = { related: boolean; older: SideMarks; newer: SideMarks }

const none = (): SideMarks => ({ steps: {}, shapes: {}, lines: {} })

const keyOf = (s: Step): string => `${s.from}\u0000${s.to ?? ''}\u0000${s.text}`
const endsOf = (s: Step): string => `${s.from}\u0000${s.to ?? ''}`
const byCodePoint = (a: string, b: string): number => {
  const x = Array.from(a)
  const y = Array.from(b)
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i].codePointAt(0)! - y[i].codePointAt(0)!
  return x.length - y.length
}
/** The value as JSON text with the keys of every mapping sorted by code point, so equal values give equal text. */
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`
  if (isMap(v)) return `{${Object.keys(v).sort(byCodePoint).map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
  return JSON.stringify(v) ?? 'undefined'
}
const animationText = (v: unknown): string => canon(v === '' ? undefined : typeof v === 'string' ? { kind: v } : v)
const sameAnimation = (a: unknown, b: unknown): boolean => animationText(a) === animationText(b)
const sameText = (a: unknown, b: unknown): boolean => canon(a) === canon(b)

/** Pairs of step indexes (older, newer) that the longest common subsequence matches, in order. */
function matchSteps(older: Step[], newer: Step[]): [number, number][] {
  const a = older.map(keyOf)
  const b = newer.map(keyOf)
  const w = b.length + 1
  // best[i * w + j] is the longest common subsequence of a[i..] and b[j..].
  const best = new Uint32Array((a.length + 1) * w)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      best[i * w + j] = a[i] === b[j] ? best[(i + 1) * w + j + 1] + 1 : Math.max(best[(i + 1) * w + j], best[i * w + j + 1])
    }
  }
  const pairs: [number, number][] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++ }
    else if (best[(i + 1) * w + j] >= best[i * w + j + 1]) i++
    else j++
  }
  return pairs
}

/** The shapes and lines a flow's steps use, each with the indexes of the steps on it. */
function usage(steps: Step[]): { shapes: Map<string, number[]>; lines: Map<string, number[]> } {
  const shapes = new Map<string, number[]>()
  const lines = new Map<string, number[]>()
  const add = (map: Map<string, number[]>, id: string, step: number) => {
    const list = map.get(id)
    if (list) list.push(step)
    else map.set(id, [step])
  }
  steps.forEach((s, n) => {
    add(shapes, s.from, n)
    if (s.to !== undefined && s.to !== '') {
      add(shapes, s.to, n)
      add(lines, lineKey(s.from, s.to), n)
    }
  })
  return { shapes, lines }
}

export function diffFlows(older: Flow, newer: Flow): FlowDiff {
  const use = { older: usage(older.steps), newer: usage(newer.steps) }
  const related = [...use.older.shapes.keys()].some(id => use.newer.shapes.has(id))
  if (!related) return { related, older: none(), newer: none() }

  const result = { related, older: none(), newer: none() }
  const matchedOlder = new Set<number>()
  const matchedNewer = new Set<number>()
  for (const [i, j] of matchSteps(older.steps, newer.steps)) {
    matchedOlder.add(i)
    matchedNewer.add(j)
    const o = older.steps[i]
    const n = newer.steps[j]
    if (!sameAnimation(o.animation, n.animation) || !sameText(o.description, n.description)) {
      result.older.steps[i] = 'changed'
      result.newer.steps[j] = 'changed'
    }
  }

  const leftNewer: number[] = []
  newer.steps.forEach((_, j) => { if (!matchedNewer.has(j)) leftNewer.push(j) })
  const paired = new Set<number>()
  older.steps.forEach((o, i) => {
    if (matchedOlder.has(i)) return
    const at = leftNewer.find(j => !paired.has(j) && endsOf(newer.steps[j]) === endsOf(o))
    if (at === undefined) { result.older.steps[i] = 'removed'; return }
    paired.add(at)
    result.older.steps[i] = 'changed'
    result.newer.steps[at] = 'changed'
  })
  for (const j of leftNewer) if (!paired.has(j)) result.newer.steps[j] = 'new'

  const marked = (side: 'older' | 'newer', steps: number[]) => steps.some(n => result[side].steps[n] !== undefined)
  const mark = (kind: 'shapes' | 'lines') => {
    const o = use.older[kind]
    const n = use.newer[kind]
    for (const [id, steps] of o) {
      const other = n.get(id)
      if (!other) own(result.older[kind], id, 'removed')
      else if (marked('older', steps) || marked('newer', other)) { own(result.older[kind], id, 'changed'); own(result.newer[kind], id, 'changed') }
    }
    for (const id of n.keys()) if (!o.has(id)) own(result.newer[kind], id, 'new')
  }
  mark('shapes')
  mark('lines')
  return result
}
