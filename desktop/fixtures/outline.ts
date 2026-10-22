import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { expandTo, flowGroups, outline, outlineKey } from '../../src/core/outline.ts'
import type { OutlineKey, OutlineRow } from '../../src/core/outline.ts'
import { isView } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { fixtureDirs } from './dump.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** A tree to press keys in: the project open, one shape closed, one open with a shape and a flow in it, and a shape with nothing in it. */
const row = (key: string, depth: number, extra: Partial<OutlineRow> = {}): OutlineRow => ({
  key, kind: key.startsWith('flow') ? 'flow' : 'shape', id: key.split(':')[1], depth, name: key, external: false, shapes: 0, flows: 0,
  problem: false, expandable: false, expanded: false, match: true, ...extra,
})
const KEY_ROWS = [
  row('shape:root', 0, { expandable: true, expanded: true }), row('shape:a', 1, { expandable: true }), row('shape:b', 1, { expandable: true, expanded: true }),
  row('shape:c', 2), row('flow:f', 2), row('shape:d', 1),
]
const KEYS: OutlineKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']

/** Folders the outline is dumped for besides the fixtures: the flowdiff case, whose many flows tag none of each other, so the lists must keep their order exactly. */
const EXTRA = { flowdiff: join(root, 'desktop/fixtures/cases/flowdiff/flowy') }

/** A flow made up for a partner case: its id, name, view and raw `compare`. */
type PartnerFlow = { id: string; name: string; view: string; compare?: unknown }
const STEPS = [{ from: 'web', to: 'api', text: 'x' }]
const paired = (): PartnerFlow[] => [
  { id: 'e', name: 'E alone', view: 'shop' },
  { id: 'c', name: 'C newest', view: 'shop', compare: 'b' },
  { id: 'a', name: 'A oldest', view: 'shop' },
  { id: 'd', name: 'D other', view: 'shop' },
  { id: 'b', name: 'B middle', view: 'shop', compare: { with: 'a', note: 'n' } },
]
const edit = (flows: PartnerFlow[], id: string, change: Partial<PartnerFlow>): PartnerFlow[] => flows.map(f => (f.id === id ? { ...f, ...change } : f))
const unlink = (flows: PartnerFlow[], id: string): PartnerFlow[] => flows.map(f => (f.id === id ? { id: f.id, name: f.name, view: f.view } : f))

/** Flows made up to prove the rule that lists partners together, on the compare case's shapes; the C# tests build the same models from this table. */
const PARTNER_CASES: { name: string; flows: PartnerFlow[] }[] = [
  { name: 'a chain and a lone flow', flows: paired() },
  { name: 'a chain moves to where its first member sorts', flows: edit(edit(paired(), 'a', { name: 'Z oldest' }), 'd', { name: 'A first' }) },
  { name: 'a flow tagged by many lists them in key order', flows: edit(paired(), 'c', { compare: 'a' }) },
  { name: 'a mutual pair', flows: edit(paired(), 'a', { compare: 'b' }) },
  { name: 'a loop of tags', flows: edit(edit(edit(paired(), 'a', { compare: 'b' }), 'b', { compare: 'c' }), 'c', { compare: 'a' }) },
  { name: 'no links', flows: unlink(unlink(paired(), 'b'), 'c') },
  { name: 'partners on different views', flows: edit(paired(), 'c', { view: ROOT }) },
  { name: 'a tag to itself or to a flow that is not there', flows: edit(edit(paired(), 'd', { compare: 'd' }), 'e', { compare: 'gone' }) },
  {
    name: 'a flow with no name sorts by its id, and is tagged by two',
    flows: [{ id: 'zz', name: '', view: 'shop' }, { id: 'b2', name: 'B', view: 'shop', compare: 'zz' }, { id: 'a1', name: 'A', view: 'shop' }, { id: 'c3', name: 'C', view: 'shop', compare: 'zz' }],
  },
  {
    name: 'ids that read as numbers tag the same flow, in the order JavaScript keys them',
    flows: [{ id: '10', name: 'Ten', view: 'shop', compare: 'x' }, { id: 'x', name: 'X', view: 'shop' }, { id: '2', name: 'Two', view: 'shop', compare: 'x' }],
  },
]

/** The lists of the partner cases, in the view they play in and in another one: which flows come in which order, and which are linked. */
async function dumpPartners(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/compare/flowy'))
  if ('parseError' in state) throw new Error("the compare case can't be read")
  const base = modelOf(state)
  return PARTNER_CASES.map(({ name, flows }) => {
    const model: Model = { ...base, flows: Object.fromEntries(flows.map(f => [f.id, { name: f.name, view: f.view, steps: STEPS, ...(f.compare === undefined ? {} : { compare: f.compare }) }])) }
    const dump = (view: string) => {
      const { here, elsewhere } = flowGroups(model, view)
      return { view, here: here.map(f => ({ id: f.id, linked: f.linked })), elsewhere: elsewhere.map(g => ({ view: g.view, flows: g.flows.map(f => ({ id: f.id, linked: f.linked })) })) }
    }
    return { name, flows, groups: ['shop', ROOT].map(dump) }
  })
}

/**
 * What the TypeScript says about the navigator for every fixture folder: the rows in several states (closed, one branch open, all open,
 * a filter, edit mode), the flows of every view, what expandTo opens for each shape, and what each key does in a fixed tree.
 * The C# tests (OutlineTests) must reproduce all of it.
 */
export async function dumpOutline(): Promise<unknown> {
  const folders: Record<string, unknown> = {}
  for (const [name, dir] of Object.entries({ ...fixtureDirs(), ...EXTRA })) {
    const state = await loadState(dir)
    if ('parseError' in state) {
      folders[name] = { parseError: true }
      continue
    }
    const model: Model = modelOf(state)
    const ids = Object.keys(model.objects)
    const views = [ROOT, ...ids.filter(id => isView(model, id))]
    const everything = [ROOT, ...ids]
    const states = [
      { name: 'collapsed', expanded: [], filter: '', editing: false },
      { name: 'top', expanded: [ROOT], filter: '', editing: false },
      { name: 'branch', expanded: [ROOT, ...views.slice(1, 2)], filter: '', editing: false },
      { name: 'all', expanded: everything, filter: '', editing: false },
      { name: 'all-editing', expanded: everything, filter: '', editing: true },
      { name: 'filter-a', expanded: [], filter: 'a', editing: false },
      { name: 'filter-web', expanded: [ROOT], filter: 'WEB', editing: false },
      { name: 'filter-blank', expanded: [ROOT], filter: '  ', editing: false },
    ]
    folders[name] = {
      outlines: states.map(s => {
        const { rows, totals } = outline(model, { expanded: new Set(s.expanded), filter: s.filter, editing: s.editing, problems: state.problems })
        return { ...s, rows, totals }
      }),
      groups: views.flatMap(view => [false, true].map(editing => {
        const { here, elsewhere, total } = flowGroups(model, view, { editing })
        return { view, editing, here, elsewhere, total }
      })),
      expandTo: [...everything, 'nope'].flatMap(id => [false, true].map(self => ({ id, self, opened: [...expandTo(model, id, new Set(), self)].sort() }))),
    }
  }
  return {
    folders,
    partners: await dumpPartners(),
    keys: {
      rows: KEY_ROWS,
      results: [undefined, ...KEY_ROWS.map(r => r.key), 'shape:gone'].flatMap(focus => KEYS.map(key => ({ focus, key, result: outlineKey(KEY_ROWS, focus, key) }))),
      none: KEYS.map(key => ({ key, result: outlineKey([], undefined, key) })),
    },
  }
}
