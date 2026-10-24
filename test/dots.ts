import type { Model } from '../src/core/model.ts'
import { traffic as trafficOf, trafficAt as trafficAtOf } from '../src/core/perf/traffic.ts'
import type { Run, Setting, Traffic } from '../src/core/perf/types.ts'

/**
 * The lines of a run that carry numbers, for the tests of how many dots there are, how big and how fast. A line the run gives nothing for is drawn with plain stripes (`bare`), and the
 * tests that are not about those leave them out.
 */
const drawn = (t: Traffic): Traffic => ({ ...t, lines: t.lines.filter(l => l.bare !== true) })

/** Dots for a run of one source. */
export const traffic = (model: Model, run: Run, load: number, view: string): Traffic => drawn(trafficOf(model, run, load, view))

/** Dots for a run at a setting of its dials. */
export const trafficAt = (model: Model, runs: Record<string, Run>, id: string, setting: Setting, view: string): Traffic => drawn(trafficAtOf(model, runs, id, setting, view))
