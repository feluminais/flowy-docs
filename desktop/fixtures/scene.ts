import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { isView, placeStep } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { linesOf, locate, moveBetween } from '../../ui/src/edit.ts'
import { focusEdges, toGraph } from '../../ui/src/graph.ts'
import type { Playing } from '../../ui/src/graph.ts'
import { findObjects } from '../../ui/src/search.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

async function load(folder: string) {
  const state = await loadState(join(root, folder))
  if ('parseError' in state) throw new Error(`${folder} can't be read`)
  const model: Model = { ...state.model, flows: state.flows, layout: state.layout }
  return { model, problems: state.problems }
}

type Focus = { box?: string; line?: string; hover?: string }
const tokens = (className?: string) => (className ?? '').split(' ').filter(Boolean).sort()

/** What the canvas decides about a view: which boxes are outsiders, lit, dim or flagged, which lines are quiet, labelled, selected. Places are left out: dagre has no C# twin. */
async function scene(folder: string, view: string, playing?: Playing, focus: Focus = {}) {
  const { model, problems } = await load(folder)
  const graph = toGraph(model, view, playing, problems)
  const edges = focusEdges(graph.edges, focus)
  return {
    folder, view, playing: playing ?? null, focus,
    boxes: graph.nodes.map(n => ({ id: n.id, classes: tokens(n.className), inside: n.data.inside })),
    edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label ?? null, classes: tokens(e.className), selected: e.selected ?? false })),
    members: graph.members,
  }
}

export async function dumpScenes(): Promise<unknown> {
  const scenes: Awaited<ReturnType<typeof scene>>[] = []
  for (const folder of ['docs/demo/flowy', 'example', 'desktop/fixtures/cases/problems/flowy']) {
    const { model } = await load(folder)
    const views = [ROOT, ...Object.keys(model.objects)].filter(id => isView(model, id))
    for (const view of views) scenes.push(await scene(folder, view))
    for (const [, flow] of Object.entries(model.flows)) {
      if (!isView(model, flow.view) || flow.steps.length === 0) continue
      const ends = flow.steps.map(s => placeStep(model, flow.view, s))
      for (const step of new Set([0, Math.floor(flow.steps.length / 2), flow.steps.length - 1])) scenes.push(await scene(folder, flow.view, { ends, step }))
      scenes.push(await scene(folder, flow.view, { ends })) // the flow's boxes are there, nothing lit
    }
  }
  const { model } = await load('docs/demo/flowy')
  const inside = Object.keys(model.objects).find(id => isView(model, id))!
  const first = toGraph(model, inside)
  const [a, b] = first.edges
  scenes.push(await scene('docs/demo/flowy', inside, undefined, { box: first.members[0] }))
  scenes.push(await scene('docs/demo/flowy', inside, undefined, { hover: a.id }))
  scenes.push(await scene('docs/demo/flowy', inside, undefined, { line: b.id }))
  scenes.push(await scene('docs/demo/flowy', inside, undefined, { box: first.members[1], line: a.id, hover: b.id }))
  return { scenes }
}

const ids = (model: Model) => Object.keys(model.objects)

/** What the panels, the search and the problem list work out from the model. */
export async function dumpNavigation(): Promise<unknown> {
  const plum = await load('docs/demo/flowy')
  const example = await load('example')
  const broken = await load('desktop/fixtures/cases/problems/flowy')
  const lines = (m: Model) => ids(m).map(id => {
    const { out, in: incoming } = linesOf(m, id)
    const plain = (ls: typeof out) => ls.map(l => ({ from: l.from, to: l.to, other: l.other, connections: l.connections.map(c => ({ from: c.from, to: c.to, label: c.label ?? null })) }))
    return { id, out: plain(out), in: plain(incoming) }
  })
  const some = [ROOT, ...ids(plum.model).slice(0, 12)]
  return {
    linesOf: { plum: lines(plum.model), example: lines(example.model) },
    locate: broken.problems.map(p => ({ problem: p, spot: locate(broken.model, p) })),
    moves: some.flatMap(from => some.map(to => ({ from, to, move: moveBetween(plum.model, from, to) }))),
    search: ['', ' ', 'ord', 'order api', 'API', 'stripe', 'zzz', 'a', 'db  cache', 'in'].flatMap(query => [
      { model: 'plum', query, found: findObjects(plum.model, query) },
      { model: 'example', query, found: findObjects(example.model, query) },
    ]),
  }
}
