/**
 * What the navigator shows: the shapes of a model as a tree with the flows under the systems they play in, the flows grouped
 * by where they play, and the keys that move about the tree. Nothing here draws, so the canvas and the desktop app each draw
 * these rows and agree on what is on them. desktop/Flowy.Core/Outline.cs is a port, and desktop/fixtures/outline.ts keeps the two equal.
 */
import type { Problem } from './problem.ts'
import { getObject, isExternal, ROOT } from './model.ts'
import type { Model } from './model.ts'
import { chain, nameOf, parentOf } from './views.ts'

/** One line of the tree: the project, a shape, or a flow. */
export type OutlineRow = {
  /** `shape:<id>` or `flow:<id>`, unique across both, since a flow may share a shape's id. The project is `shape:root`. */
  key: string
  kind: 'shape' | 'flow'
  id: string
  /** The shape (or ROOT) it sits under. The project has none. */
  parent?: string
  depth: number
  name: string
  /** A shape's type, as the file wrote it. */
  type?: string
  external: boolean
  /** Shapes inside it, at every level. 0 for a flow. */
  shapes: number
  /** Flows inside it, at every level. 0 for a flow. */
  flows: number
  /** A flow's number of steps. */
  steps?: number
  /** A problem in it, or in anything inside it. */
  problem: boolean
  /** Whether rows can sit below it. */
  expandable: boolean
  expanded: boolean
  /** Whether the filter matched this row itself. Every row matches when there is no filter. */
  match: boolean
}

export type Outline = { rows: OutlineRow[]; totals: { shapes: number; flows: number; problems: number } }

export type OutlineOptions = {
  /** The shapes whose children show. The project's own id is ROOT. */
  expanded: ReadonlySet<string>
  /** Shows only the rows that contain these letters (names and ids, any case) and the shapes they sit in. */
  filter?: string
  /** A flow with no steps is listed only while editing. */
  editing?: boolean
  problems?: readonly Problem[]
}

type Tree = {
  /** Shapes by what they sit in (ROOT for the top level), in the tree's order (see `sorted`). */
  kids: Map<string, string[]>
  /** Flows by the view they play in, by name: those a reader can play, or all of them while editing. A flow whose view can't open is left out. */
  flowsIn: Map<string, string[]>
  /** Every shape reachable from ROOT, each before what is inside it. */
  preorder: string[]
}

// ponytail: ordinal on the lower-cased text, not a locale collation, so the C# port gives the same order. "é" sorts after "z" here;
// switch both sides to a shared collation if names in accented scripts need to sort by letter.
/** -1, 0 or 1 by name as VS Code's Explorer sorts: any case, and a run of digits counts as a number ("step 2" before "step 10"). */
function byName(a: string, b: string): number {
  const x = lower(a).split(/(\d+)/)
  const y = lower(b).split(/(\d+)/)
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] === y[i]) continue
    if (i % 2 === 1) { // both are digit runs
      const [m, n] = [x[i].replace(/^0+(?=\d)/, ''), y[i].replace(/^0+(?=\d)/, '')]
      if (m.length !== n.length) return m.length < n.length ? -1 : 1
      if (m !== n) return m < n ? -1 : 1
      continue // 007 and 7 are the same number
    }
    return x[i] < y[i] ? -1 : 1
  }
  return Math.sign(x.length - y.length) // one is the start of the other
}

const byNameThenId = (name: (id: string) => string) => (a: string, b: string) => byName(name(a), name(b)) || (a < b ? -1 : a > b ? 1 : 0)

function treeOf(model: Model, editing: boolean): Tree {
  const kids = new Map<string, string[]>()
  for (const id of Object.keys(model.objects)) {
    if (!getObject(model, id)) continue
    const parent = parentOf(model, id)
    const list = kids.get(parent)
    if (list) list.push(id)
    else kids.set(parent, [id])
  }
  const flowsIn = new Map<string, string[]>()
  for (const [id, flow] of Object.entries(model.flows)) {
    if (!editing && flow.steps.length === 0) continue
    if (flow.view !== ROOT && !kids.has(flow.view)) continue
    const list = flowsIn.get(flow.view)
    if (list) list.push(id)
    else flowsIn.set(flow.view, [id])
  }
  // As in VS Code's Explorer: a shape that holds others comes first, as a folder does, then the rest, each group by name.
  const folder = (id: string) => kids.has(id) || flowsIn.has(id)
  const byShape = byNameThenId(id => nameOf(model, id))
  for (const list of kids.values()) list.sort((a, b) => Number(folder(b)) - Number(folder(a)) || byShape(a, b))
  for (const list of flowsIn.values()) list.sort(byNameThenId(id => model.flows[id].name || id))
  // A loop of shapes inside each other is never reached from ROOT, and a stack (not recursion) keeps a long chain from overflowing.
  const preorder: string[] = []
  const stack = [...(kids.get(ROOT) ?? [])].reverse()
  while (stack.length > 0) {
    const id = stack.pop()!
    preorder.push(id)
    const below = kids.get(id)
    if (below) for (let i = below.length - 1; i >= 0; i--) stack.push(below[i])
  }
  return { kids, flowsIn, preorder }
}

