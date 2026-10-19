import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lineStyle, ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { computeView, isView, placeStep, stepEnds } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Fixture name → absolute model folder, from fixtures.json. */
export const fixtureDirs = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(join(root, 'desktop/fixtures/fixtures.json'), 'utf8')) as Record<string, string>).map(([name, dir]) => [name, join(root, dir)]),
  )

export const expectedPath = (name: string) => join(root, 'desktop/fixtures/expected', `${name}.json`)

/**
 * What the native reader (desktop/Flowy.Core) must also say about a model folder: the boxes and lines as parsed, every
 * problem, what each view shows, and where each flow step lands. The C# tests compare their own output with this.
 */
export async function dumpFolder(dir: string): Promise<unknown> {
  const state = await loadState(dir)
  if ('parseError' in state) return { parseError: state.parseError }
  const model: Model = { ...state.model, flows: state.flows, layout: state.layout }
  return {
    lineStyle: lineStyle(model),
    objects: Object.entries(model.objects).map(([id, o]) => ({ id, type: o.type, name: o.name, in: o.in, external: o.external, shape: o.shape, color: o.color, opacity: o.opacity, icon: o.icon, tech: o.tech, description: o.description, code: o.code, links: o.links })),
    icons: model.meta.icons,
    connections: model.connections.map(c => ({ from: c.from, to: c.to, label: c.label })),
    layout: model.layout,
    flows: Object.entries(model.flows).map(([id, f]) => ({
      id,
      name: f.name,
      view: f.view,
      steps: f.steps.map(s => {
        const placed = placeStep(model, f.view, s)
        return { from: s.from, to: s.to, text: s.text, description: s.description, animation: s.animation, placed, ends: typeof s.from === 'string' ? stepEnds(model, s, placed) : null }
      }),
    })),
    problems: state.problems,
    views: Object.fromEntries([ROOT, ...Object.keys(model.objects)].filter(id => isView(model, id)).map(id => [id, computeView(model, id)])),
  }
}
