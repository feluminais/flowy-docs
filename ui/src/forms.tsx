import type { FocusEvent, ReactNode } from 'react'
import type { Model } from '../../src/core/model.ts'

/** Runs one edit and resolves to true once it's saved. Whatever went wrong shows as a notice. */
export type SaveEdit = (op: (model: Model) => Model) => Promise<boolean>

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

/** A select that saves when it changes, and goes back to what it was when the edit is refused. Keyed by its value so it shows the saved one after a reload. */
export function Choice({ label, value, options, onSave }: { label: ReactNode; value: string; options: [string, string][]; onSave: (value: string) => Promise<boolean> }) {
  return (
    <label>
      {label}
      <select key={value} defaultValue={value} onChange={async e => { if (!(await onSave(e.target.value))) e.target.value = value }}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  )
}
