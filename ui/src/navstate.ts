/** Which tab of the right-hand panel is showing: what a click picked (Details), the flows list, the Explorer tree, or the Performance of a load-test run. */
export type NavTab = 'details' | 'flows' | 'explorer' | 'performance'

/** What the navigator remembers for this project: the list or tree that was open, and which shapes were open in the tree. */
export type NavSaved = { tab?: 'flows' | 'explorer'; expanded: string[] }

export const MAX_OPEN = 2000 // a hand-edited or runaway entry never grows the stored text without bound

/** What stored text says, trusting none of it. */
export function parseNav(text: string | null): NavSaved {
  try {
    const raw: unknown = JSON.parse(text ?? 'null')
    if (typeof raw !== 'object' || raw === null) return { expanded: [] }
    const { tab, expanded } = raw as { tab?: unknown; expanded?: unknown }
    return {
      ...(tab === 'flows' || tab === 'explorer' ? { tab } : {}),
      expanded: Array.isArray(expanded) ? expanded.filter((id): id is string => typeof id === 'string').slice(0, MAX_OPEN) : [],
    }
  } catch {
    return { expanded: [] }
  }
}
