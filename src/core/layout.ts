import { Graph, layout } from '@dagrejs/dagre'
import type { Model } from './model.ts'
import { computeView, meeting, nameOf } from './views.ts'
import type { Edge, View } from './views.ts'

/** A place on the canvas: the top-left corner of a box. */
export type Point = { x: number; y: number }

/** Every box has the same size, so dagre can place them before the browser draws them. Keep in sync with .box in style.css. */
export const BOX = { width: 200, height: 72 }

const NEAR = 80 // between the members and the outsiders around them
const STACK = 30 // between boxes stacked in a column or row
const PER_ROW = 4 // outsiders that only start lines wait above the members, this many to a row

const overlaps = (a: Point, b: Point) => Math.abs(a.x - b.x) < BOX.width && Math.abs(a.y - b.y) < BOX.height

type Spots = Map<string, Point>
type Ends = { from: string; to: string }

/** A line from (ax, ay) to (bx, by), between the centres of two boxes. Plain numbers: tangle runs often. */
type Segment = { ax: number; ay: number; bx: number; by: number }

/** Which side of the line through p and q the point (rx, ry) is on: 1, -1, or 0 when it's on the line. */
const turn = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px))

/** Whether segment s and the segment (cx, cy)–(dx, dy) cross at a point inside both. Touching or lying in line doesn't count. */
function crosses(s: Segment, cx: number, cy: number, dx: number, dy: number): boolean {
  return turn(s.ax, s.ay, s.bx, s.by, cx, cy) * turn(s.ax, s.ay, s.bx, s.by, dx, dy) < 0
    && turn(cx, cy, dx, dy, s.ax, s.ay) * turn(cx, cy, dx, dy, s.bx, s.by) < 0
}

/**
 * Whether segment s runs through the box at p. Its ends sit outside the box, so it does exactly when
 * it crosses one of the box's diagonals. The box is shrunk by 4px so a line grazing a corner doesn't count.
 */
function runsThrough(s: Segment, p: Point): boolean {
  const [l, t, r, b] = [p.x + 4, p.y + 4, p.x + BOX.width - 4, p.y + BOX.height - 4]
  return crosses(s, l, t, r, b) || crosses(s, r, t, l, b)
}

/**
 * How tangled a layout looks: each pair of lines that cross (lines from the same box never do), plus
 * each time a line runs through a box that isn't one of its ends. Lines are taken centre to centre.
 * With `moved`, it counts only what involves those boxes, which is all a move of them can change:
 * the move's effect is `tangle(after, edges, moved) - tangle(before, edges, moved)`.
 */
export function tangle(at: Spots, edges: Ends[], moved?: ReadonlySet<string>): number {
  const half = { x: BOX.width / 2, y: BOX.height / 2 }
  const lines = edges.filter(e => e.from !== e.to && at.has(e.from) && at.has(e.to)).map(e => {
    const [a, b] = [at.get(e.from)!, at.get(e.to)!]
    return { from: e.from, to: e.to, ax: a.x + half.x, ay: a.y + half.y, bx: b.x + half.x, by: b.y + half.y, moves: !moved || moved.has(e.from) || moved.has(e.to) }
  })
  const boxes = [...at]
  const movedBoxes = moved ? boxes.filter(([id]) => moved.has(id)) : boxes
  let score = 0
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // Each crossing pair is counted once, from the first of its lines that moves.
    if (l.moves) for (let j = 0; j < lines.length; j++) {
      const m = lines[j]
      if (j === i || (m.moves && j < i)) continue
      const shared = m.from === l.from || m.from === l.to || m.to === l.from || m.to === l.to
      if (!shared && crosses(l, m.ax, m.ay, m.bx, m.by)) score++
    }
    for (const [id, p] of l.moves ? boxes : movedBoxes) if (id !== l.from && id !== l.to && runsThrough(l, p)) score++
  }
  return score
}

/**
 * Pairs of boxes next to each other. Within each group of `rows`, boxes in the same row (same y), in
 * order along it; within each group of `columns`, boxes in the same column (same x). Boxes never pair
 * across groups, so an outsider never trades places with a member, and a view's own boxes never trade
 * places up and down: those are dagre's ranks, and a swap would point lines upwards.
 */
