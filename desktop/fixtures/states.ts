import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getObject } from '../../src/core/model.ts'
import type { Flow } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import { marksOf, STATE_LABELS, STATE_NAMES, stateProblems, statesAt } from '../../src/core/states.ts'
import { stopBefore, stopsOf } from '../../src/core/structure.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The case with a flow for every rule (and every hostile id), then the demo and the showcase. Only flows that use states are dumped. */
const FOLDERS = ['desktop/fixtures/cases/states/flowy', 'docs/demo/flowy', 'docs/showcase/flowy']

const usesStates = (flow: Flow) => flow.states !== undefined || flow.steps.some(s => s.states !== undefined)

/**
 * The words of the six states, and for every flow that uses states: its problems, where every shape stands at every stop, what is drawn for each
 * shape at every stop (the marks, with the roll-up of a container), which stop each stop follows, and what a `k` that is no stop gives. The C#
 * tests (StatesTests) compare their own with this.
 */
export async function dumpStates(): Promise<unknown> {
  const folders = []
  for (const folder of FOLDERS) {
    const state = await loadState(join(root, folder))
    if ('parseError' in state) throw new Error(`${folder} can't be read`)
    const model = modelOf(state)
    const flows = Object.entries(model.flows).filter(([, flow]) => usesStates(flow)).map(([id, flow]) => {
      const stops = stopsOf(flow)
      const at = stops.map((_, k) => statesAt(flow, stops, k))
      return {
        id,
        problems: stateProblems(flow, stops, shape => getObject(model, shape) !== undefined),
        at,
        marks: at.map(states => marksOf(model, states)),
        before: stops.map((_, k) => stopBefore(stops, k) ?? null),
        outside: [-1, stops.length, stops.length + 5].map(k => ({ k, states: statesAt(flow, stops, k), before: stopBefore(stops, k) ?? null })),
      }
    })
    folders.push({ folder, flows })
  }
  return { names: [...STATE_NAMES], labels: STATE_NAMES.map(n => STATE_LABELS[n]), folders }
}
