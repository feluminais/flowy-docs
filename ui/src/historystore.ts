import type { StepInfo, StepView, YamlNow } from '../../src/core/history.ts'
import type { HistoryClient } from './historyclient.ts'

/** What the YAML tab knows: the steps, the one it shows, and the files as they are. */
export type HistoryView = {
  /** The first read is done (it may have failed: see `error`). */
  ready: boolean
  /** False when the server is not managing to save the history; `reason` says why. */
  saving: boolean
  reason?: string
  /** Newest first. */
  steps: StepInfo[]
  /** The step the reader chose; left out, the tab follows the newest. */
  picked?: string
  shownId?: string
  /** The shown step with its files and the step before it. */
  shown?: StepView
  /** The files as they are now. */
  now?: YamlNow
  /** Marks are against the files as they are now, not against the step before. */
  compare: boolean
  /** Why the last read failed. What was there before is kept. */
  error?: string
}

export type HistoryStore = {
  /** The same object until something changes, which is what `useSyncExternalStore` wants. */
  get(): HistoryView
  subscribe(listener: () => void): () => void
  /** Reads the list and the files again. Of two reads that overlap, the later one is kept. */
  refresh(): Promise<void>
  /** Shows a step the reader chose, or follows the newest again. */
  pick(id: string | undefined): Promise<void>
  setCompare(on: boolean): void
}

export function createHistoryStore(client: HistoryClient): HistoryStore {
  let view: HistoryView = { ready: false, saving: true, steps: [], compare: false }
  const listeners = new Set<() => void>()
  let latest = 0

  const set = (next: HistoryView) => {
    view = next
    for (const listener of [...listeners]) listener()
  }

  async function refresh(): Promise<void> {
    const call = ++latest
    try {
      const [list, now] = await Promise.all([client.list(), client.yaml()])
      if (call !== latest) return
      let picked = view.picked !== undefined && list.steps.some(step => step.id === view.picked) ? view.picked : undefined
      let shownId = picked ?? list.steps[0]?.id
      // A step never changes once it is written, so the one already read is the one to show.
      let shown = shownId !== undefined && view.shown?.step.id === shownId ? view.shown : shownId === undefined ? undefined : await client.step(shownId)
      if (call !== latest) return
      if (shownId !== undefined && shown === undefined) {
        // Gone between the list and the read: show the newest instead.
        picked = undefined
        shownId = list.steps[0]?.id
        shown = shownId === undefined ? undefined : await client.step(shownId)
        if (call !== latest) return
      }
      set({
        ready: true, saving: list.saving, ...(list.reason === undefined ? {} : { reason: list.reason }), steps: list.steps,
        ...(picked === undefined ? {} : { picked }), ...(shownId === undefined ? {} : { shownId }), ...(shown === undefined ? {} : { shown }), now, compare: view.compare,
      })
    } catch (e) {
      if (call === latest) set({ ...view, ready: true, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return {
    get: () => view,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    refresh,
    async pick(id) {
      const { picked: _was, ...rest } = view
      // Following the newest again also stops comparing: marked against the files now, the latest change would show nothing.
      set(id === undefined ? { ...rest, compare: false } : { ...rest, picked: id })
      await refresh()
    },
    setCompare(on) {
      if (on !== view.compare) set({ ...view, compare: on })
    },
  }
}
