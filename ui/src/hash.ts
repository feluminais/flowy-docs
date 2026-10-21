import { isValidId, ROOT } from '../../src/core/model.ts'

/**
 * The address of what's on screen: `#<view>`, `#<view>/<flow>` while a flow plays, or `#<view>/perf/<run>/<level>` while the
 * Performance tab shows a run at one of its tested levels (the level's place in the run, from 0). A run with several sources has a place for each,
 * in dial order and separated by commas: `#<view>/perf/<run>/2,1.5`. The overview has no hash, so it's the page's own address, and a flow or a run
 * there is `#root/...`. Ids are [a-z0-9-], so nothing needs escaping.
 */
export function toHash(view: string, flow?: string, perf?: Perf, failures?: Failures): string {
  if (perf !== undefined) return `#${view}/perf/${perf.run}/${perf.levels === undefined ? perf.level : perf.levels.join(',')}`
  if (failures !== undefined) return `#${view}/failures/${failures.analysis}${failures.mode === undefined ? '' : `/${failures.mode}`}`
  if (flow !== undefined) return `#${view}/${flow}`
  return view === ROOT ? '' : `#${view}`
}

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

/** What an address names. One that isn't made of ids opens the overview. A flow can be called `perf` or `failures`: only the longer forms name a run or an analysis. */
export function readHash(hash: string): { view: string; flow?: string; perf?: Perf; failures?: Failures } {
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
 * How the address should change to `address`, given the one in the bar (`current`), or undefined when it should be left alone. A step the reader takes pushes an entry, so Back goes
 * back. Anything else replaces the address: the page opening (`quiet`, which also drops a part that named nothing), Back or a typed address, E, a live reload that falls back
 * to another view than the one asked for (`view` is not `viewId`), moving along a run (not a step to go back to), or picking another mode. A zoom with a mode picked is a step.
 */
export function addressChange(a: { quiet: boolean; address: string; current: string; view: string; viewId: string; perfOpen: boolean; runKey: string; failuresAt: Failures | undefined }): 'push' | 'replace' | undefined {
  if (!a.quiet && a.address === a.current) return undefined
  const was = readHash(a.current)
  const alongRun = a.perfOpen && was.perf?.run === a.runKey && was.view === a.view
  return a.quiet || a.view !== a.viewId || alongRun || alongFailures(was.failures, a.failuresAt) ? 'replace' : 'push'
}
