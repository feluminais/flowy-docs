import { isValidId, ROOT } from '../../src/core/model.ts'
import type { Compare } from './compare.ts'

/**
 * The address of what's on screen: `#<view>`, `#<view>/<flow>` while a flow plays, or `#<view>/perf/<run>/<level>` while the
 * Performance tab shows a run at one of its tested levels (the level's place in the run, from 0). A run with several sources has a place for each,
 * in dial order and separated by commas: `#<view>/perf/<run>/2,1.5`. The overview has no hash, so it's the page's own address, and a flow or a run
 * there is `#root/...`. A comparison is `#<view>/compare/<a>/<b>` for two flows and `#<view>/compare-runs/<a>/<b>` for two runs, each with `/swap` on the end for the swapped
 * mode. Ids are [a-z0-9-], so nothing needs escaping. A run or an analysis on show wins over a comparison, which wins over a flow.
 */
export function toHash(view: string, flow?: string, perf?: Perf, failures?: Failures, compare?: Compare): string {
  if (perf !== undefined) return `#${view}/perf/${perf.run}/${perf.levels === undefined ? perf.level : perf.levels.join(',')}`
  if (failures !== undefined) return `#${view}/failures/${failures.analysis}${failures.mode === undefined ? '' : `/${failures.mode}`}`
  if (compare !== undefined) return `#${view}/${compare.kind === 'run' ? 'compare-runs' : 'compare'}/${compare.a}/${compare.b}${compare.mode === 'swap' ? '/swap' : ''}`
  if (flow !== undefined) return `#${view}/${flow}`
  return view === ROOT ? '' : `#${view}`
}

/** Whether a saved address is one `toHash` could have written: ids, `/`, and the digits, `.` and `,` of a run's places. A restored panel takes back nothing else. */
export const isSavedHash = (text: string): boolean => /^#[a-z0-9][a-z0-9/.,-]*$/.test(text) && !text.includes('//') && !text.includes('..')

/**
 * The run the Performance tab shows, and which tested level of it. For a run with several sources the address gives `levels`, a place for each dial (`level` is the first). An
 * address that gives a list that isn't one reads as an empty list, which the page takes for the opening place, as it does a list of the wrong length.
 */
export type Perf = { run: string; level: number; levels?: number[] }

/** The most places an address names: one for each dial of a run, and a run has at most four. */
const MOST_PLACES = 4

/** The failure analysis the Failures tab shows, and the mode in it that is picked, if one is: `#<view>/failures/<analysis>/<mode>`. */
export type Failures = { analysis: string; mode?: string }

/**
 * Whether the address moves along the Failures tab rather than to a new place: the same analysis with another mode picked (or none, or the
 * first). Such a step replaces the entry, so Back still undoes opening the tab and every zoom, which is a step even with a mode picked.
 */
export const alongFailures = (was: Failures | undefined, now: Failures | undefined): boolean =>
  was !== undefined && now !== undefined && was.analysis === now.analysis && was.mode !== now.mode

/**
 * What an address names. One that isn't made of ids opens the overview. A flow can be called `perf`, `failures`, `compare`, `compare-runs`, `run` or `swap`: only the longer forms name a
 * run, an analysis or a comparison. No address reads two ways: `compare` names flows, `compare-runs` names runs, and `compare/run/<a>/swap` is the flows `run` and `a`, swapped.
 */
export function readHash(hash: string): { view: string; flow?: string; perf?: Perf; failures?: Failures; compare?: Compare } {
  const parts = hash.replace(/^#/, '').split('/')
  const [view, flow, third, fourth] = parts
  if (!(view === ROOT || isValidId(view))) return { view: ROOT }
  if (parts.length === 4 && flow === 'perf' && isValidId(third) && /^\d{1,6}$/.test(fourth)) return { view, perf: { run: third, level: Number(fourth) } }
  if (parts.length === 4 && flow === 'perf' && isValidId(third) && fourth.includes(',')) {
    const places = fourth.split(',')
    const levels = places.length <= MOST_PLACES && places.every(place => /^\d{1,6}(?:\.\d{1,6})?$/.test(place)) ? places.map(Number) : []
    return { view, perf: { run: third, level: levels[0] ?? 0, levels } }
  }
  if (flow === 'failures' && (parts.length === 3 || parts.length === 4) && isValidId(third) && (parts.length === 3 || isValidId(fourth)))
    return { view, failures: { analysis: third, ...(parts.length === 4 ? { mode: fourth } : {}) } }
  if (flow === 'compare' || flow === 'compare-runs') {
    const swapped = parts.length === 5 && parts[4] === 'swap'
    if ((parts.length === 4 || swapped) && isValidId(third) && isValidId(fourth))
      return { view, compare: { kind: flow === 'compare' ? 'flow' : 'run', a: third, b: fourth, mode: swapped ? 'swap' : 'side' } }
  }
  if (parts.length > 2) return { view: ROOT }
  return flow !== undefined && isValidId(flow) ? { view, flow } : { view }
}

/**
 * The address of a run on show: its tested level (the first dial's place, rounded). A run with several sources keeps a place between two loads (to two decimals) while the
 * screen stands still, and rounds to a load during a ramp, which would otherwise rewrite the address every step.
 */
export function runAddress(run: string, here: number[], multi: boolean, ramping: boolean): Perf {
  const level = Math.round(here[0])
  return multi ? { run, level, levels: here.map(p => (ramping ? Math.round(p) : Math.round(p * 100) / 100)) } : { run, level }
}

/**
 * Whether the address moves along a comparison rather than to a new place: the same kind of comparison with another flow or run picked, or the other mode. Such a step replaces the
 * entry, so Back still undoes opening or closing the comparison, and a zoom, which is a step even with a comparison open (the caller checks the view).
 */
export const alongCompare = (was: Compare | undefined, now: Compare | undefined): boolean =>
  was !== undefined && now !== undefined && was.kind === now.kind && (was.a !== now.a || was.b !== now.b || was.mode !== now.mode)

/**
 * How the address should change to `address`, given the one in the bar (`current`), or undefined when it should be left alone. A step the reader takes pushes an entry, so Back goes
 * back. Anything else replaces the address: the page opening (`quiet`, which also drops a part that named nothing), Back or a typed address, E, a live reload that falls back
 * to another view than the one asked for (`view` is not `viewId`), moving along a run (not a step to go back to), or picking another mode or another flow or run in a comparison. A zoom with a mode picked is a step.
 */
export function addressChange(a: { quiet: boolean; address: string; current: string; view: string; viewId: string; perfOpen: boolean; runKey: string; failuresAt: Failures | undefined; compareAt?: Compare }): 'push' | 'replace' | undefined {
  if (!a.quiet && a.address === a.current) return undefined
  const was = readHash(a.current)
  const alongRun = a.perfOpen && was.perf?.run === a.runKey && was.view === a.view
  const alongPair = was.view === a.view && alongCompare(was.compare, a.compareAt)
  return a.quiet || a.view !== a.viewId || alongRun || alongFailures(was.failures, a.failuresAt) || alongPair ? 'replace' : 'push'
}
