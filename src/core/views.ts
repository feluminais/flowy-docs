import { getObject, ROOT } from './model.ts'
import type { Model } from './model.ts'

export type Edge = { from: string; to: string; label: string; count: number }
export type View = { id: string; members: string[]; outsiders: string[]; edges: Edge[] }

/** The view an object sits in: its parent, or root when it has none or a broken one (missing, or itself). */
export function parentOf(model: Model, id: string): string {
  const parent = getObject(model, id)?.in
  return typeof parent === 'string' && parent !== id && getObject(model, parent) ? parent : ROOT
}

/** [id, parent, grandparent, ..., root]. Stops at cycles, which the checker reports. */
export function chain(model: Model, id: string): string[] {
  const out = [id]
  let cur = id
  while (cur !== ROOT) {
    cur = parentOf(model, cur)
    if (out.includes(cur)) break
    out.push(cur)
  }
  if (out.at(-1) !== ROOT) out.push(ROOT)
  return out
}

export function memberIds(model: Model, view: string): string[] {
  return Object.keys(model.objects).filter(id => getObject(model, id) && parentOf(model, id) === view)
}

// ponytail: scans every object per call; fine for hundreds of objects, index children by parent if views get slow
export const hasChildren = (model: Model, id: string) => memberIds(model, id).length > 0

/** Whether `id` can be the view of a flow, or the place a problem opens: the top level, or an object with children. */
export const isView = (model: Model, id: string) => id === ROOT || (getObject(model, id) !== undefined && hasChildren(model, id))

/** The box standing for x inside view v (x or one of its ancestors), if x is inside v. */
function rep(model: Model, x: string, v: string): string | undefined {
  const c = chain(model, x)
  const i = c.indexOf(v)
  return i > 0 ? c[i - 1] : undefined
}

/**
 * For x outside v: x's ancestor just below the point where x's branch meets v's.
 * When x is v itself or one of v's ancestors (a line to the box you're inside), it's x.
 */
function outsider(model: Model, x: string, v: string): string {
  const cx = chain(model, x)
  const cv = chain(model, v)
  const i = cx.findIndex(a => cv.includes(a))
  return i <= 0 ? x : cx[i - 1]
}

/** Where a from → to line lands in view v, or null when v can't show it (or an end doesn't exist). */
export function placeEnds(model: Model, v: string, from: string, to: string): [string, string] | null {
  if (!getObject(model, from) || !getObject(model, to)) return null
  const a = rep(model, from, v)
  const b = rep(model, to, v)
  if (a === undefined && b === undefined) return null
  const ends: [string, string] = [a ?? outsider(model, from, v), b ?? outsider(model, to, v)]
  return ends[0] === ends[1] ? null : ends
}

/**
 * Where a flow step lands in view v. A step with no `to` is one box acting on its own: the box inside
 * the view that stands for it, given twice. Null when the view can't show the step. Like a line with
 * both ends outside, a one-box step on something outside the view has nothing in the view to show.
 */
export function placeStep(model: Model, v: string, step: { from: string; to?: string }): [string, string] | null {
  if (step.to !== undefined) return placeEnds(model, v, step.from, step.to)
  const box = getObject(model, step.from) ? rep(model, step.from, v) : undefined
  return box === undefined ? null : [box, box]
}

export function computeView(model: Model, v: string): View {
  const members = memberIds(model, v)
  const outsiders: string[] = []
  const edges = new Map<string, Edge>()
  for (const c of model.connections) {
    const ends = placeEnds(model, v, c.from, c.to)
    if (!ends) continue
    for (const end of ends) if (!members.includes(end) && !outsiders.includes(end)) outsiders.push(end)
    const key = JSON.stringify(ends)
    const edge = edges.get(key)
    if (edge) {
      edge.count++
      edge.label = `${edge.count} connections`
    } else edges.set(key, { from: ends[0], to: ends[1], label: typeof c.label === 'string' ? c.label : '', count: 1 })
  }
  return { id: v, members, outsiders, edges: [...edges.values()] }
}
