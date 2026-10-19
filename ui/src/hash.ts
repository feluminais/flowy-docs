import { isValidId, ROOT } from '../../src/core/model.ts'

/**
 * The address of what's on screen: `#<view>`, `#<view>/<flow>` while a flow plays, or `#<view>/perf/<run>/<level>` while the
 * Performance tab shows a run at one of its tested levels (the level's place in the run, from 0). The overview has no hash, so
 * it's the page's own address, and a flow or a run there is `#root/...`. Ids are [a-z0-9-], so nothing needs escaping.
 */
export function toHash(view: string, flow?: string, perf?: Perf): string {
  if (perf !== undefined) return `#${view}/perf/${perf.run}/${perf.level}`
  if (flow !== undefined) return `#${view}/${flow}`
  return view === ROOT ? '' : `#${view}`
}

/** The run the Performance tab shows, and which tested level of it. */
export type Perf = { run: string; level: number }

/** What an address names. One that isn't made of ids opens the overview. */
export function readHash(hash: string): { view: string; flow?: string; perf?: Perf } {
  const parts = hash.replace(/^#/, '').split('/')
  const [view, flow, run, level] = parts
  if (!(view === ROOT || isValidId(view))) return { view: ROOT }
  if (parts.length === 4 && flow === 'perf' && isValidId(run) && /^\d{1,6}$/.test(level)) return { view, perf: { run, level: Number(level) } }
  if (parts.length > 2) return { view: ROOT }
  return flow !== undefined && isValidId(flow) ? { view, flow } : { view }
}
