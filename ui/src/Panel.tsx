import type { FocusEvent, FormEvent, ReactNode } from 'react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { getObject, ROOT } from '../../src/core/model.ts'
import type { Model, ObjectType } from '../../src/core/model.ts'
import { deleteObject, putObject, relabel, removeConnection } from '../../src/core/ops.ts'
import type { ObjectInput } from '../../src/core/ops.ts'
import { parentOf } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { connectionsOf, nameOf, newId, problemsOf } from './edit.ts'

/** Runs one edit and resolves to true once it's saved. Whatever went wrong shows as a notice. */
export type Run = (op: (model: Model) => Model) => Promise<boolean>

function Panel({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <aside className="panel">
      <button className="close" aria-label="Close" onClick={onClose}>×</button>
      {children}
    </aside>
  )
}

function ProblemList({ problems }: { problems: Problem[] }) {
  return problems.length === 0 ? null : <ul className="problem-list">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>
}

/** A text field that saves when you leave it or press Enter, and shows the saved text again if saving fails. */
function Field({ label, value, multiline, onSave }: { label: ReactNode; value: string; multiline?: boolean; onSave: (value: string) => Promise<boolean> }) {
  const save = async (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = e.currentTarget
    if (input.value !== value && !(await onSave(input.value))) input.value = value
  }
  // Keyed by the saved value, so the field shows the new text after every reload.
  return (
    <label>
      {label}
      {multiline
        ? <textarea key={value} defaultValue={value} rows={8} onBlur={save} />
        : <input key={value} defaultValue={value} onBlur={save} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />}
    </label>
  )
}

type Common = { model: Model; run: Run; onClose: () => void }

/** An object's description, or in edit mode a form for its name, type, tech and description. */
export function ObjectPanel({ model, id, editing, problems, run, onClose }: Common & { id: string; editing: boolean; problems: Problem[] }) {
  const object = getObject(model, id)
  if (!object) return null
  const save = (fields: Omit<ObjectInput, 'id'>) => run(m => putObject(m, { id, ...fields }))
  const mine = <ProblemList problems={problemsOf(model, problems, id)} />
  if (!editing) return (
    <Panel onClose={onClose}>
      <h2>{object.name || id}</h2>
      <p className="muted">{object.type}{object.tech ? ` · ${object.tech}` : ''}</p>
      {mine}
      {object.description ? <Description text={object.description} /> : <p className="muted">No description yet.</p>}
    </Panel>
  )
  // A type the nesting rules don't allow here stays in the list, so the form shows what the file says.
  const types = [...new Set([...typesIn(model, parentOf(model, id)), object.type])].filter(Boolean)
  return (
    <Panel onClose={onClose}>
      <form key={id} className="form" onSubmit={e => e.preventDefault()}>
        <Field label="Name" value={object.name ?? ''} onSave={name => save({ name })} />
        <label>
          Type
          <select value={object.type} onChange={e => void save({ type: e.target.value as ObjectType })}>
            {types.map(t => <option key={t}>{t}</option>)}
          </select>
        </label>
        <Field label="Tech" value={object.tech ?? ''} onSave={tech => save({ tech })} />
        <Field label="Description" value={object.description ?? ''} multiline onSave={description => save({ description })} />
      </form>
      {mine}
      <p className="muted">id: {id}</p>
      <button className="danger" onClick={() => void run(m => deleteObject(m, id))}>Delete</button>
    </Panel>
  )
}

/** The connections one line stands for (a zoomed-out line can merge several), each with its label. */
export function LinePanel({ model, view, from, to, editing, problems, run, onClose }: Common & { view: string; from: string; to: string; editing: boolean; problems: Problem[] }) {
  const lines = connectionsOf(model, view, from, to)
  if (lines.length === 0) return null
  return (
    <Panel onClose={onClose}>
      <h2>{nameOf(model, from)} → {nameOf(model, to)}</h2>
      {lines.map(({ index, connection: c }) => {
        const which = { from: c.from, to: c.to, label: c.label ?? '' }
        return (
          <section key={index} className="line">
            {(c.from !== from || c.to !== to) && <p className="muted">{nameOf(model, c.from)} → {nameOf(model, c.to)}</p>}
            {editing ? (
              <form className="form" onSubmit={e => e.preventDefault()}>
                <Field label="Label" value={c.label ?? ''} onSave={label => run(m => relabel(m, which, label))} />
                <button type="button" className="danger" onClick={() => void run(m => removeConnection(m, which))}>Delete</button>
              </form>
            ) : <p>{c.label || <span className="muted">No label</span>}</p>}
            <ProblemList problems={problems.filter(p => p.connection === index)} />
          </section>
        )
      })}
    </Panel>
  )
}

/** A new object in the current view, with only the types the nesting rules allow there. */
export function AddPanel({ model, view, run, onAdded, onClose }: Common & { view: string; onAdded: (id: string) => void }) {
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const type = form.get('type') as ObjectType
    const name = String(form.get('name')).trim()
    if (!name) return
    let id = ''
    const saved = await run(m => {
      id = newId(name, Object.keys(m.objects), type) // from the fresh model, so it never lands on an existing object
      return putObject(m, { id, type, name, in: view === ROOT ? undefined : view })
    })
    if (saved) onAdded(id)
  }
  return (
    <Panel onClose={onClose}>
      <h2>Add to {nameOf(model, view)}</h2>
      <form className="form" onSubmit={add}>
        <label>Type<select name="type">{typesIn(model, view).map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Name<input name="name" autoFocus /></label>
        <button>Add</button>
      </form>
    </Panel>
  )
}
