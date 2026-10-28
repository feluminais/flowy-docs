import { useState } from 'react'
import type { DraftInfo } from '../../src/core/drafts.ts'
import { newId } from './edit.ts'
import { Draft, Plus } from './icons.tsx'
import { draftAddress, makeDraft } from './models.ts'

/**
 * The Drafts group under the Explorer's tree: a row for each draft of the model, which opens it in this tab as the Model picker opens a model,
 * and New draft, which makes an empty one and opens it. A draft is a model of its own in drafts/<id>/ (see core/drafts.ts), so making one
 * changes no file of the model and needs no edit mode. `off` says why this page can't make one; the button is greyed then, not hidden.
 */
export function DraftsList({ drafts, off }: { drafts: DraftInfo[]; off: string | undefined }) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const close = () => {
    setNaming(false)
    setName('')
    setError(undefined)
  }
  const make = async () => {
    if (name.trim() === '' || busy) return
    setBusy(true)
    try {
      location.assign(await makeDraft(newId(name, drafts.map(d => d.id), 'draft'), name.trim()))
    } catch (e) {
      setError(`Not made: ${e instanceof Error ? e.message : String(e)}`)
      setBusy(false)
    }
  }
  return (
    <section className="drafts" aria-labelledby="drafts-head">
      <h3 className="navhead" id="drafts-head">Drafts <span className="count">{drafts.length}</span></h3>
      {drafts.length === 0 && !naming && <p className="muted navnote">No drafts.</p>}
      {drafts.map(d => (
        <a key={d.id} className="draft-row" href={draftAddress(d.id)}>
          <Draft size={16} /><span className="name">{d.name}</span>
        </a>
      ))}
      {naming
        ? (
          <form className="draft-new" onSubmit={e => { e.preventDefault(); void make() }}>
            <input autoFocus aria-label="Draft name" value={name} disabled={busy} onChange={e => { setName(e.target.value); setError(undefined) }}
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
        : <button className="draft-add" disabled={off !== undefined} title={off} onClick={() => setNaming(true)}><Plus size={16} />New draft</button>}
    </section>
  )
}

/** The mark in the top bar of a draft: the model it belongs to, which leads back, and Draft. */
export function DraftMark({ of, back }: { of: string; back: string }) {
  return (
    <span className="draft-mark">
      <a href={back} title="Back to the model">{of || 'Model'}</a>
      <span className="draft-chip"><Draft size={14} />Draft</span>
    </span>
  )
}
