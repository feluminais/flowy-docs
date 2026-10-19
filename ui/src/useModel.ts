import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Model } from '../../src/core/model.ts'
import { isChanged } from '../../src/core/host.ts'
import { STATE_ELEMENT } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { vscode } from './host.ts'
import { fetchModel, fromState, REDO_STALE, saveEdit, UNDO_STALE, undoEdit } from './save.ts'
import type { Undo } from './save.ts'
import { hostTransport, httpTransport } from './transport.ts'
import type { Transport } from './transport.ts'

/** Saves one edit and resolves to what to tell the user, or undefined once it's saved. */
export type Edit = (op: (model: Model) => Model) => Promise<string | undefined>

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
 */
export function useModel(): { loaded?: Loaded; banner?: string; edit: Edit; undo: () => Promise<string | undefined>; redo: () => Promise<string | undefined>; live: boolean } {
  const [loaded, setLoaded] = useState<Loaded>()
  const [banner, setBanner] = useState<string>()
  const latest = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const undos = useRef<Undo[]>([])
  const redos = useRef<Undo[]>([])

  const load = useCallback(async () => {
    const call = ++latest.current
    try {
      const next = await fetchModel(transport)
      if (call !== latest.current) return // a newer load is on its way
      setLoaded(next)
      setBanner(undefined)
    } catch (e) {
      if (call === latest.current) setBanner(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (exported) return
    return watch(load, () => setBanner('Lost the connection to flowy. Retrying…'))
  }, [load])

  const edit = useCallback<Edit>(op => {
    const run = queue.current.then(async () => {
      const message = await saveEdit(op, transport, undo => {
        undos.current.push(undo)
        redos.current = []
      })
      await load()
      return message
    })
    queue.current = run
    return run
  }, [load])

  // Undo and redo are the same move between two stacks: put the newest entry of one back, and keep its reverse on the other.
  const step = useCallback((from: RefObject<Undo[]>, to: RefObject<Undo[]>, word: 'undo' | 'redo') => {
    const run = queue.current.then(async () => {
      const last = from.current.pop()
      if (!last) return `Nothing to ${word}.`
      const message = await undoEdit(last, transport, back => to.current.push(back), word)
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

  return exported ? { ...exported, edit, undo, redo, live: false } : { loaded, banner, edit, undo, redo, live: true }
}