/** Shapes and flows inside each shape (and the project), at every level. */
function countsOf(tree: Tree): Map<string, { shapes: number; flows: number }> {
  const counts = new Map<string, { shapes: number; flows: number }>()
  const order = [ROOT, ...tree.preorder]
  for (let i = order.length - 1; i >= 0; i--) { // what is inside comes after what holds it, so backwards sees the inside first
    const id = order[i]
    let shapes = 0
    let flows = tree.flowsIn.get(id)?.length ?? 0
    for (const kid of tree.kids.get(id) ?? []) {
      const inner = counts.get(kid)!
      shapes += 1 + inner.shapes
      flows += inner.flows
    }
    counts.set(id, { shapes, flows })
  }
  return counts
}

/** The shapes (the project included) that have a problem in them or inside them, and the flows whose own file has one. */
function problemsIn(model: Model, problems: readonly Problem[]): { shapes: Set<string>; flows: Set<string> } {
  const shapes = new Set<string>()
  const flows = new Set<string>()
  const mark = (from: string) => {
    for (const id of chain(model, from)) shapes.add(id)
  }
  for (const p of problems) {
    if (p.id !== undefined && getObject(model, p.id)) mark(p.id)
    const flow = /^flows\/(.+)\.yaml$/.exec(p.file)?.[1]
    if (flow !== undefined && Object.hasOwn(model.flows, flow)) {
      flows.add(flow)
      mark(model.flows[flow].view)
    }
  }
  if (problems.length > 0) shapes.add(ROOT)
  return { shapes, flows }
}

// ponytail: toLowerCase, not a locale-aware fold. The C# port lowers with the invariant culture; they agree for the letters ids hold
// and for ordinary names, and a name in a script with unusual case rules may match in one reader and not the other.
const lower = (text: string) => text.toLowerCase()

/**
 * The rows to draw, top to bottom. The project is the first row; below an expanded shape come its shapes, then its flows.
 * With a filter, only matching rows and the shapes holding them show, all open.
 */
export function outline(model: Model, options: OutlineOptions): Outline {
  const { expanded, editing = false, problems = [] } = options
  const needle = lower((options.filter ?? '').trim())
  const tree = treeOf(model, editing)
  const counts = countsOf(tree)
  const bad = problemsIn(model, problems)
  const root = counts.get(ROOT)!
  const totals = { shapes: root.shapes, flows: root.flows, problems: problems.length }

  const matches = (id: string, name: string) => needle === '' || lower(name).includes(needle) || lower(id).includes(needle)
  // With a filter: the keys of what matches and of the shapes that hold a match.
  const shown = new Set<string>()
  if (needle !== '') {
    const holdingAll = (view: string) => {
      for (const id of chain(model, view)) shown.add(`shape:${id}`)
    }
    for (const id of [ROOT, ...tree.preorder]) if (matches(id, nameOf(model, id))) holdingAll(id)
    for (const [view, ids] of tree.flowsIn) {
      for (const id of ids) {
        if (!matches(id, model.flows[id].name || id)) continue
        shown.add(`flow:${id}`)
        holdingAll(view)
      }
    }
  }
  const visible = (key: string) => needle === '' || shown.has(key)

  const rows: OutlineRow[] = []
  type Next = { kind: 'shape' | 'flow'; id: string; parent?: string; depth: number }
  const stack: Next[] = [{ kind: 'shape', id: ROOT, depth: 0 }]
  while (stack.length > 0) {
    const { kind, id, parent, depth } = stack.pop()!
    if (!visible(`${kind}:${id}`)) continue
    if (kind === 'flow') {
      const flow = model.flows[id]
      const name = flow.name || id
      rows.push({
        key: `flow:${id}`, kind, id, parent, depth, name, external: false, shapes: 0, flows: 0, steps: flow.steps.length,
        problem: bad.flows.has(id), expandable: false, expanded: false, match: matches(id, name),
      })
      continue
    }
    const object = getObject(model, id)
    const members = (tree.kids.get(id) ?? []).filter(kid => visible(`shape:${kid}`))
    const flows = (tree.flowsIn.get(id) ?? []).filter(flow => visible(`flow:${flow}`))
    const below = members.length + flows.length > 0
    const open = below && (needle !== '' || expanded.has(id))
    const size = counts.get(id)!
    rows.push({
      key: `shape:${id}`, kind, id, ...(parent === undefined ? {} : { parent }), depth, name: nameOf(model, id),
      ...(object?.type === undefined ? {} : { type: object.type }), external: object ? isExternal(object) : false,
      shapes: size.shapes, flows: size.flows, problem: bad.shapes.has(id), expandable: below, expanded: open, match: matches(id, nameOf(model, id)),
    })
    if (!open) continue
    // Pushed backwards so shapes come off first, in order, and then the flows.
    for (let i = flows.length - 1; i >= 0; i--) stack.push({ kind: 'flow', id: flows[i], parent: id, depth: depth + 1 })
    for (let i = members.length - 1; i >= 0; i--) stack.push({ kind: 'shape', id: members[i], parent: id, depth: depth + 1 })
  }
  return { rows, totals }
}