function neighbours(at: Spots, rows: string[][], columns: string[][]): [string, string][] {
  const pairs: [string, string][] = []
  const pair = (ids: string[], across: 'x' | 'y', along: 'x' | 'y') => {
    const lines = new Map<number, string[]>()
    for (const id of ids) {
      const k = Math.round(at.get(id)![across])
      lines.set(k, [...(lines.get(k) ?? []), id])
    }
    for (const line of lines.values()) {
      line.sort((a, b) => at.get(a)![along] - at.get(b)![along])
      for (let i = 1; i < line.length; i++) pairs.push([line[i - 1], line[i]])
    }
  }
  for (const ids of rows) pair(ids, 'y', 'x')
  for (const ids of columns) pair(ids, 'x', 'y')
  return pairs
}

/**
 * Swaps neighbouring boxes (see neighbours) while a swap makes the layout less tangled, until a whole
 * pass swaps nothing, or after `passes` passes. Boxes only trade spots, so the layout's shape stays the
 * same. Without groups, any two boxes in a row may trade.
 */
export function untangle(at: Spots, edges: Ends[], rows: string[][] = [[...at.keys()]], columns: string[][] = [], passes = 30): Spots {
  const next = new Map(at)
  let score = tangle(next, edges)
  for (let pass = 0; pass < passes && score > 0; pass++) {
    let swapped = false
    for (const [a, b] of neighbours(next, rows, columns)) {
      const pair = new Set([a, b])
      const before = tangle(next, edges, pair)
      const pa = next.get(a)!
      const pb = next.get(b)!
      next.set(a, pb).set(b, pa)
      const change = tangle(next, edges, pair) - before
      if (change < 0) {
        score += change
        swapped = true
      } else next.set(a, pa).set(b, pb)
    }
    if (!swapped) break
  }
  return next
}

/** dagre's top-left corner for each box, given the lines between them. */
function dagreAt(boxes: string[], edges: Edge[], gap: { nodesep: number; ranksep: number }): Map<string, Point> {
  const g = new Graph()
  g.setGraph({ rankdir: 'TB', ...gap })
  g.setDefaultEdgeLabel(() => ({}))
  for (const id of boxes) g.setNode(id, { ...BOX })
  for (const e of edges) if (boxes.includes(e.from) && boxes.includes(e.to)) g.setEdge(e.from, e.to)
  layout(g)
  return new Map(boxes.map(id => {
    const { x, y } = g.node(id)
    return [id, { x: x - BOX.width / 2, y: y - BOX.height / 2 }]
  }))
}

/** Where an outsider waits: in the column left or right of the members, or in the rows below or above. */
export type Region = 'left' | 'right' | 'below' | 'above'
const REGIONS: Region[] = ['left', 'right', 'below', 'above']

/** Outsiders that only start lines (people, mostly). They always wait above. */
const startsOnly = (id: string, edges: Ends[]) => edges.some(e => e.from === id) && !edges.some(e => e.to === id)

/**
 * A view's members where dagre put them (`at`), how far they reach, and for each outsider the average
 * place of the members it connects to (the middle when it connects to none). None of this changes
 * while the outsiders move around, so it's worked out once. `people` only start lines and wait above, unless
 * `fixed` says where they wait: those outsiders stay on the side given (see neighbourSides) and never move.
 */
export function membersOf(inner: Spots, outsiders: string[], edges: Ends[], fixed: ReadonlyMap<string, Region> = new Map()) {
  const spots = [...inner.values()]
  const left = Math.min(...spots.map(p => p.x))
  const right = Math.max(...spots.map(p => p.x)) + BOX.width
  const top = Math.min(...spots.map(p => p.y))
  const bottom = Math.max(...spots.map(p => p.y)) + BOX.height
  const middle = { x: (left + right) / 2, y: (top + bottom) / 2 }
  const mean = new Map(outsiders.map((id): [string, Point] => {
    const ps = edges.flatMap(e => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).flatMap(end => inner.get(end) ?? [])
    const avg = (axis: 'x' | 'y') => ps.reduce((sum, p) => sum + p[axis], 0) / ps.length
    return [id, ps.length === 0 ? middle : { x: avg('x'), y: avg('y') }]
  }))
  const people = outsiders.filter(id => startsOnly(id, edges) && !fixed.has(id))
  return { at: inner, left, right, top, bottom, middle, mean, people, rest: outsiders.filter(id => !people.includes(id)), fixed }
}
type Members = ReturnType<typeof membersOf>

