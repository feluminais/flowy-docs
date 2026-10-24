import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createHistoryStore } from './historystore.ts'
import { clearOutcome } from './historyclient.ts'
import type { HistoryClient } from './historyclient.ts'
import { vscode } from './host.ts'
import { noHistory } from './yamlview.ts'

/**
 * The store behind the YAML tab. The tab is always there. Its files need a server that keeps the history, or an export that carries them (not the VS Code webview); without either its
 * panel says why (`why`). `open` is whether the tab is showing.
 */
export function useYamlTab({ historyApi, live, changes, open, setNotice }: { historyApi: HistoryClient | undefined; live: boolean; changes: number; open: boolean; setNotice: (notice: string) => void }) {
  const store = useMemo(() => (historyApi ? createHistoryStore(historyApi) : undefined), [historyApi])
  // A server that answers 404 keeps no history (an older flowy), and then there is nothing for the tab to show.
  const subscribe = useMemo(() => (listener: () => void) => (store ? store.subscribe(listener) : () => undefined), [store])
  const gone = useSyncExternalStore(subscribe, () => store?.get().unavailable === true)
  const why = noHistory({ live, inVscode: vscode !== undefined, hasApi: historyApi !== undefined, unavailable: gone })
  // The tab shows what the server keeps, so it is read once to know whether there is a history, and again after every load, whether it worked or not (a change may have left a file broken), while the tab is open.
  const read = useRef<typeof store>(undefined)
  useEffect(() => {
    if (store && (open || read.current !== store)) void store.refresh()
    read.current = store
  }, [store, changes, open])
  const clear = async () => {
    const reason = historyApi && await clearOutcome(historyApi)
    if (reason) setNotice(reason)
    await store?.refresh() // after a failure too, so the list shows what the server really has
  }
  return { store, why, clear }
}
