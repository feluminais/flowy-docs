import type { StepInfo, StepView, YamlNow } from '../../src/core/history.ts'

/** The steps of the folder's history, newest first, and whether the server is managing to save them. */
export type HistoryList = { saving: boolean; reason?: string; steps: StepInfo[] }

/** What a restore came to: the versions the files have now (null: gone) and the step that holds what they were before, or why it was refused. */
export type Restored = { ok: true; versions: Record<string, string | null>; before?: string } | { ok: false; status: number; message: string }

/** The history routes of the local server, as the page uses them. */
export type HistoryClient = {
  list(): Promise<HistoryList>
  /** One step with its files and the step before it, or undefined when it is gone. */
  step(id: string): Promise<StepView | undefined>
  /** The files as they are now. */
  yaml(): Promise<YamlNow>
  /** Records the files as they are as a step with this label. False when nothing changed or it could not be said; never rejects. */
  record(label: string): Promise<boolean>
  /** Puts an earlier step's files back. `seen` is the version of each file the caller last read, null for one that was not there. */
  restore(id: string, seen: Record<string, string | null>, label: string): Promise<Restored>
  clear(): Promise<void>
}

type Body = { error?: string; recorded?: boolean; versions?: Record<string, string | null>; before?: string }

/** The history client for the local server at `base`: '' for the page's own origin, or an address, for tests. */
export function httpHistory(base = ''): HistoryClient {
  const read = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${base}${path}`)
    if (!res.ok) throw new Error(`the server answered ${res.status}`)
    return (await res.json()) as T
  }
  const post = (path: string, body: unknown) =>
    fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flowy': '1' }, body: JSON.stringify(body) })
  return {
    list: () => read<HistoryList>('/api/history'),
    async step(id) {
      const res = await fetch(`${base}/api/history/steps/${encodeURIComponent(id)}`)
      if (res.status === 404) return undefined
      if (!res.ok) throw new Error(`the server answered ${res.status}`)
      return (await res.json()) as StepView
    },
    yaml: () => read<YamlNow>('/api/yaml'),
    async record(label) {
      try {
        const res = await post('/api/history/steps', { label })
        return res.ok && ((await res.json()) as Body).recorded === true
      } catch {
        return false
      }
    },
    async restore(id, seen, label) {
      const res = await post('/api/history/restore', { id, versions: seen, label })
      const body = (await res.json().catch(() => ({}))) as Body
      if (!res.ok) return { ok: false, status: res.status, message: body.error ?? `the server answered ${res.status}` }
      return { ok: true, versions: body.versions ?? {}, ...(body.before ? { before: body.before } : {}) }
    },
    async clear() {
      const res = await post('/api/history/clear', {})
      if (!res.ok) throw new Error(`the server answered ${res.status}`)
    },
  }
}
