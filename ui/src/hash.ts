import { isValidId, ROOT } from '../../src/core/model.ts'

/**
 * The address of what's on screen: `#<view>`, or `#<view>/<flow>` while a flow plays. The overview has
 * no hash, so it's the page's own address, and a flow there is `#root/<flow>`. Ids are [a-z0-9-], so
 * nothing needs escaping.
 */
export function toHash(view: string, flow?: string): string {
  if (flow !== undefined) return `#${view}/${flow}`
  return view === ROOT ? '' : `#${view}`
}

/** What an address names. One that isn't made of ids opens the overview. */
export function readHash(hash: string): { view: string; flow?: string } {
  const [view, flow, ...rest] = hash.replace(/^#/, '').split('/')
  if (rest.length > 0 || !(view === ROOT || isValidId(view))) return { view: ROOT }
  return flow !== undefined && isValidId(flow) ? { view, flow } : { view }
}
