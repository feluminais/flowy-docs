import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAIR_MODES, PAIR_NAMES, PAIRS_FIELD } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { modelFiles } from '../../src/core/modelfiles.ts'
import { modelOf } from '../../src/core/state.ts'
import { pairLabels, strandCandidates, viaBroken, viaKey, viaProblem } from '../../src/core/strands.ts'
import { computeView, placeStep } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

// The lines between two shapes where a project draws a line for each connection: the words of the setting, how a via is compared, the strands a step can ride, what is
// wrong with a via and which vias a change of the connections leaves pointing at nothing. The strands themselves, the line each step rides and the problems are in the
// folder dump of the same case (pairs.json is the dump of desktop/fixtures/cases/pairs; this is what that dump does not say). The C# tests (StrandsTests) compare their own.

/** What `viaKey` is asked about: labels as written, with space at the ends and in other cases, and what a file could hold instead. */
const WORDS: unknown[] = ['Start scan', ' start SCAN ', '\tStart scan\n', '', '   ', 'ÉCRAN', 'Σ', 'ΟΔΟΣ', 'οδος', 'İ', 'İSTANBUL', 3, null, undefined, ['Start scan']]

/** The ends a step is placed on, in the case's root view: every pair, both ways, a pair with one line, a pair with none and the same shape twice. */
const PLACED: [string, string][] = [
  ['ui', 'management'], ['management', 'ui'], ['cloud', 'management'], ['management', 'cloud'], ['bus', 'management'], ['management', 'bus'],
  ['linux', 'management'], ['management', 'linux'], ['ui', 'linux'], ['ui', 'ui'],
]

/** A change of the connections: the model after it, from the case's own files. */
type Change = { name: string; make: (model: Model) => Model }
const without = (model: Model, label: string): Model => ({ ...model, connections: model.connections.filter(c => c.label !== label) })
const CHANGES: Change[] = [
  { name: 'nothing changes', make: model => model },
  { name: 'the connection a via names is gone', make: model => without(model, 'Start scan') },
  { name: 'a connection no via names is gone', make: model => without(model, 'Request and reply') },
  { name: 'a connection is renamed', make: model => ({ ...model, connections: model.connections.map(c => (c.label === 'Start scan' ? { ...c, label: 'Begin scan' } : c)) }) },
  { name: 'it is renamed to the same words in other capitals', make: model => ({ ...model, connections: model.connections.map(c => (c.label === 'Start scan' ? { ...c, label: 'START SCAN' } : c)) }) },
  { name: 'it goes but the other way keeps the label', make: model => ({ ...without(model, 'Start scan'), connections: [...without(model, 'Start scan').connections, { from: 'management', to: 'ui', label: 'start scan' }] }) },
  { name: 'it loses its label', make: model => ({ ...model, connections: model.connections.map(c => (c.label === 'Start scan' ? { from: c.from, to: c.to } : c)) }) },
]

export async function dumpPairs(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/pairs/flowy'))
  if ('parseError' in state) throw new Error("the pairs case can't be read")
  const model = modelOf(state)
  const view = computeView(model, 'root')
  const labels = pairLabels(model, 'root')
  const steps = Object.entries(model.flows).flatMap(([flow, f]) => f.steps.map((step, i) => ({ flow, step: i, problem: viaProblem(labels, step, placeStep(model, f.view, step)) ?? null })))
  return {
    modes: [...PAIR_MODES],
    field: PAIRS_FIELD,
    names: PAIR_NAMES,
    viaKeys: WORDS.map(value => ({ value: value === undefined ? null : value, key: viaKey(value) })),
    candidates: PLACED.map(placed => ({ placed, strands: strandCandidates(view, placed).map(s => s.id) })),
    // No strands in a view of a project that draws one line for each pair: there is nothing to ride.
    merged: {
      files: modelFiles({ ...model, meta: {} }),
      candidates: PLACED.slice(0, 2).map(placed => ({ placed, strands: strandCandidates(computeView({ ...model, meta: {} }, 'root'), placed).map(s => s.id) })),
    },
    labels: [...labels].map(([pair, set]) => ({ pair, labels: [...set].sort() })),
    problems: steps,
    changes: CHANGES.map(({ name, make }) => {
      const after = make(model)
      return { name, files: modelFiles(after), broken: viaBroken(model, after) }
    }),
    before: modelFiles(model),
  }
}
