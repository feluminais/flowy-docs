import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captionOf, progressOf } from '../../src/core/captions.ts'
import { otherLaneSteps, runsOf, stopIndexOf, stopsOf } from '../../src/core/structure.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The runs and the stops of every flow in the `groups` case, as the TypeScript side makes them: the good ones, the ones with
 * every kind of shape, and the broken ones, which must still have stops. The C# tests compare their own with this.
 */
export async function dumpStops(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/groups/flowy'))
  if ('parseError' in state) throw new Error("the groups case can't be read")
  return {
    flows: Object.entries(state.flows).map(([id, flow]) => {
      const stops = stopsOf(flow)
      return { id, runs: runsOf(flow), stops, other: stops.map((_, k) => otherLaneSteps(stops, k)), stopOfStep: flow.steps.map((_, i) => stopIndexOf(stops, i)) }
    }),
  }
}

/** The words and the progress bar of every flow in the groups case, for the C# port to match. */
export async function dumpCaptions(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/groups/flowy'))
  if ('parseError' in state) throw new Error("the groups case can't be read")
  return {
    flows: Object.entries(state.flows).map(([id, flow]) => {
      const stops = stopsOf(flow)
      return { id, captions: stops.map(stop => captionOf(flow, stop)), progress: progressOf(flow, stops) }
    }),
  }
}
