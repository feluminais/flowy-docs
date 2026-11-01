import { useEffect, useRef } from 'react'
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react'
import type { Model } from '../../src/core/model.ts'
import { Dropdown } from './Dropdown.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { focusIf, useFocusBack } from './focusback.ts'
import { Close } from './icons.tsx'

/** Runs one edit and resolves to true once it's saved. Whatever went wrong shows as a notice. */
export type SaveEdit = (op: (model: Model) => Model) => Promise<boolean>

/** What every panel gets: the model, the edit runner and the way to close it. */
export type Common = { model: Model; run: SaveEdit; onClose: () => void }

/** The frame of a side panel on the right: a close button over its content. Its name is what a screen reader lists it as, and the button's name says which one it closes. */
export function Panel({ onClose, children, label = 'Details' }: { onClose: () => void; children: ReactNode; label?: string }) {
  useFocusBack(() => document.querySelector('nav.rail:not(.left) button')) // closed by Esc or the X, the focus goes back to the rail button that opens it
  return (
    <aside className="panel" aria-label={label} tabIndex={-1}>
      <button className="close" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}><Close size={16} /></button>
      <ErrorBoundary>{children}</ErrorBoundary>
    </aside>
  )
}

/**
 * A text field that saves when you leave it or press Enter, and shows the saved text again if saving fails. Esc puts the saved text back and leaves the field for its panel.
 * It stays where it is when the saved text changes under it (a reload): text being typed is kept, and a field not being typed in shows the new text.
 */
export function Field({ label, value, multiline, list, placeholder, disabled, title, onSave }: { label: ReactNode; value: string; multiline?: boolean; list?: string; placeholder?: string; disabled?: boolean; title?: string; onSave: (value: string) => Promise<boolean> }) {
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const seen = useRef(value) // the saved text the field was last in step with
  useEffect(() => {
    const el = input.current
    if (el && (document.activeElement !== el || el.value === seen.current)) el.value = value
    seen.current = value
  }, [value])
  const save = async (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (el.value !== value && !(await onSave(el.value))) el.value = value
  }
  // The focus goes to the panel the field is in (it saves what was typed), else nowhere.
  const leave = (el: HTMLInputElement | HTMLTextAreaElement) => {
    if (!focusIf(el.closest('aside.panel'))) el.blur()
  }
  const keys = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !multiline) leave(e.currentTarget)
    else if (e.key === 'Escape') {
      e.stopPropagation() // the field's Esc is its own; the next one is the panel's
      e.currentTarget.value = value
      leave(e.currentTarget)
    }
  }
  const take = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    input.current = el
  }
  return (
    <label title={title}>
      {label}
      {multiline
        ? <textarea ref={take} defaultValue={value} rows={8} disabled={disabled} onBlur={save} onKeyDown={keys} />
        : <input ref={take} defaultValue={value} list={list} placeholder={placeholder} disabled={disabled} onBlur={save} onKeyDown={keys} />}
    </label>
  )
}

/** A dropdown that saves when it changes. It shows the saved value, so it goes back to what it was when the edit is refused. */
export function Choice({ label, value, options, onSave }: { label: ReactNode; value: string; options: [string, string][]; onSave: (value: string) => Promise<boolean> }) {
  return (
    <label>
      {label}
      <Dropdown value={value} options={options} onChange={v => void onSave(v)} />
    </label>
  )
}
