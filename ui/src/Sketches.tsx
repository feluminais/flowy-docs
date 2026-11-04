import { useEffect, useRef, useState } from 'react'
import type { SketchInfo } from '../../src/core/sketches.ts'
import { newId } from './edit.ts'
import { focusIfLost } from './focusback.ts'
import { Sketch, Plus } from './icons.tsx'
import { sketchAddress, makeSketch } from './models.ts'

/**
 * The Sketches group under the Explorer's tree: a row for each sketch of the model, which opens it in this tab as the Model picker opens a model,
 * and New sketch, which makes an empty one and opens it. A sketch is a model of its own in sketches/<id>/ (see core/sketches.ts), so making one
 * changes no file of the model and needs no edit mode. `off` says why this page can't make one; the button is greyed then, not hidden.
 */
export function SketchesList({ sketches, off }: { sketches: SketchInfo[]; off: string | undefined }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  // The name field and its buttons go when it is cancelled, and the focus goes back to the button that opened them.
  const add = useRef<HTMLButtonElement>(null)
  const was = useRef(false)
  useEffect(() => {
    if (was.current && !naming) focusIfLost(add.current)
    was.current = naming
  }, [naming])
  const close = () => {
    setNaming(false)
    setName('')
    setError(undefined)
  }
  const make = async () => {
    if (name.trim() === '' || busy) return
    setBusy(true)
    try {
      location.assign(await makeSketch(newId(name, sketches.map(d => d.id), 'sketch'), name.trim()))
    } catch (e) {
      setError(`Not made: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }
  return (
    <section className="sketches" aria-labelledby="sketches-head">
      <h3 className="navhead" id="sketches-head">Sketches <span className="count">{sketches.length}</span></h3>
      {sketches.length === 0 && !naming && <p className="muted navnote">No sketches.</p>}
      {sketches.map(d => (
        <a key={d.id} className="sketch-row" href={sketchAddress(d.id)}>
          <Sketch size={16} /><span className="name">{d.name}</span>
        </a>
      ))}
      {naming
        ? (
          <form className="sketch-new" onSubmit={e => { e.preventDefault(); void make() }}>
            <input autoFocus aria-label="Sketch name" value={name} disabled={busy} onChange={e => { setName(e.target.value); setError(undefined) }}
              onKeyDown={e => {
                if (e.key !== 'Escape') return
                e.stopPropagation()
                close()
              }} />
            <button type="submit" className="primary" disabled={name.trim() === '' || busy}>Add</button>
            <button type="button" onClick={close}>Cancel</button>
            {error && <p className="bad" role="alert">{error}</p>}
          </form>
        )
        : <button ref={add} className="sketch-add" disabled={off !== undefined} title={off} onClick={() => setNaming(true)}><Plus size={16} />New sketch</button>}
    </section>
  )
}

/** The mark in the top bar of a sketch: the model it belongs to, which leads back, and Sketch. */
export function SketchMark({ of, back }: { of: string; back: string }) {
  return (
    <span className="sketch-mark">
      <a href={back} title="Back to the model">{of || 'Model'}</a>
      <span className="sketch-chip"><Sketch size={14} />Sketch</span>
    </span>
  )
}
