import type { Model } from '../src/core/model.ts'
import { callSize } from '../src/core/perf/measure.ts'
import { traffic as trafficOf, trafficAt as trafficAtOf } from '../src/core/perf/traffic.ts'
import type { Run, Setting, Traffic } from '../src/core/perf/types.ts'

/**
 * The blobs of a run, for the tests of how many there are, how big and how fast: they count the data, so a run that gives no size of a call has none. These make every call weigh the same
 * (1000 bytes), so what the blobs count is the calls a second, as the dots did when they counted calls. Lines that are drawn with plain stripes (no numbers) are left out.
 */
const UNIT = 1000

const weighed = <T extends { rate?: number; bytes?: number }>(m: T): T => (m.rate !== undefined && m.bytes === undefined ? { ...m, bytes: UNIT } : m)

/** The run with every call that has a rate weighing a unit. */
export function unit(run: Run): Run {
  return {
    ...run,
    levels: run.levels.map(l => ({
      ...l,
      connections: l.connections.map(c => ({ ...weighed(c), ...(c.by === undefined ? {} : { by: Object.fromEntries(Object.entries(c.by).map(([id, m]) => [id, weighed(m)])) }) })),
    })),
  }
}

const unitRuns = (runs: Record<string, Run>): Record<string, Run> => Object.fromEntries(Object.entries(runs).map(([id, run]) => [id, unit(run)]))

const drawn = (t: Traffic): Traffic => ({ ...t, lines: t.lines.filter(l => l.bare !== true) })

/** Blobs for a run of one source. */
export const traffic = (model: Model, run: Run, load: number, view: string): Traffic => {
  const weighed = unit(run)
  return drawn(trafficOf(model, weighed, load, view, 'data', callSize({ run: weighed }, 'run')))
}

/** Blobs for a run at a setting of its dials. */
export const trafficAt = (model: Model, runs: Record<string, Run>, id: string, setting: Setting, view: string): Traffic => drawn(trafficAtOf(model, unitRuns(runs), id, setting, view, 'data'))
