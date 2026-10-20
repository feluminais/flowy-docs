import { ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { expandTo, flowGroups, outline, outlineKey } from '../../src/core/outline.ts'
import type { OutlineKey, OutlineRow } from '../../src/core/outline.ts'
import { isView } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { fixtureDirs } from './dump.ts'

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

/**
 * What the TypeScript says about the navigator for every fixture folder: the rows in several states (closed, one branch open, all open,
 * a filter, edit mode), the flows of every view, what expandTo opens for each shape, and what each key does in a fixed tree.
 * The C# tests (OutlineTests) must reproduce all of it.
 */
export async function dumpOutline(): Promise<unknown> {
  const folders: Record<string, unknown> = {}
  for (const [name, dir] of Object.entries(fixtureDirs())) {
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
      outlines: states.map(s => ({ ...s, ...outline(model, { expanded: new Set(s.expanded), filter: s.filter, editing: s.editing, problems: state.problems }) })),
      groups: views.flatMap(view => [false, true].map(editing => ({ view, editing, ...flowGroups(model, view, { editing }) }))),
      expandTo: [...everything, 'nope'].flatMap(id => [false, true].map(self => ({ id, self, opened: [...expandTo(model, id, new Set(), self)].sort() }))),
    }
  }
  return {
    folders,
    keys: {
      rows: KEY_ROWS,
      results: [undefined, ...KEY_ROWS.map(r => r.key), 'shape:gone'].flatMap(focus => KEYS.map(key => ({ focus, key, result: outlineKey(KEY_ROWS, focus, key) }))),
      none: KEYS.map(key => ({ key, result: outlineKey([], undefined, key) })),
    },
  }
}