/** `expanded` with every shape that holds `id` added, so its row is on the list. `self` opens `id` too, to show what is inside it. */
export function expandTo(model: Model, id: string, expanded: ReadonlySet<string>, self = false): Set<string> {
  const next = new Set(expanded)
  for (const held of chain(model, id).slice(self ? 0 : 1)) next.add(held)
  return next
}

export type FlowRef = { id: string; name: string; steps: number; view: string }
/** The flows that play in one view, with where that view is: its path of names from the top, without the project. */
export type FlowGroup = { view: string; name: string; path: string[]; flows: FlowRef[] }
export type FlowGroups = { here: FlowRef[]; elsewhere: FlowGroup[]; total: number }

/** The flows that play in `view`, and all the others grouped by the view they play in, in tree order. */
export function flowGroups(model: Model, view: string, { editing = false }: { editing?: boolean } = {}): FlowGroups {
  const tree = treeOf(model, editing)
  const ref = (id: string): FlowRef => {
    const flow = model.flows[id]
    return { id, name: flow.name || id, steps: flow.steps.length, view: flow.view }
  }
  const here = (tree.flowsIn.get(view) ?? []).map(ref)
  const elsewhere: FlowGroup[] = []
  for (const v of [ROOT, ...tree.preorder]) {
    const ids = tree.flowsIn.get(v)
    if (v === view || !ids) continue
    elsewhere.push({ view: v, name: nameOf(model, v), path: chain(model, v).reverse().slice(1).map(id => nameOf(model, id)), flows: ids.map(ref) })
  }
  return { here, elsewhere, total: here.length + elsewhere.reduce((n, g) => n + g.flows.length, 0) }
}

export type OutlineKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'Enter'
/** Where the focus goes (a row's key), whether a shape opens or closes, and the row Enter means. */
export type KeyResult = { focus?: string; toggle?: { id: string; expand: boolean }; open?: OutlineRow }

/** What a key does in the tree, as in any tree view: arrows move, → opens or steps in, ← closes or steps out, Enter picks. */
export function outlineKey(rows: readonly OutlineRow[], focus: string | undefined, key: OutlineKey): KeyResult {
  if (rows.length === 0) return {}
  const at = rows.findIndex(r => r.key === focus)
  if (at === -1) return { focus: (key === 'End' ? rows.at(-1)! : rows[0]).key } // nothing focused yet, or the row is gone
  const row = rows[at]
  switch (key) {
    case 'ArrowDown': return { focus: rows[Math.min(at + 1, rows.length - 1)].key }
    case 'ArrowUp': return { focus: rows[Math.max(at - 1, 0)].key }
    case 'Home': return { focus: rows[0].key }
    case 'End': return { focus: rows.at(-1)!.key }
    case 'ArrowRight':
      if (row.expandable && !row.expanded) return { focus: row.key, toggle: { id: row.id, expand: true } }
      if (row.expanded && (rows[at + 1]?.depth ?? 0) > row.depth) return { focus: rows[at + 1].key }
      return { focus: row.key }
    case 'ArrowLeft': {
      if (row.expanded) return { focus: row.key, toggle: { id: row.id, expand: false } }
      const parent = rows.slice(0, at).findLast(r => r.depth < row.depth)
      return { focus: (parent ?? row).key }
    }
    case 'Enter': return { focus: row.key, open: row }
  }
}
