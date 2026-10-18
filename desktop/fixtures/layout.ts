import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeView } from '../../src/core/views.ts'
import { loadDir } from '../../src/node/files.ts'
import { arrange, membersOf, tangle, untangle } from '../../ui/src/graph.ts'
import type { Region } from '../../ui/src/graph.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))
const REGIONS: Region[] = ['left', 'right', 'below', 'above']

type Spot = [string, number, number]
const spots = (m: Map<string, { x: number; y: number }>): Spot[] => [...m].map(([id, p]) => [id, p.x, p.y])

/**
 * One view's members at given places and its outsiders around them, put through the same steps the canvas takes after dagre: measure the
 * members, arrange the outsiders (each in a region taken in turn from `REGIONS`), untangle. The C# port (Layout in desktop/Flowy.Core) must
 * reproduce every number. dagre itself is not part of this: the C# side has its own layered layout under these steps.
 */
function scenario(name: string, inner: Spot[], outsiders: string[], edges: { from: string; to: string }[]) {
  const at = new Map(inner.map(([id, x, y]) => [id, { x, y }]))
  const regions = Object.fromEntries(outsiders.map((id, i) => [id, REGIONS[i % REGIONS.length]]))
  const m = membersOf(at, outsiders, edges)
  const arranged = arrange(m, id => regions[id])
  const tidy = untangle(arranged.at, edges, arranged.rows, arranged.columns)
  return {
    name, inner, outsiders, edges, regions,
    members: { left: m.left, right: m.right, top: m.top, bottom: m.bottom, middle: m.middle, mean: [...m.mean].map(([id, p]) => [id, p.x, p.y]), people: m.people, rest: m.rest },
    arranged: { at: spots(arranged.at), rows: arranged.rows, columns: arranged.columns },
    tangleArranged: tangle(arranged.at, edges),
    tidy: spots(tidy),
    tangleTidy: tangle(tidy, edges),
  }
}

/** The members of a view on a plain grid, as the first stand-in for dagre's rows. */
const grid = (ids: string[]): Spot[] => {
  const columns = Math.ceil(Math.sqrt(ids.length))
  return ids.map((id, i): Spot => [id, (i % columns) * 300, Math.floor(i / columns) * 150])
}

export async function dumpLayout(): Promise<unknown> {
  const scenarios = [
    scenario('crossing', [['a', 0, 0], ['b', 300, 0], ['c', 150, 160]], ['p', 'x', 'y', 'z'],
      [{ from: 'p', to: 'a' }, { from: 'x', to: 'b' }, { from: 'c', to: 'y' }, { from: 'z', to: 'c' }, { from: 'a', to: 'b' }, { from: 'b', to: 'c' }]),
    scenario('people', [['m1', 0, 0], ['m2', 300, 0]], ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'],
      ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'].map((from, i) => ({ from, to: i % 2 ? 'm1' : 'm2' }))),
    scenario('lonely', [['only', 0, 0]], [], []),
    scenario('disconnected-outsider', [['a', 0, 0], ['b', 300, 0]], ['stray'], [{ from: 'a', to: 'b' }]),
  ]
  for (const [folder, views] of [['docs/demo/flowy', ['root', 'ordering', 'delivery', 'back-office']], ['example', ['root', 'shop', 'api']]] as const) {
    const { model } = await loadDir(join(root, folder))
    for (const view of views) {
      const v = computeView(model, view)
      if (v.members.length === 0) continue
      scenarios.push(scenario(`${folder} ${view}`, grid(v.members), v.outsiders, v.edges.map(e => ({ from: e.from, to: e.to }))))
    }
  }
  // untangle with no groups given: any two boxes in a row may trade.
  const ungrouped = new Map([['a', { x: 0, y: 0 }], ['b', { x: 300, y: 0 }], ['c', { x: 600, y: 0 }]])
  const lines = [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }]
  return { scenarios, ungrouped: { edges: lines, before: spots(ungrouped), tangleBefore: tangle(ungrouped, lines), after: spots(untangle(ungrouped, lines)) } }
}
