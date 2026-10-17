import { useCallback, useEffect, useRef, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import { STATE_ELEMENT } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { fetchModel, fromState, saveEdit, UNDO_STALE, undoEdit } from './save.ts'
import type { Undo } from './save.ts'

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

/**
 * The model from the local server, with its problems and where code links go, fetched again whenever the flowy/ folder changes.
 * While a file is broken or the server is gone, it keeps the last good model and says why in `banner`.
 * `edit` runs edits one at a time, in order, and fetches the model again after each. `undo` takes the
 * newest saved edit back, in the same queue. The edits to undo last as long as the page.
 * On an exported page `live` is false: the model is the page's, and there's nothing to save to.
 */
export function useModel(): { loaded?: Loaded; banner?: string; edit: Edit; undo: () => Promise<string | undefined>; live: boolean } {
  const [loaded, setLoaded] = useState<Loaded>()
  const [banner, setBanner] = useState<string>()
  const latest = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const undos = useRef<Undo[]>([])

  const load = useCallback(async () => {
    const call = ++latest.current
    try {
      const next = await fetchModel()
      if (call !== latest.current) return // a newer load is on its way
      setLoaded(next)
      setBanner(undefined)
    } catch (e) {
      if (call === latest.current) setBanner(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (exported) return
    const events = new EventSource('/api/events')
    events.onopen = load // the first connection, and each reconnection after flowy restarts
    events.onmessage = load
    events.onerror = () => setBanner('Lost the connection to flowy. Retrying…')
    return () => events.close()
  }, [load])

  const edit = useCallback<Edit>(op => {
    const run = queue.current.then(async () => {
      const message = await saveEdit(op, '', undo => undos.current.push(undo))
      await load()
      return message
    })
    queue.current = run
    return run
  }, [load])

  const undo = useCallback(() => {
    const run = queue.current.then(async () => {
      const last = undos.current.pop()
      if (!last) return 'Nothing to undo.'
      const message = await undoEdit(last)
      // Once a file moved on, older undos would go back past it. Anything else (a broken file, no server) can be tried again.
      if (message === UNDO_STALE) undos.current = []
      else if (message) undos.current.push(last)
      await load()
      return message
    })
    queue.current = run
    return run
  }, [load])

  return exported ? { ...exported, edit, undo, live: false } : { loaded, banner, edit, undo, live: true }
}
