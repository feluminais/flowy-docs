import { useEffect, useRef, useState } from 'react'
import type { CompareTag } from '../../src/core/compare.ts'
import { Description } from './Box.tsx'
import { compareOf } from '../../src/core/compare.ts'
import { noteOf, orderPair, pairKey, pairOff, saveTarget, unsaved } from './compare.ts'
import { ArrowsLeftRight } from './icons.tsx'

export type CompareNoteProps = {
  kind: 'flow' | 'run'
  /** The pair as it reads: `a` first (left, or the one on show first in Swap), `b` second. With no tag, the line goes to `b`. */
  a: string
  b: string
  items: Record<string, { name?: string; compare?: unknown }>
  /** Why a note can't be written (the page can't save), or undefined. It is the tooltip of the greyed controls. */
  off: string | undefined
  /** The text in the editor, or undefined while it is closed. The reader keeps it, so it survives this strip being unmounted and so closing the comparison can ask first. */
  draft: string | undefined
  onDraft: (text: string | undefined) => void
  /** Writes the tag (and its note) onto `id`. Resolves to what to tell the user, or undefined once it is saved. */
  onSave: (id: string, tag: CompareTag) => Promise<string | undefined>
  onNotice: (message: string) => void
  /** The existing Swap sides control: it changes which flow gets the line. */
  onFlip: () => void
}

/**
 * The note on a pair, under the panes. A pair with a tag shows its saved note as Markdown, and Note opens the editor on it; Save writes it with the tag. A pair with no
 * tag has no file to hold a note, so what is typed is a draft (the reader keeps it until it is saved or discarded), and Save as pair names the flow that gets the line, then writes
 * the tag with the draft as its note. Nothing is hidden when a note can't be written: the controls are greyed out and the tooltip says why. Saved notes always show.
 */
export function CompareNote({ kind, a, b, items, off, draft, onDraft, onSave, onNotice, onFlip }: CompareNoteProps) {
  const saved = noteOf(items, a, b)
  const tagged = saved.holder !== undefined
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const editing = draft !== undefined
  const nameOf = (id: string) => items[id]?.name || id
  const sameOff = pairOff(kind, a, b)
  const target = saveTarget(kind, items, a, b, draft)

  useEffect(() => {
    const el = field.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length) // to write on from the end of what is there
  }, [editing])
  const pair = pairKey(a, b)
  useEffect(() => setConfirming(false), [pair]) // another pair asks again from the start; the same pair with its sides swapped keeps asking

  const save = async (id: string, tag: CompareTag) => {
    setBusy(true)
    const message = await onSave(id, tag)
    setBusy(false)
    if (message === undefined) {
      setConfirming(false)
      onDraft(undefined)
    } else onNotice(message)
  }
  // Save as pair names the flow that gets the line before it writes. Swap sides (here and on the bar) changes it.
  const newer = target.id
  const older = target.tag.with
  // The line goes to the right-hand flow, unless that one already links elsewhere and the other does not: then it goes to the other, and the confirm says why.
  const usual = orderPair(kind, items, a, b)[1]
  const moved = !tagged && newer !== usual ? usual : undefined

  return (
    <section className="compare-note" aria-label="Note">
      <div className="note-body">
        {editing ? (
          <textarea ref={field} value={draft} rows={3} aria-label="Note" placeholder="Note" spellCheck
            onChange={e => onDraft(e.target.value)}
            onKeyDown={e => {
              // The keys of a field are its own: Escape leaves it, and a second one is the comparison's.
              if (e.key === 'Escape') {
                e.stopPropagation()
                e.currentTarget.blur()
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && tagged && off === undefined && !busy) {
                e.preventDefault()
                void save(target.id, target.tag)
              }
            }} />
        ) : saved.text !== '' ? (
          <div className="prose note-text"><Description text={saved.text} /></div>
        ) : null}
      </div>
      <div className="note-actions">
        {confirming ? (
          <>
            <span className="note-confirm">Tag <b>{nameOf(newer)}</b> as the newer of <b>{nameOf(older)}</b></span>
            {moved !== undefined && <span className="note-confirm">{nameOf(moved)} already links to <b>{nameOf(compareOf(items[moved]?.compare)?.with ?? '')}</b></span>}
            {target.replaces !== undefined && <span className="note-confirm warn">Replaces its link to <b>{nameOf(target.replaces)}</b></span>}
            <button className="icon" aria-label="Swap sides" title="Swap sides" onClick={onFlip}><ArrowsLeftRight size={16} /></button>
            <button className="primary" disabled={off !== undefined || busy} title={off} onClick={() => void save(target.id, target.tag)}>Save</button>
            <button disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <>
            {!editing && <button disabled={off !== undefined} title={off ?? (saved.text === '' ? 'Write a note' : 'Change the note')} onClick={() => onDraft(saved.text)}>Note</button>}
            {editing && tagged && <button className="primary" disabled={off !== undefined || busy || !unsaved(draft, saved.text)} onClick={() => void save(target.id, target.tag)}>Save</button>}
            {editing && <button disabled={busy} onClick={() => onDraft(undefined)}>Cancel</button>}
            {!tagged && (
              <button disabled={off !== undefined || sameOff !== undefined} title={off ?? sameOff ?? `Link these ${kind}s`} onClick={() => setConfirming(true)}>Save as pair</button>
            )}
          </>
        )}
      </div>
    </section>
  )
}