/**
 * Inside a box: the members sit together in the middle. The outsiders stay at the edges: people above,
 * in rows, and the rest where `region` says, in a column on either side or in rows below or above.
 * Each group is sorted by where the members it connects to are, which keeps lines from crossing on the
 * way in. Also returns which boxes may trade places (see untangle): members and the rows above and
 * below along their rows, the side columns up and down.
 */
export function arrange(m: Members, region: (id: string) => Region): { at: Spots; rows: string[][]; columns: string[][] } {
  const at = new Map(m.at)
  const byMean = (ids: string[], axis: 'x' | 'y') => ids.sort((a, b) => m.mean.get(a)![axis] - m.mean.get(b)![axis])
  // Rows of at most PER_ROW, centred under or over the members. `y` gives each row's top.
  const putRows = (ids: string[], y: (row: number) => number) => {
    for (let row = 0; row * PER_ROW < ids.length; row++) {
      const r = ids.slice(row * PER_ROW, (row + 1) * PER_ROW)
      const width = r.length * BOX.width + (r.length - 1) * STACK
      r.forEach((id, j) => at.set(id, { x: m.middle.x - width / 2 + j * (BOX.width + STACK), y: y(row) }))
    }
  }

  const columns = [byMean(m.rest.filter(id => region(id) === 'left'), 'y'), byMean(m.rest.filter(id => region(id) === 'right'), 'y')]
  const height = (n: number) => n * BOX.height + Math.max(0, n - 1) * STACK
  const tallest = Math.max(0, ...columns.map(c => height(c.length)))
  columns.forEach((ids, i) => {
    const x = i === 0 ? m.left - NEAR - BOX.width : m.right + NEAR
    ids.forEach((id, j) => at.set(id, { x, y: m.middle.y - height(ids.length) / 2 + j * (BOX.height + STACK) }))
  })
  // Rows above and below are wider than the members, so they clear the side columns too.
  const below = byMean(m.rest.filter(id => region(id) === 'below'), 'x')
  const belowTop = Math.max(m.bottom, m.middle.y + tallest / 2) + NEAR
  putRows(below, row => belowTop + row * (BOX.height + STACK))
  const above = byMean([...m.people, ...m.rest.filter(id => region(id) === 'above')], 'x')
  const aboveBottom = Math.min(m.top, m.middle.y - tallest / 2) - NEAR - BOX.height
  putRows(above, row => aboveBottom - row * (BOX.height + STACK))
  return { at, rows: [[...m.at.keys()], above, below], columns }
}

/**
 * Moves outsiders between the side columns and the rows below and above, one at a time, keeping a move
 * when it makes the layout less tangled, until a whole pass moves nothing (or `passes` passes).
 */
function settle(m: Members, edges: Ends[], start: Map<string, Region>, passes: number): Map<string, Region> {
  const region = new Map(start)
  const arranged = () => arrange(m, id => region.get(id)!).at
  let at = arranged()
  let score = tangle(at, edges)
  for (let pass = 0; pass < passes && score > 0; pass++) {
    let changed = false
    for (const id of region.keys()) for (const r of m.fixed.has(id) ? [] : REGIONS) {
      const was = region.get(id)!
      if (r === was) continue
      region.set(id, r)
      const next = arranged()
      // A move re-sorts the groups it leaves and joins, so more than one box can shift.
      const moved = new Set([...next.keys()].filter(k => next.get(k)!.x !== at.get(k)!.x || next.get(k)!.y !== at.get(k)!.y))
      const change = tangle(next, edges, moved) - tangle(at, edges, moved)
      if (change < 0) {
        score += change
        at = next
        changed = true
      } else region.set(id, was)
    }
    if (!changed) break
  }
  return region
}

