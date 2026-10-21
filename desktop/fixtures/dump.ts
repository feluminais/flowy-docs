import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataShown } from '../../src/core/data.ts'
import { lineStyle, ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { computeView, isView, placeStep, stepEnds } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Fixture name → absolute model folder, from fixtures.json. */
export const fixtureDirs = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(join(root, 'desktop/fixtures/fixtures.json'), 'utf8')) as Record<string, string>).map(([name, dir]) => [name, join(root, dir)]),
  )

/** What a store's data shows, left out (so every older fixture is unchanged) when it shows nothing. */
const shownOf = (o: Model['objects'][string]) => {
  const shown = dataShown(o)
  return shown.length === 0 ? undefined : shown
}

export const expectedPath = (name: string) => join(root, 'desktop/fixtures/expected', `${name}.json`)

/**
 * What the native reader (desktop/Flowy.Core) must also say about a model folder: the boxes and lines as parsed, every
 * problem, what each view shows, and where each flow step lands. The C# tests compare their own output with this.
 */
export async function dumpFolder(dir: string): Promise<unknown> {
  const state = await loadState(dir)
  if ('parseError' in state) return { parseError: state.parseError }
  const model: Model = modelOf(state)
  return {
    lineStyle: lineStyle(model),
    objects: Object.entries(model.objects).map(([id, o]) => ({ id, type: o.type, name: o.name, in: o.in, external: o.external, shape: o.shape, color: o.color, opacity: o.opacity, icon: o.icon, tech: o.tech, description: o.description, code: o.code, links: o.links, snippets: o.snippets, data: o.data, shown: shownOf(o) })),
    icons: model.meta.icons,
    connections: model.connections.map(c => ({ from: c.from, to: c.to, label: c.label })),
    layout: model.layout,
    flows: Object.entries(model.flows).map(([id, f]) => ({
      id,
      name: f.name,
      view: f.view,
      steps: f.steps.map(s => {
        const placed = placeStep(model, f.view, s)
        return { from: s.from, to: s.to, text: s.text, description: s.description, animation: s.animation, group: s.group, lane: s.lane, flow: s.flow, states: s.states, placed, ends: typeof s.from === 'string' ? stepEnds(model, s, placed) : null }
      }),
      groups: f.groups,
      states: f.states,
    })),
    problems: state.problems,
    views: Object.fromEntries([ROOT, ...Object.keys(model.objects)].filter(id => isView(model, id)).map(id => [id, computeView(model, id)])),
  }
}
