// node bench/layout.ts : toGraph, the canvas graph of a view, when its boxes have a saved place and when they have none.
import { gen, once, time, table, load } from './gen.ts'

const graph = await load<typeof import('../ui/src/graph.ts')>('ui/src/graph.ts')

const sizes = [{ systems: 6, apps: 4, components: 3 }, { systems: 12, apps: 4, components: 3 }, { systems: 24, apps: 4, components: 3 }, { systems: 48, apps: 4, components: 3 }]
const xs: number[] = []
const rows: Record<string, number[]> = {}
const rec = (k: string, v: number) => (rows[k] ??= []).push(v)
for (const s of sizes) {
  // One flat view: every shape sits in one system, so the view shows them all with lines between them.
  const m = gen({ ...s, linesPerShape: 1.5 })
  const other = gen({ ...s, linesPerShape: 1.5 }, 2) // other lines, so the unsaved run does not find the saved run's layout in the cache
  const ids = Object.keys(m.objects).filter(id => id.includes('-app-'))
  xs.push(ids.length)
  for (const x of [m, other]) for (const id of Object.keys(x.objects)) if (x.objects[id].type === 'app') x.objects[id].in = 'sys-0'
  const view = 'sys-0'
  const saved = { ...m, layout: { [view]: Object.fromEntries(Object.keys(m.objects).map((id, i) => [id, [(i % 20) * 220, Math.floor(i / 20) * 100] as [number, number]])) } }
  const fresh = (model: typeof m) => ({ ...model, objects: { ...model.objects }, connections: [...model.connections, { from: 'sys-1', to: ids[0], label: `bump ${Math.random()}` }] })
  rec('first open, every box saved', once(() => graph.toGraph(fresh(saved), view)))
  rec('first open, nothing saved', once(() => graph.toGraph(fresh(other), view)))
  rec('again (layout cached)', time(() => graph.toGraph(saved, view), 200, 50))
}
table('toGraph in one view; boxes =', xs, rows)