/** The same ids in an order that only depends on `seed`, so a layout never changes between runs. */
function shuffled(ids: string[], seed: number): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647
    const j = seed % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Where every box of a view goes when nothing is saved. Finding the least tangled layout is NP-hard, so,
 * like dagre itself, this settles for a good one. dagre starts from several orders of the boxes (as
 * given, reversed, most lines first, then a few fixed shuffles), and the outsiders from two places
 * (split between the side columns, or all in rows below). From each start, outsiders move between sides
 * while that helps (settle), then boxes trade places (untangle). The least tangled wins, the first on a
 * tie, so a clean view keeps its side columns.
 */
function place(members: string[], around: string[], edges: Edge[], fixed: ReadonlyMap<string, Region>): Spots {
  const lines = edges.map(e => ({ from: e.from, to: e.to }))
  const degree = (id: string) => lines.filter(e => e.from === id || e.to === id).length
  // Known limit: a big view tries one starting order with fewer passes, so it still opens without a pause;
  // a time budget would let it try more where the machine is fast
  const big = (members.length + around.length) * lines.length > 2000
  const passes = big ? 5 : 30
  const orders = [(ids: string[]) => ids, (ids: string[]) => [...ids].reverse(), (ids: string[]) => [...ids].sort((a, b) => degree(b) - degree(a))]
    .concat([1, 2, 3, 4, 5, 6].map(seed => (ids: string[]) => shuffled(ids, seed)))
    .slice(0, big ? 1 : undefined)
  let best: Spots | undefined
  let bestScore = Infinity
  const consider = (at: Spots, rows: string[][], columns: string[][]) => {
    const tidy = untangle(at, lines, rows, columns, passes)
    const score = tangle(tidy, lines)
    if (score < bestScore) [best, bestScore] = [tidy, score]
  }
  for (const order of orders) {
    if (members.length === 0 || around.length === 0) {
      const all = order([...members, ...around])
      consider(dagreAt(all, edges, { nodesep: 60, ranksep: 90 }), [all], [])
      continue
    }
    const m = membersOf(dagreAt(order(members), edges, { nodesep: 40, ranksep: 70 }), order(around), lines, fixed)
    // Split by where their members are: the left half of them in the left column, the rest on the right. Fixed outsiders keep their side.
    const rest = [...m.rest].filter(id => !fixed.has(id)).sort((a, b) => m.mean.get(a)!.x - m.mean.get(b)!.x)
    const given = [...m.rest].filter(id => fixed.has(id)).map((id): [string, Region] => [id, fixed.get(id)!])
    const split = new Map([...given, ...rest.map((id, i): [string, Region] => [id, i < Math.floor(rest.length / 2) ? 'left' : 'right'])])
    const below = new Map([...given, ...rest.map((id): [string, Region] => [id, 'below'])])
    for (const start of [split, below]) {
      const region = settle(m, lines, start, passes)
      const { at, rows, columns } = arrange(m, id => region.get(id)!)
      consider(at, rows, columns)
    }
  }
  return best!
}

// toGraph runs again on every flow step and selection change, so placements are kept by what they're made from.
const placements = new Map<string, Spots>()
export function placeCached(members: string[], around: string[], edges: Edge[], fixed: ReadonlyMap<string, Region> = new Map()): Spots {
  const key = JSON.stringify([members, around, edges.map(e => [e.from, e.to]), [...fixed]])
  let at = placements.get(key)
  if (!at) {
    at = place(members, around, edges, fixed)
    if (placements.size >= 50) placements.delete(placements.keys().next().value!)
    placements.set(key, at)
  }
  return at
}

/**
 * Where each box of a view is drawn: where layout.yaml has it, else where `place` puts it, moved down past any saved box it would cover.
 * `boxes` are the view's members and outsiders, and any box only a flow brings in.
 */
export function spotsOf(model: Model, view: string, computed: View, boxes: string[]): Spots {
  const { members, edges } = computed
  const placed = placeCached(members, boxes.filter(id => !members.includes(id)), edges)
  const saved = Object.hasOwn(model.layout, view) ? model.layout[view] : {}
  const at: Spots = new Map()
  for (const id of boxes) if (Object.hasOwn(saved, id)) at.set(id, { x: saved[id][0], y: saved[id][1] })
  for (const id of boxes) {
    if (at.has(id)) continue
    const p = { ...placed.get(id)! }
    // Known limit: steps down one row at a time and checks every box; fine for a diagram's worth of boxes
    while ([...at.values()].some(q => overlaps(p, q))) p.y += BOX.height + 30
    at.set(id, p)
  }
  return at
}

