import { useCallback, useEffect, useRef, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import { fetchModel, saveEdit } from './save.ts'

/** Saves one edit and resolves to what to tell the user, or undefined once it's saved. */
export type Edit = (op: (model: Model) => Model) => Promise<string | undefined>

/**
 * The model from the local server, fetched again whenever the flowy/ folder changes.
 * While a file is broken or the server is gone, it keeps the last good model and says why in `banner`.
 * `edit` runs edits one at a time, in order, and fetches the model again after each.
 */
export function useModel(): { model?: Model; banner?: string; edit: Edit } {
  const [model, setModel] = useState<Model>()
  const [banner, setBanner] = useState<string>()
  const latest = useRef(0)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const load = useCallback(async () => {
    const call = ++latest.current
    try {
      const { model } = await fetchModel()
      if (call !== latest.current) return // a newer load is on its way
      setModel(model)
      setBanner(undefined)
    } catch (e) {
      if (call === latest.current) setBanner(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    const events = new EventSource('/api/events')
    events.onopen = load // the first connection, and each reconnection after flowy restarts
    events.onmessage = load
    events.onerror = () => setBanner('Lost the connection to flowy. Retrying…')
    return () => events.close()
  }, [load])

  const edit = useCallback<Edit>(op => {
    const run = queue.current.then(async () => {
      const message = await saveEdit(op)
      await load()
      return message
    })
    queue.current = run
    return run
  }, [load])

  return { model, banner, edit }
}
