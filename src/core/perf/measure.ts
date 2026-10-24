import type { Metrics, Pair, Run } from './types.ts'
import { meanBytes, newMean, takeBytes } from './util.ts'

/**
 * What the Performance tab draws on its lines: stripes moving along them for the calls a second (Calls), blobs for the data a second, the calls times the size of a call (Data), or both on
 * one line (Mixed). A line the run gives nothing for under the measure is drawn with plain stripes (see bareLines).
 */
export type Measure = 'calls' | 'data' | 'mixed'

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
 * The most calls a second the run has on any line at any load, which the stripes are busy against: the busiest line at the top of the run has its stripes as close and quick as they get, so
 * the stripes of a run that goes from 100 to 1,200 orders a minute visibly speed up. A run of added runs adds their peaks (a line they share carries the sum). Undefined when the run gives no rate.
 */
export function callPeak(runs: Record<string, Run>, id: string): number | undefined {
  let sum = 0
  let any = false
  for (const run of partsOf(runs, id)) {
    let most = 0
    for (const l of run.levels) for (const c of l.connections) for (const m of [c, ...Object.values(c.by ?? {})]) if (m.rate !== undefined && m.rate > most) most = m.rate
    if (most > 0) any = true
    sum += most
  }
  return any ? sum : undefined
}

/**
 * What a line carries as a rate: its calls a second under Calls, and under Data and Mixed its data a second in units of `size` (so a call of that size is one), which is what its blobs
 * count. Undefined where the line gives nothing to count: no rate, or no size of a call.
 */
export function amountOf(m: Metrics, measure: Measure, size: number | undefined): number | undefined {
  if (m.rate === undefined) return undefined
  if (measure === 'calls') return m.rate
  return m.bytes === undefined || size === undefined ? undefined : (m.rate * m.bytes) / size
}
