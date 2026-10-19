import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runsOf, stopsOf } from '../../src/core/structure.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/**
 * The runs and the stops of every flow in the `groups` case, as the TypeScript side makes them: the good ones, the ones with
 * every kind of shape, and the broken ones, which must still have stops. The C# tests compare their own with this.
 */
export async function dumpStops(): Promise<unknown> {
  const state = await loadState(join(root, 'desktop/fixtures/cases/groups/flowy'))
  if ('parseError' in state) throw new Error("the groups case can't be read")
  return { flows: Object.entries(state.flows).map(([id, flow]) => ({ id, runs: runsOf(flow), stops: stopsOf(flow) })) }
}
