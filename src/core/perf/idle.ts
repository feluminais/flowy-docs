import { isTime } from './types.ts'
import type { Level, Metrics, Pair, Run } from './types.ts'

/** The level a load run starts from when nothing is asked of it. */

/** What a part says with no load on it: nothing is used, queued, called or failing, and what a call weighs and how long it takes stay as the first level has them. */
const quiet = (m: Metrics): Metrics => {
  const out: Metrics = { ...m }
  for (const key of ['rate', 'util', 'queue', 'errors'] as const) if (out[key] !== undefined) out[key] = 0
  return out
}

const made = new WeakMap<Run, Level | undefined>()

/**
 * The level of a load run with no load: its first tested level with nothing used, queued, called or failing (rate, util, queue and errors 0), and the size of a call and how long
 * one takes as the first level has them. A load between it and the first level is worked out by interpolate as it is between two tested ones, and shown as estimated. Undefined
 * for a run over time, which has no load, and for a run whose first level is already at 0.
 */
export function idleOf(run: Run): Level | undefined {
  if (!made.has(run)) {
    const first = run.levels[0]
    made.set(run, isTime(run) || !(first.load > 0) ? undefined : {
      load: 0,
      overall: quiet(first.overall),
      objects: Object.fromEntries(Object.entries(first.objects).map(([id, m]) => [id, quiet(m)])),
      connections: first.connections.map((c): Pair => ({ ...c, ...quiet(c), ...(c.by === undefined ? {} : { by: Object.fromEntries(Object.entries(c.by).map(([id, m]) => [id, quiet(m)])) }) })),
    })
  }
  return made.get(run)
}
