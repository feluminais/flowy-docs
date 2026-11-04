import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { strandOf } from '../../src/core/strands.ts'
import { drawnStrandOf, drawnView } from '../../src/core/trunks.ts'
import { computeView, isView, placeStep } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'
import { linesOf, locate, moveBetween } from '../../ui/src/edit.ts'
import { focusEdges, toGraph } from '../../ui/src/graph.ts'
import type { Drawing } from '../../ui/src/graph.ts'
import { otherLaneSteps, stopsOf } from '../../src/core/structure.ts'
import type { Playing } from '../../ui/src/graph.ts'
import { findObjects } from '../../ui/src/search.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

async function load(folder: string) {
  const state = await loadState(join(root, folder))
  if ('parseError' in state) throw new Error(`${folder} can't be read`)
  const model: Model = modelOf(state)
  return { model, problems: state.problems }
}

type Focus = { box?: string; line?: string; hover?: string; focused?: string }
const tokens = (className?: string) => (className ?? '').split(' ').filter(Boolean).sort()

/** What the canvas decides about a view: which boxes are outsiders, lit, dim or flagged, which lines are quiet, labelled, selected. Places are left out: dagre has no C# twin. */
async function scene(folder: string, view: string, playing?: Playing, focus: Focus = {}, drawing: Drawing = {}) {
  const { model, problems } = await load(folder)
  const graph = toGraph(model, view, playing, problems, {}, drawing)
  const edges = focusEdges(graph.edges, focus)
  return {
    folder, view, playing: playing ?? null, focus, ...(Object.keys(drawing).length === 0 ? {} : { drawing }),
    boxes: graph.nodes.map(n => ({ id: n.id, classes: tokens(n.className), inside: n.data.inside })),
    edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label ?? null, classes: tokens(e.className), selected: e.selected ?? false, ...(e.data?.both === true ? { both: true } : {}), ...(e.data?.look ? { look: e.data.look } : {}),
      // Where a project draws a line for each connection: the pair the line belongs to, its place among the pair's lines, and whether the pair is spread.
      ...(e.data?.pair === undefined ? {} : { pair: e.data.pair, lanes: e.data.lanes, slot: e.data.slot, ...(e.data.spread === true ? { spread: true } : {}), ...(e.data.trunk === undefined ? {} : { trunk: e.data.trunk }) }) })),
    members: graph.members,
  }
}

export async function dumpScenes(): Promise<unknown> {
  const scenes: Awaited<ReturnType<typeof scene>>[] = []
  for (const folder of ['docs/demo/flowy', 'example', 'desktop/fixtures/cases/problems/flowy', 'desktop/fixtures/cases/kinds/flowy']) {
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
  // The groups case: every stop of three of its flows, the steps lit together and the other lanes of a branch faint.
  {
    const folder = 'desktop/fixtures/cases/groups/flowy'
    const { model: grouped } = await load(folder)
    for (const id of ['ok', 'shapes', 'bad']) {
      const flow = grouped.flows[id]
      const ends = flow.steps.map(s => placeStep(grouped, flow.view, s))
      const stops = stopsOf(flow)
      for (let k = 0; k < stops.length; k++) scenes.push(await scene(folder, flow.view, { ends, steps: stops[k].steps, faint: otherLaneSteps(stops, k) }))
    }
  }
  // The draft-lanes case: a line for each connection. Each stop of its flow with the line each step rides, then what a selected, pointed-at or focused line or box does to its pair.
  {
    const folder = 'desktop/fixtures/cases/draft-lanes/flowy'
    const { model: lanes } = await load(folder)
    const flow = lanes.flows.scan
    const view = computeView(lanes, flow.view)
    const ends = flow.steps.map(step => placeStep(lanes, flow.view, step))
    const strands = ends.map((placed, i) => (placed ? strandOf(lanes, view, flow.steps[i], placed)?.id : undefined))
    for (let step = 0; step < flow.steps.length; step++) scenes.push(await scene(folder, flow.view, { ends, step, strands }))
    scenes.push(await scene(folder, flow.view, { ends, step: 1, strands }, { line: view.strands![2].id }))
    scenes.push(await scene(folder, flow.view, { ends, steps: [0, 3], strands }))
    const [first, second] = [view.strands![0], view.strands![2]]
    for (const focus of [{ line: first.id }, { line: first.pair }, { hover: second.id }, { hover: second.pair }, { focused: first.id }, { box: 'management' }, { box: 'cloud', line: second.id }, { line: 'nowhere' }])
      scenes.push(await scene(folder, flow.view, undefined, focus))
  }
  // The trunks case: pairs with more lines than fit across their shapes, drawn as trunks in each line style; a selected pair or line opens its trunks; a step that rides a line in a
  // trunk lights the trunk (the player's ids are the trunk's, see drawnStrandOf); a trunk is pointed at and selected by any of its lines.
  {
    const folder = 'desktop/fixtures/cases/trunks/flowy'
    const { model: trunked } = await load(folder)
    const flow = trunked.flows.tour
    const ends = flow.steps.map(step => placeStep(trunked, flow.view, step))
    for (const style of ['straight', 'curved', 'angled'] as const) {
      scenes.push(await scene(folder, flow.view, undefined, {}, { style }))
      const drawn = drawnView(trunked, flow.view, style)
      const strands = ends.map((placed, i) => (placed ? drawnStrandOf(trunked, drawn, flow.steps[i], placed) : undefined))
      if (style === 'straight') {
        for (let step = 0; step < flow.steps.length; step++) scenes.push(await scene(folder, flow.view, { ends, step, strands }, {}, { style }))
        scenes.push(await scene(folder, flow.view, { ends, step: 0, strands }, { line: 'hub ui' }, { style, opened: 'hub ui' })) // a step playing on the pair wins over its selection
      }
      const view = computeView(trunked, flow.view)
      const [query, event] = [view.strands!.find(s => s.label === 'Query 3')!, view.strands!.find(s => s.label === 'Event 2')!]
      for (const [focus, opened] of [[{ line: query.id }, query.id], [{ line: query.pair }, query.pair], [{ line: 'hub bus' }, 'hub bus'], [{ hover: event.id }, undefined], [{ line: event.id }, undefined], [{ box: 'hub' }, undefined]] as const)
        scenes.push(await scene(folder, flow.view, undefined, focus, { style, ...(opened === undefined ? {} : { opened }) }))
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
