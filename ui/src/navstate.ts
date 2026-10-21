/**
 * Which tab of the left-hand panel is showing: the Explorer tree, the flows list, the files as YAML with their history, the Performance panel of a
 * load-test run, or the Failures panel of an analysis. Details, on the right, has no tabs.
 */
export type NavTab = 'flows' | 'explorer' | 'yaml' | 'performance' | 'failures'

/**
 * The tab that opens: the one asked for, unless it is not there to show (no flows to list, no server that keeps the history for the YAML tab, or a
 * Performance panel while editing). Performance and Failures are there unless `shows` says they are not.
 */
export const openTab = (tab: NavTab | undefined, shows: { flows: boolean; yaml: boolean; performance?: boolean }): NavTab | undefined =>
  (tab === 'flows' && !shows.flows) || (tab === 'yaml' && !shows.yaml) || (tab === 'performance' && shows.performance === false) ? undefined : tab

/** The tab that comes back with the page. Performance and Failures do not: the address says which run, analysis and mode were open, and brings the tab back with them. */
export const rememberedTab = (tab: NavTab | undefined): NavTab | undefined => (tab === 'failures' || tab === 'performance' ? undefined : tab)

/** What the navigator remembers for this project: the list or tree that was open (Performance and Failures are not remembered: the address says whether they are open), which shapes were open in the tree, and how wide the two side panels are. */
export type NavSaved = { tab?: NavTab; expanded: string[]; navWidth?: number; detailsWidth?: number }

export const MAX_OPEN = 2000 // a hand-edited or runaway entry never grows the stored text without bound

export const MIN_WIDTH = 220 // the narrowest a side panel gets when dragged
export const MAX_WIDTH = 640

/** A panel's width in whole pixels, kept between MIN_WIDTH and MAX_WIDTH, and below `limit`: what the canvas can spare. */
export const clampWidth = (width: number, limit = MAX_WIDTH) => Math.round(Math.max(MIN_WIDTH, Math.min(width, MAX_WIDTH, limit)))

const widthOf = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? clampWidth(value) : undefined)

/** What stored text says, trusting none of it. */
export function parseNav(text: string | null): NavSaved {
  try {
    const raw: unknown = JSON.parse(text ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { expanded: [] }
    const { tab, expanded, navWidth, detailsWidth } = raw as { tab?: unknown; expanded?: unknown; navWidth?: unknown; detailsWidth?: unknown }
    const [nav, details] = [widthOf(navWidth), widthOf(detailsWidth)]
    return {
      ...(tab === 'flows' || tab === 'explorer' || tab === 'yaml' ? { tab } : {}),
      expanded: Array.isArray(expanded) ? expanded.filter((id): id is string => typeof id === 'string').slice(0, MAX_OPEN) : [],
      ...(nav === undefined ? {} : { navWidth: nav }),
      ...(details === undefined ? {} : { detailsWidth: details }),
    }
  } catch {
    return { expanded: [] }
  }
}
