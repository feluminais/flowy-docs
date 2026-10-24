import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { CompareTag } from '../../src/core/compare.ts'
import type { Model } from '../../src/core/model.ts'
import { setCompare } from '../../src/core/ops.ts'
import { isChanged } from '../../src/core/host.ts'
import { STATE_ELEMENT } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { vscode } from './host.ts'
import { staticHistory } from './historyclient.ts'
import type { HistoryClient } from './historyclient.ts'
import { fetchModel, fromState, restoreVersion, saveEdit } from './save.ts'
import { saveCompare } from './saveCompare.ts'
import { apiUrl } from './apiurl.ts'
import { modelOfPage } from './models.ts'
import { hostTransport, httpTransport } from './transport.ts'
import type { Transport } from './transport.ts'
import { entryAfterRestore, replay } from './undo.ts'
import type { Entry } from './undo.ts'

/** Saves one edit and resolves to what to tell the user, or undefined once it's saved. */
export type Edit = (op: (model: Model) => Model) => Promise<string | undefined>

/** Writes the `compare` tag of the flow or run `id` (see saveCompare). Resolves to what to tell the user, or undefined once it is saved. */
export type Tag = (kind: 'flow' | 'run', id: string, tag: CompareTag | undefined) => Promise<string | undefined>

/** Puts an earlier version of the files back (see the YAML tab). `seen` is what the files were when the caller last read them. */
export type Restore = (id: string, seen: Record<string, string | null>, label: string) => Promise<string | undefined>

/** What the canvas shows: the model, its problems, and where code links go. */
export type Loaded = Omit<ReturnType<typeof fromState>, 'versions'>

/** The model an exported page carries (flowy export), or why it can't be read. It never changes. */
const exported = (() => {
  const element = document.getElementById(STATE_ELEMENT)
  if (!element) return undefined
  try {
    const state = JSON.parse(element.textContent ?? '') as State
    return { loaded: fromState(state), ...('yaml' in state && state.yaml ? { history: staticHistory(state.yaml) } : {}) }
  } catch {
    return { banner: "This page's model can't be read. Export it again." }
  }
})()

/** How this page reaches the folder: the VS Code extension it is embedded in, or else the local server it came from. */
const host = vscode // a closure can't keep the narrowing of an import
const transport: Transport = host
  ? hostTransport(message => host.postMessage(message), handler => window.addEventListener('message', e => handler(e.data)))
  : httpTransport('', modelOfPage())

/**
 * Calls `onChange` whenever the page should read the folder again: once the connection is up, after every reconnection,
 * and whenever the folder changes. `onLost` says the connection is gone. Returns how to stop. The extension is there from
 * the start and never goes; the server pushes its changes as events.
 */
function watch(onChange: () => void, onLost: () => void): () => void {
  if (vscode) {
    const onMessage = (e: MessageEvent<unknown>) => { if (isChanged(e.data)) onChange() }
    window.addEventListener('message', onMessage)
    onChange()
    return () => window.removeEventListener('message', onMessage)
  }
  const events = new EventSource(apiUrl('', '/api/events', modelOfPage()))
  events.onopen = onChange // the first connection, and each reconnection after flowy restarts
  events.onmessage = onChange
  events.onerror = onLost
  return () => events.close()
}

/**
 * The model from the local server, with its problems and where code links go, fetched again whenever the flowy/ folder changes.
 * While a file is broken or the server is gone, it keeps the last good model and says why in `banner`.
 * `edit` runs edits one at a time, in order, and fetches the model again after each. `undo` takes the
 * newest saved edit back and `redo` puts the newest undone one back, in the same queue. They last as
 * long as the page; a new edit clears what there was to redo.
 * Inside a VS Code webview all of this goes through the extension instead of a server.
 * On an exported page `live` is false: the model is the page's, and there's nothing to save to.
 * `history` is the folder's history where a server keeps it (not in VS Code, not on an exported page), and `changes` counts the loads that
 * have finished, whether they worked or not, so the YAML tab also hears of a change that left a file broken and the model as it was.
 * `restore` puts an earlier version back, in the same queue as the edits, and undo takes it back like an edit.
 */
export function useModel(): {
  loaded?: Loaded; banner?: string; edit: Edit; undo: () => Promise<string | undefined>; redo: () => Promise<string | undefined>
  restore: Restore; tag: Tag; history?: HistoryClient; changes: number; live: boolean
} {
  const [loaded, setLoaded] = useState<Loaded>()
  const [banner, setBanner] = useState<string>()
  const [changes, setChanges] = useState(0)
  const latest = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const undos = useRef<Entry[]>([])
  const redos = useRef<Entry[]>([])

  const load = useCallback(async () => {
    const call = ++latest.current
    try {
      const next = await fetchModel(transport)
      if (call !== latest.current) return // a newer load is on its way
      setLoaded(next)
      setBanner(undefined)
    } catch (e) {
      if (call === latest.current) setBanner(e instanceof Error ? e.message : String(e))
    } finally {
      if (call === latest.current) setChanges(n => n + 1)
    }
  }, [])

  useEffect(() => {
    if (exported) return
    return watch(load, () => setBanner('Lost the connection to flowy. Retrying…'))
  }, [load])

  const edit = useCallback<Edit>(op => {
    const run = queue.current.then(async () => {
      const message = await saveEdit(op, transport, (undo, label) => {
        undos.current.push({ kind: 'edit', undo, label })
        redos.current = []
      })
      await load()
      return message
    })
    queue.current = run
    return run
  }, [load])

  // A flow's tag is an edit like the rest (it can be undone); a run's is written in place, in the same queue.
  const tag = useCallback<Tag>((kind, id, value) => {
    if (kind === 'flow') return edit(model => setCompare(model, id, value))
    const run = queue.current.then(async () => {
      const message = await saveCompare('run', id, value, transport)
      await load()
      return message
    })
    queue.current = run
    return run
  }, [edit, load])

  const restore = useCallback<Restore>((id, seen, label) => {
    const run = queue.current.then(async () => {
      const done = await restoreVersion(id, label, transport, seen)
      const entry = entryAfterRestore(done, seen, label)
      if (entry) {
        undos.current.push(entry)
        redos.current = []
      }
      await load()
      return done.message
    })
    queue.current = run
    return run
  }, [load])

  // Undo and redo are the same move between two stacks: put the newest entry of one back, and keep its reverse on the other.
  const step = useCallback((from: RefObject<Entry[]>, to: RefObject<Entry[]>, word: 'undo' | 'redo') => {
    const run = queue.current.then(async () => {
      const last = from.current.pop()
      if (!last) return `Nothing to ${word}.`
      const { message, reverse, stale } = await replay(last, word, transport)
      if (reverse) to.current.push(reverse)
      // Once a file moved on (or the step a restore goes back to is gone), older entries would go back past it. Anything else (a broken file, no server) can be tried again.
      if (stale) from.current = []
      else if (message) from.current.push(last)
      await load()
      return message
    })
    queue.current = run
    return run
  }, [load])
  const undo = useCallback(() => step(undos, redos, 'undo'), [step])
  const redo = useCallback(() => step(redos, undos, 'redo'), [step])

  return exported
    ? { ...exported, edit, undo, redo, restore, tag, changes: 0, live: false }
    : { loaded, banner, edit, undo, redo, restore, tag, history: transport.history, changes, live: true }
}
