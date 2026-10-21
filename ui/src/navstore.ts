import { MAX_OPEN, parseNav } from './navstate.ts'
import type { NavSaved } from './navstate.ts'
import { readPref, writePref } from './store.ts'

/** One entry for each address the page is served from, so each project keeps its own. */
const key = () => `flowy.nav:${location.pathname}`

/** What this project remembered. Storage may be blocked (private windows, some exported pages): then nothing is remembered. */
export function loadNav(): NavSaved {
  return parseNav(readPref(key()))
}

export function keepNav(saved: NavSaved): void {
  const { tab, navWidth, detailsWidth } = saved
  writePref(key(), JSON.stringify({ ...(tab === undefined ? {} : { tab }), expanded: saved.expanded.slice(0, MAX_OPEN), navWidth, detailsWidth }))
}
