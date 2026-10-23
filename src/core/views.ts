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

/** Children by parent, built once per `objects` map. The model is immutable once loaded: an edit makes a new `objects`, so the map's identity is the key. */
const childIndex = new WeakMap<Model['objects'], Map<string, string[]>>()

function childrenOf(model: Model): Map<string, string[]> {
  let byParent = childIndex.get(model.objects)
  if (!byParent) {
    byParent = new Map()
    for (const id of Object.keys(model.objects)) {
      if (!getObject(model, id)) continue
      const parent = parentOf(model, id)
      const list = byParent.get(parent)
      if (list) list.push(id)
      else byParent.set(parent, [id])
    }
    childIndex.set(model.objects, byParent)
  }
  return byParent
}

export function memberIds(model: Model, view: string): string[] {
  return childrenOf(model).get(view)?.slice() ?? []
}

export const hasChildren = (model: Model, id: string) => childrenOf(model).has(id)

/** How many shapes sit directly inside `id`. */
export const childCount = (model: Model, id: string) => childrenOf(model).get(id)?.length ?? 0

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

/**
 * Where an outsider of view v meets v: the view both branches share, the box standing for v there (`here`) and the box standing for x
 * (`there`). Both are members of that view, so it shows how they sit side by side. Undefined for x itself being v or above it.
 */
export function meeting(model: Model, v: string, x: string): { view: string; here: string; there: string } | undefined {
  const cx = chain(model, x)
  const cv = chain(model, v)
  const i = cx.findIndex(a => cv.includes(a))
  const j = i < 0 ? -1 : cv.indexOf(cx[i])
  return i <= 0 || j <= 0 ? undefined : { view: cx[i], here: cv[j - 1], there: cx[i - 1] }
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
  const inView = new Set(members)
  const outsiders: string[] = []
  const seenOutside = new Set<string>()
  const edges = new Map<string, Edge>()
  for (const c of model.connections) {
    const ends = placeEnds(model, v, c.from, c.to)
    if (!ends) continue
    for (const end of ends) if (!inView.has(end) && !seenOutside.has(end)) { seenOutside.add(end); outsiders.push(end) }
    const key = JSON.stringify(ends)
    const edge = edges.get(key)
    if (edge) {
      edge.count++
      edge.label = `${edge.count} connections`
    } else edges.set(key, { from: ends[0], to: ends[1], label: typeof c.label === 'string' ? c.label : '', count: 1 })
  }
  return { id: v, members, outsiders, edges: [...edges.values()] }
}

/** What the canvas calls an object: its name, its id when it has none, and "Overview" for the top level. */
export const nameOf = (model: Model, id: string) => (id === ROOT ? 'Overview' : getObject(model, id)?.name || id)

/**
 * A step's ends as a reader sees them. `placed` is where the step lands in the view (see placeStep).
 * When an end lands on a box that stands for something inside it, both are named ("Scheduler in Core"),
 * so two steps on two parts of one box never read as a round trip. A step one box does on its own names
 * it once. The flow player shows this, and MCP's put_flow answers with it.
 */
export function stepEnds(model: Model, step: { from: string; to?: string }, placed: [string, string] | null | undefined): string {
  const real = [step.from, step.to ?? step.from]
  const drawn = placed ?? real
  const name = (i: number) => (drawn[i] === real[i] ? nameOf(model, real[i]) : `${nameOf(model, real[i])} in ${nameOf(model, drawn[i])}`)
  return step.to === undefined || step.to === step.from ? name(0) : `${name(0)} → ${name(1)}`
}
