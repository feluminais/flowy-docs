// node bench/views.ts : the parent-to-children questions (memberIds, hasChildren, isView), failure coverage and a view's lines, as a model grows.
import { gen, time, table } from './gen.ts'
import { load } from './gen.ts'

const views = await load<typeof import('../src/core/views.ts')>('src/core/views.ts')
const failures = await load<typeof import('../src/core/failures.ts')>('src/core/failures.ts')

const sizes = [{ systems: 10, apps: 10, components: 4 }, { systems: 20, apps: 10, components: 4 }, { systems: 40, apps: 10, components: 4 }, { systems: 80, apps: 10, components: 4 }]
const xs: number[] = []
const rows: Record<string, number[]> = {}
const rec = (k: string, v: number) => (rows[k] ??= []).push(v)
for (const s of sizes) {
  const m = gen({ ...s, linesPerShape: 2, modes: 200 })
  const ids = Object.keys(m.objects)
  xs.push(ids.length)
  // Each call gets a fresh `objects` map, so a cache by identity is measured from cold, as after an edit.
  const fresh = () => ({ ...m, objects: { ...m.objects } })
  rec('memberIds for every shape (cold)', time(() => { const f = fresh(); for (const id of ids) views.memberIds(f, id) }, 300, 20))
  rec('isView for every shape (cold)', time(() => { const f = fresh(); for (const id of ids) views.isView(f, id) }, 300, 20))
  rec('isView for every shape (warm)', time(() => { for (const id of ids) views.isView(m, id) }, 300, 20))
  rec('computeView(root)', time(() => views.computeView(fresh(), 'root'), 300, 20))
  rec('computeView(first system)', time(() => views.computeView(fresh(), 'sys-0'), 300, 20))
  const analysis = m.failures.fa
  rec('coverage(model, analysis)', time(() => failures.coverage(fresh(), analysis), 300, 10))
}
table('children and views; shapes =', xs, rows)
