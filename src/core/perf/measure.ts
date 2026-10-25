import { dialsOf } from './dials.ts'
import { isTime } from './types.ts'
import type { Metrics, Pair, Run, Setting } from './types.ts'
import { meanBytes, newMean, settingFor, takeBytes } from './util.ts'

/**
 * What the Performance tab's dots show: the calls a second (Calls), the data a second, the calls times the size of a call (Data), or the calls a second with each dot as big as the size of its
 * call (Mixed). A line the run gives nothing for under the measure is drawn with plain stripes along it (see bareLines).
 */
export type Measure = 'calls' | 'data' | 'mixed'

/** Why Data and Mixed are blocked for a run that gives no size of a call: the tooltip of the greyed-out choices. */
export const NO_DATA = 'No call sizes in this run'

/** The nearest of 1, 2 and 5 times a power of ten (on a log scale), so a scale in words reads "2 KB/s" and not "1.6 KB/s". */
function roundNice(x: number): number {
  const power = 10 ** Math.floor(Math.log10(x))
  const m = x / power
  let best = 1
  for (const s of [2, 5, 10]) if (Math.abs(Math.log(m / s)) < Math.abs(Math.log(m / best))) best = s
  return best * power
}

/** The runs whose levels a run plays: itself, or the runs it adds. */
const partsOf = (runs: Record<string, Run>, id: string): Run[] => {
  if (!Object.hasOwn(runs, id)) return []
  const run = runs[id]
  return run.adds === undefined ? [run] : run.adds.filter(a => Object.hasOwn(runs, a)).map(a => runs[a])
}

/** What a connection gives of the size of a call: its own, else each source's own. */
const sizesOf = (c: Pair): Metrics[] => (c.bytes !== undefined ? [c] : Object.values(c.by ?? {}))

/**
 * The size of a call the Data measure counts against: the mean size of a call over the whole run (weighted by rate), rounded to 1, 2 or 5 times a power of ten. A call that
 * size gets the dots and the thickness it gets under Calls, so a bigger one gets more and a smaller one less. Undefined when the run gives no size at all: then there is no Data.
 */
export function callSize(runs: Record<string, Run>, id: string): number | undefined {
  const mean = newMean()
  for (const run of partsOf(runs, id)) for (const l of run.levels) for (const c of l.connections) for (const s of sizesOf(c)) takeBytes(mean, s)
  const size = meanBytes(mean)
  return size !== undefined && size > 0 ? roundNice(size) : undefined
}

/**
 * How loaded the run is at a setting, 0 (nothing asked of it) to 1 (the top of what was tested): the load over the highest tested load, and for a run with several sources the mean of its
 * dials. Plain stripes follow it, so they speed up as the load climbs even on a line the run gives no numbers. Undefined for a run over time, which has no load, and for a setting that is
 * not a number.
 */
export function loadPace(runs: Record<string, Run>, id: string, setting: Setting): number | undefined {
  const found = dialsOf(runs, id)
  if (!found || (found.mode === 'single' && isTime(runs[id]))) return undefined
  const shares = found.dials.flatMap(d => {
    const top = d.values[d.values.length - 1]
    const x = settingFor(setting, d.id)
    return top > 0 && Number.isFinite(x) ? [Math.min(1, Math.max(0, x / top))] : []
  })
  return shares.length === 0 ? undefined : shares.reduce((a, b) => a + b, 0) / shares.length
}

/**
 * What a line's dots count, as a rate: its calls a second under Calls and Mixed, and under Data its data a second in units of `size` (so a call of that size is one). Undefined where the line gives nothing to count: no rate, or no size of a call.
 */
export function amountOf(m: Metrics, measure: Measure, size: number | undefined): number | undefined {
  if (m.rate === undefined) return undefined
  if (measure !== 'data') return m.rate
  return m.bytes === undefined || size === undefined ? undefined : (m.rate * m.bytes) / size
}