/** Where the members and outsiders of a view are drawn now. */
export function viewSpots(model: Model, view: string): Spots {
  const v = computeView(model, view)
  return spotsOf(model, view, v, [...v.members, ...v.outsiders])
}

/** Which side of the box at `from` the box at `to` sits on: the side a line between their centres leaves `from` through. */
export function sideOf(from: Point, to: Point): Region {
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  if (Math.abs(dx) * BOX.height > Math.abs(dy) * BOX.width) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'below' : 'above'
}

/**
 * Where each outsider of a view waits to match the view above: the side it sits on, seen from the box standing for this view, in the view
 * they share. If Back office is right of Ordering at the top level, Ordering's view puts Back office on the right and Back office's view
 * puts Ordering on the left, so zooming from one to the other never leads the same way twice. An outsider with no such view (the box
 * you are inside) is left out.
 */
export function neighbourSides(model: Model, view: string, outsiders: string[]): Map<string, Region> {
  const sides = new Map<string, Region>()
  const shared = new Map<string, Spots>()
  for (const id of outsiders) {
    const m = meeting(model, view, id)
    if (!m || m.there !== id) continue
    if (!shared.has(m.view)) shared.set(m.view, viewSpots(model, m.view))
    const spots = shared.get(m.view)!
    const [here, there] = [spots.get(m.here), spots.get(m.there)]
    if (here && there) sides.set(id, sideOf(here, there))
  }
  return sides
}

/** Where an outsider is drawn around the members: above or below their rows, else in the column left or right of them. */
function drawnSide(members: Point[], at: Point): Region {
  const top = Math.min(...members.map(p => p.y))
  const bottom = Math.max(...members.map(p => p.y)) + BOX.height
  if (at.y + BOX.height <= top) return 'above'
  if (at.y >= bottom) return 'below'
  const middle = (Math.min(...members.map(p => p.x)) + Math.max(...members.map(p => p.x)) + BOX.width) / 2
  return at.x + BOX.width / 2 < middle ? 'left' : 'right'
}

/** An outsider drawn on another side than the view above puts it on. */
export type SideProblem = { view: string; box: string; drawn: Region; wanted: Region }

/** The outsiders of a view that are drawn on another side than neighbourSides gives. A view nobody dragged is drawn the way place puts it. */
export function sideProblems(model: Model, view: string): SideProblem[] {
  const v = computeView(model, view)
  if (v.members.length === 0) return []
  const at = spotsOf(model, view, v, [...v.members, ...v.outsiders])
  const members = v.members.map(id => at.get(id)!)
  return [...neighbourSides(model, view, v.outsiders)].flatMap(([box, wanted]) => {
    const drawn = drawnSide(members, at.get(box)!)
    return drawn === wanted ? [] : [{ view, box, drawn, wanted }]
  })
}

/** Where Tidy puts every box of a view: each outsider on the side neighbourSides gives, wherever boxes were dragged before. */
export function tidySpots(model: Model, view: string): Spots {
  const v = computeView(model, view)
  return placeCached(v.members, v.outsiders, v.edges, neighbourSides(model, view, v.outsiders))
}

/** What tidy_layout and `flowy tidy` say about the views they found with a neighbour on the wrong side, one line each. `fixed`: they are put right now, else they are only listed. */
export function sideReport(model: Model, found: SideProblem[], fixed: boolean): string {
  if (found.length === 0) return 'Every neighbour is on the side it has in the view above.'
  const views = new Set(found.map(p => p.view)).size
  const lines = found.map(p => `- ${nameOf(model, p.view)}: ${nameOf(model, p.box)} was ${p.drawn}${fixed ? `, now ${p.wanted}` : `, the view above has it ${p.wanted}`}`)
  return `${fixed ? 'Tidied' : 'Found'} ${views} ${views === 1 ? 'view' : 'views'}:\n${lines.join('\n')}`
}
