import { splitSketchModelId } from '../../src/core/sketches.ts'
import { addressOf } from './models.ts'
import type { ModelInfo } from './models.ts'

/**
 * The models and sketches open in this browser tab, and where each was left. Each opens as a page of its own (`?model=`), so the list lives in sessionStorage. The desktop twin of the order and the
 * names is DocTab.cs and DocTabsBar.cs.
 *
 * `id` is what `?model=` says ('' for the server's first model), `of` the name of the model a sketch belongs to, `where` the folder of a model, `hash` the address's hash when it was left.
 */
export type DocTab = { id: string; name: string; of?: string; where?: string; hash: string }

const KEY = 'flowy.tabs'

const isTab = (t: unknown): t is DocTab => {
  const tab = t as Partial<DocTab> | null
  return typeof tab === 'object' && tab !== null && typeof tab.id === 'string' && typeof tab.name === 'string' && typeof tab.hash === 'string'
}

/** The tabs this browser tab remembers: none when nothing can be read. */
export function readTabs(store: Pick<Storage, 'getItem'> = sessionStorage): DocTab[] {
  try {
    const saved = JSON.parse(store.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(saved) ? saved.filter(isTab) : []
  } catch {
    return []
  }
}

/** Remembers the tabs. Storage that refuses costs only the list: the page itself works without it. */
export function saveTabs(tabs: DocTab[], store: Pick<Storage, 'setItem'> = sessionStorage): void {
  try {
    store.setItem(KEY, JSON.stringify(tabs))
  } catch {
    // private window, or the storage is full
  }
}

/** The model's id for a model and for its sketches: tabs of one group sit side by side, inside one outline. */
export const groupOf = (id: string): string => splitSketchModelId(id)?.model ?? id

export const isSketchTab = (tab: Pick<DocTab, 'id'>): boolean => splitSketchModelId(tab.id) !== undefined

/** `tabs` with `tab` in them: renamed where it is, else a sketch after the last tab of its group, a model in front of its open sketches, anything else at the end. */
export function withTab(tabs: DocTab[], tab: DocTab): DocTab[] {
  if (tabs.some(t => t.id === tab.id)) return tabs.map(t => (t.id === tab.id ? { ...tab, hash: t.hash } : t))
  const group = groupOf(tab.id)
  const first = tabs.findIndex(t => groupOf(t.id) === group)
  if (first < 0) return [...tabs, tab]
  const at = isSketchTab(tab) ? tabs.findLastIndex(t => groupOf(t.id) === group) + 1 : first
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)]
}

/** Which tab takes over when `id` closes: the one before it in its group, else the next, else the one before. */
export function heirOf(tabs: DocTab[], id: string): DocTab | undefined {
  const at = tabs.findIndex(t => t.id === id)
  if (at < 0) return undefined
  const before = tabs[at - 1]
  return before !== undefined && groupOf(before.id) === groupOf(id) ? before : (tabs[at + 1] ?? before)
}

/** What the server knows of the model on the page `page` (the first one when it says none). */
export const modelInfo = (page: string | undefined, models: ModelInfo[] | undefined): ModelInfo | undefined => (page === undefined ? models?.[0] : models?.find(m => m.id === page))

/** The name for a tab with no `name:`: a sketch's id, or what the server calls the model (its repo), as the desktop app does. */
export function fallbackName(page: string | undefined, models: ModelInfo[] | undefined): string {
  const sketch = page === undefined ? undefined : splitSketchModelId(page)
  return sketch?.id ?? modelInfo(page, models)?.name ?? 'Model'
}

/** The tabs in runs of one group each, in order. */
export function groupsOf(tabs: DocTab[]): DocTab[][] {
  const groups: DocTab[][] = []
  for (const tab of tabs) {
    const last = groups.at(-1)
    if (last !== undefined && groupOf(last[0]!.id) === groupOf(tab.id)) last.push(tab)
    else groups.push([tab])
  }
  return groups
}

/** A sketch with its model's tab beside it is named alone: the outline says the rest. Otherwise it says whose it is. */
export const tabName = (tab: DocTab, tabs: DocTab[]): string =>
  tab.of !== undefined && !tabs.some(t => t.id === groupOf(tab.id)) ? `${tab.name} (sketch of ${tab.of})` : tab.name

/** The address of a tab, at the place it was left. */
export const tabAddress = (tab: DocTab, current: { pathname: string } = location): string => `${tab.id === '' ? current.pathname : addressOf(tab.id, current)}${tab.hash}`
