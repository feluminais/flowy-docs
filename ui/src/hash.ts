import { isValidId, ROOT } from '../../src/core/model.ts'

/**
 * The address of what's on screen: `#<view>`, `#<view>/<flow>` while a flow plays, or `#<view>/perf/<run>/<level>` while the
 * Performance tab shows a run at one of its tested levels (the level's place in the run, from 0). The overview has no hash, so
 * it's the page's own address, and a flow or a run there is `#root/...`. Ids are [a-z0-9-], so nothing needs escaping.
 */
export function toHash(view: string, flow?: string, perf?: Perf, failures?: Failures): string {
  if (perf !== undefined) return `#${view}/perf/${perf.run}/${perf.level}`
  if (failures !== undefined) return `#${view}/failures/${failures.analysis}${failures.mode === undefined ? '' : `/${failures.mode}`}`
  if (flow !== undefined) return `#${view}/${flow}`
  return view === ROOT ? '' : `#${view}`
}

/** The run the Performance tab shows, and which tested level of it. */
export type Perf = { run: string; level: number }

/** The failure analysis the Failures tab shows, and the mode in it that is picked, if one is: `#<view>/failures/<analysis>/<mode>`. */
export type Failures = { analysis: string; mode?: string }

/** What an address names. One that isn't made of ids opens the overview. A flow can be called `perf` or `failures`: only the longer forms name a run or an analysis. */
export function readHash(hash: string): { view: string; flow?: string; perf?: Perf; failures?: Failures } {
  const parts = hash.replace(/^#/, '').split('/')
  const [view, flow, third, fourth] = parts
  if (!(view === ROOT || isValidId(view))) return { view: ROOT }
  if (parts.length === 4 && flow === 'perf' && isValidId(third) && /^\d{1,6}$/.test(fourth)) return { view, perf: { run: third, level: Number(fourth) } }
  if (flow === 'failures' && (parts.length === 3 || parts.length === 4) && isValidId(third) && (parts.length === 3 || isValidId(fourth)))
    return { view, failures: { analysis: third, ...(parts.length === 4 ? { mode: fourth } : {}) } }
  if (parts.length > 2) return { view: ROOT }
  return flow !== undefined && isValidId(flow) ? { view, flow } : { view }
}
