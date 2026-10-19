import { MAX_OPEN, parseNav } from './navstate.ts'
import type { NavSaved } from './navstate.ts'

/** One entry for each address the page is served from, so each project keeps its own. */
const key = () => `flowy.nav:${location.pathname}`

/** What this project remembered. Storage may be blocked (private windows, some exported pages): then nothing is remembered. */
export function loadNav(): NavSaved {
  try {
    return parseNav(localStorage.getItem(key()))
  } catch {
    return { expanded: [] }
  }
}

export function keepNav(saved: NavSaved): void {
  try {
    const { tab, navWidth, detailsWidth } = saved
    localStorage.setItem(key(), JSON.stringify({ ...(tab === undefined ? {} : { tab }), expanded: saved.expanded.slice(0, MAX_OPEN), navWidth, detailsWidth }))
  } catch {
    // nothing to do: the tree still holds in this page
  }
}
