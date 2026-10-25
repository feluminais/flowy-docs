import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { comparedWith, expandTo, flowList, outline, outlineKey, rowCount, rowCountWords } from '../../src/core/outline.ts'
import type { OutlineKey, OutlineRow } from '../../src/core/outline.ts'
import { isView } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { fixtureDirs } from './dump.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** A tree to press keys in: the project open, one shape closed, one open with a shape and a flow in it, and a shape with nothing in it. */
const row = (key: string, depth: number, extra: Partial<OutlineRow> = {}): OutlineRow => ({
  key, kind: key.startsWith('flow') ? 'flow' : 'shape', id: key.split(':')[1], depth, name: key, external: false, inside: 0, shapes: 0, flows: 0,
  problem: false, expandable: false, expanded: false, match: true, ...extra,
})
const KEY_ROWS = [
  row('shape:root', 0, { expandable: true, expanded: true }), row('shape:a', 1, { expandable: true }), row('shape:b', 1, { expandable: true, expanded: true }),
  row('shape:c', 2), row('flow:f', 2), row('shape:d', 1),
]
const KEYS: OutlineKey[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter']

/** Folders the outline is dumped for besides the fixtures: the flowdiff case, whose many flows tag none of each other, so the lists must keep their order exactly. */
const EXTRA = { flowdiff: join(root, 'desktop/fixtures/cases/flowdiff/flowy') }

/** The ways the Flows list is asked for, by name: a filter, tags, edit mode, and which folders are closed (resolved against the folders the list has). */
type ListAsk = { name: string; editing?: boolean; query?: string; tags?: string[]; closed?: 'first' | 'all' }
const LIST_ASKS: ListAsk[] = [
  { name: 'plain' },
  { name: 'editing', editing: true },
  { name: 'query-a', query: 'a' },
  { name: 'query-pay', query: 'PAY' },
  { name: 'query-blank', query: '   ' },
  { name: 'query-nothing', query: 'zzzz no flow has this' },
  { name: 'tag', tags: ['HAPPY PATH'] },
  { name: 'tags-and-query', tags: ['happy path', 'error path'], query: 'er' },
  { name: 'tag-nobody-has', tags: ['no such tag'] },
  { name: 'first-folder-closed', closed: 'first' },
  { name: 'all-folders-closed', closed: 'all' },
  { name: 'closed-and-filtered', closed: 'all', query: 'a' },
]

/** What flowList says for each ask on a model. The folders to close are those of the plain list: the first one, or every one. */
function dumpLists(model: Model): unknown {
  const folderPaths = flowList(model, {}).rows.flatMap(r => (r.kind === 'folder' ? [r.path] : []))
  return LIST_ASKS.map(ask => {
    const closed = ask.closed === 'first' ? folderPaths.slice(0, 1) : ask.closed === 'all' ? folderPaths : []
    const result = flowList(model, { editing: ask.editing ?? false, query: ask.query ?? '', tags: ask.tags ?? [], closed: new Set(closed) })
    return { ...ask, closed, result }
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
        return { ...s, rows, totals, counts: rows.map(r => ({ key: r.key, short: rowCount(r), words: rowCountWords(r) })) }
      }),
      lists: dumpLists(model),
      expandTo: [...everything, 'nope'].flatMap(id => [false, true].map(self => ({ id, self, opened: [...expandTo(model, id, new Set(), self)].sort() }))),
    }
  }
  return {
    folders,
    compared: [[], ['A'], ['The refund is not recorded'], ['A', 'B']].map(partners => ({ partners, words: comparedWith(partners) })),
    keys: {
      rows: KEY_ROWS,
      results: [undefined, ...KEY_ROWS.map(r => r.key), 'shape:gone'].flatMap(focus => KEYS.map(key => ({ focus, key, result: outlineKey(KEY_ROWS, focus, key) }))),
      none: KEYS.map(key => ({ key, result: outlineKey([], undefined, key) })),
    },
  }
}
