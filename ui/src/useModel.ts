import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Model } from '../../src/core/model.ts'
import { isChanged } from '../../src/core/host.ts'
import { STATE_ELEMENT } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { vscode } from './host.ts'
import type { HistoryClient } from './historyclient.ts'
import { fetchModel, fromState, REDO_STALE, restoreVersion, saveEdit, UNDO_STALE, undoEdit } from './save.ts'
import type { Undo } from './save.ts'
import { hostTransport, httpTransport } from './transport.ts'
import type { Transport } from './transport.ts'

/** Saves one edit and resolves to what to tell the user, or undefined once it's saved. */
export type Edit = (op: (model: Model) => Model) => Promise<string | undefined>

/** Puts an earlier version of the files back (see the YAML tab). `seen` is what the files were when the caller last read them. */
export type Restore = (id: string, seen: Record<string, string | null>, label: string) => Promise<string | undefined>

/** One thing to take back or put back: a saved edit, or a restore, which is put back by restoring the step that holds what it replaced. Both carry the label they are named by. */
type Entry = { kind: 'edit'; undo: Undo; label: string } | { kind: 'restore'; to: string; label: string }

/** What the canvas shows: the model, its problems, and where code links go. */
export type Loaded = Omit<ReturnType<typeof fromState>, 'versions'>

/** The model an exported page carries (flowy export), or why it can't be read. It never changes. */
const exported = (() => {
  const element = document.getElementById(STATE_ELEMENT)
  if (!element) return undefined
  try {
    return { loaded: fromState(JSON.parse(element.textContent ?? '') as State) }
  } catch {
    return { banner: "This page's model can't be read. Export it again." }
  }
})()

/** How this page reaches the folder: the VS Code extension it is embedded in, or else the local server it came from. */
const host = vscode // a closure can't keep the narrowing of an import
const transport: Transport = host
  ? hostTransport(message => host.postMessage(message), handler => window.addEventListener('message', e => handler(e.data)))
  : httpTransport()

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
  const events = new EventSource('/api/events')
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
  restore: Restore; history?: HistoryClient; changes: number; live: boolean
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

  const restore = useCallback<Restore>((id, seen, label) => {
    const run = queue.current.then(async () => {
      const done = await restoreVersion(id, label, transport, seen)
      if (done.message === undefined && done.before) {
        undos.current.push({ kind: 'restore', to: done.before, label })
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
      let message: string | undefined
      let reverse: Entry | undefined
      if (last.kind === 'edit') {
        message = await undoEdit(last.undo, transport, back => { reverse = { kind: 'edit', undo: back, label: last.label } }, word, last.label)
      } else {
        const done = await restoreVersion(last.to, `${word === 'undo' ? 'Undid' : 'Redid'}: ${last.label}`, transport)
        message = done.message
        if (message === undefined && done.before) reverse = { kind: 'restore', to: done.before, label: last.label }
      }
      if (reverse) to.current.push(reverse)
      // Once a file moved on, older entries would go back past it. Anything else (a broken file, no server) can be tried again.
      if (message === (word === 'undo' ? UNDO_STALE : REDO_STALE)) from.current = []
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
    ? { ...exported, edit, undo, redo, restore, changes: 0, live: false }
    : { loaded, banner, edit, undo, redo, restore, history: transport.history, changes, live: true }
}
