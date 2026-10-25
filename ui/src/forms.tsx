import type { FocusEvent, ReactNode } from 'react'
import type { Model } from '../../src/core/model.ts'
import { Dropdown } from './Dropdown.tsx'
import { Close } from './icons.tsx'

/** Runs one edit and resolves to true once it's saved. Whatever went wrong shows as a notice. */
export type SaveEdit = (op: (model: Model) => Model) => Promise<boolean>

/** What every panel gets: the model, the edit runner and the way to close it. */
export type Common = { model: Model; run: SaveEdit; onClose: () => void }

/** The frame of a side panel on the right: a close button over its content. Its name is what a screen reader lists it as, and the button's name says which one it closes. */
export function Panel({ onClose, children, label = 'Details' }: { onClose: () => void; children: ReactNode; label?: string }) {
  return (
    <aside className="panel" aria-label={label}>
      <button className="close" aria-label={`Close ${label.toLowerCase()}`} onClick={onClose}><Close size={16} /></button>
      {children}
    </aside>
  )
}

/** A text field that saves when you leave it or press Enter, and shows the saved text again if saving fails. */
export function Field({ label, value, multiline, list, placeholder, disabled, title, onSave }: { label: ReactNode; value: string; multiline?: boolean; list?: string; placeholder?: string; disabled?: boolean; title?: string; onSave: (value: string) => Promise<boolean> }) {
  const save = async (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = e.currentTarget
    if (input.value !== value && !(await onSave(input.value))) input.value = value
  }
  // Keyed by the saved value, so the field shows the new text after every reload.
  return (
    <label title={title}>
      {label}
      {multiline
        ? <textarea key={value} defaultValue={value} rows={8} disabled={disabled} onBlur={save} />
        : <input key={value} defaultValue={value} list={list} placeholder={placeholder} disabled={disabled} onBlur={save} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />}
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
