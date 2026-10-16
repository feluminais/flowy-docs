import { useEffect, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import type { State } from '../../src/core/state.ts'

/**
 * The model from the local server, fetched again whenever the flowy/ folder changes.
 * While a file is broken or the server is gone, it keeps the last good model and says why in `banner`.
 */
export function useModel(): { model?: Model; banner?: string } {
  const [model, setModel] = useState<Model>()
  const [banner, setBanner] = useState<string>()
  useEffect(() => {
    let latest = 0
    const load = async () => {
      const call = ++latest
      try {
        const res = await fetch('/api/state')
        if (!res.ok) throw new Error(`the server answered ${res.status}`)
        const state = (await res.json()) as State
        if (call !== latest) return // a newer load is on its way
        if ('parseError' in state) {
          const { file, line, message } = state.parseError
          setBanner(`Can't read ${file}${line === undefined ? '' : ` (line ${line})`}: ${message}. Fix the file and this page updates.`)
        } else {
          setModel({ ...state.model, flows: state.flows, layout: state.layout })
          setBanner(undefined)
        }
      } catch (e) {
        if (call === latest) setBanner(`Can't load the model: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const events = new EventSource('/api/events')
    events.onopen = load // the first connection, and each reconnection after flowy restarts
    events.onmessage = load
    events.onerror = () => setBanner('Lost the connection to flowy. Retrying…')
    return () => events.close()
  }, [])
  return { model, banner }
}
