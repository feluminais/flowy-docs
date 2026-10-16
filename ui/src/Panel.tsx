import type { FocusEvent, FormEvent, ReactNode } from 'react'
import { encodePath, typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { getObject, ROOT } from '../../src/core/model.ts'
import type { FlowyObject, Model, ObjectType, Step } from '../../src/core/model.ts'
import { deleteFlow, deleteObject, OpError, putFlow, putObject, relabel, removeConnection, updateFlow } from '../../src/core/ops.ts'
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

/** The paths an object's `code` lists, as links when the repo is on GitHub or GitLab. Anything else in `code` is left to the problem list. */
function CodeList({ object, codeBase }: { object: FlowyObject; codeBase?: string }) {
  const paths = Array.isArray(object.code) ? object.code.filter((p): p is string => typeof p === 'string') : []
  if (paths.length === 0) return null
  return (
    <ul className="code-list" aria-label="Code">
      {paths.map((p, i) => <li key={i}>{codeBase ? <a href={codeBase + encodePath(p)} target="_blank" rel="noreferrer"><code>{p}</code></a> : <code>{p}</code>}</li>)}
    </ul>
  )
}

/** An object's description and code, or in edit mode a form for its name, type, tech, description and code. */
export function ObjectPanel({ model, id, editing, problems, codeBase, run, onClose }: Common & { id: string; editing: boolean; problems: Problem[]; codeBase?: string }) {
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
      <CodeList object={object} codeBase={codeBase} />
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
        <Field label="Code (one path per line)" value={Array.isArray(object.code) ? object.code.join('\n') : ''} multiline
          onSave={text => save({ code: text.split('\n').map(line => line.trim()).filter(Boolean) })} />
      </form>
      {mine}
      <p className="muted">id: {id}</p>
      <button className="danger" onClick={() => void run(m => deleteObject(m, id)).then(saved => saved && onClose())}>Delete</button>
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

/** The flow being recorded. While `id` is "", it still needs a name. `from` and `to` are the step being picked. */
export type Recording = { id: string; name: string; from?: string; to?: string }

/** The step list beside the canvas while recording a flow: click two boxes, type what happens, press Enter. */
/** The step with this detail, or with none when it's blank. */
function withDescription(step: Step, description: string): Step {
  const { description: _, ...rest } = step
  return description.trim() ? { ...rest, description } : rest
}

export function Recorder({ model, view, rec, onChange, run, onClose }: Common & { view: string; rec: Recording; onChange: (rec: Recording) => void }) {
  if (!rec.id) return (
    <Panel onClose={onClose}>
      <h2>New flow</h2>
      <form className="form" onSubmit={e => {
        e.preventDefault()
        const name = String(new FormData(e.currentTarget).get('name')).trim()
        if (name) onChange({ id: newId(name, Object.keys(model.flows), 'flow'), name })
      }}>
        <label>Name<input name="name" autoFocus placeholder="e.g. Customer checks out" /></label>
        <button>Start recording</button>
      </form>
    </Panel>
  )
  const flow = Object.hasOwn(model.flows, rec.id) ? model.flows[rec.id] : undefined
  const stepsIn = (m: Model) => (Object.hasOwn(m.flows, rec.id) ? m.flows[rec.id].steps : [])
  const steps = stepsIn(model)
  // Step numbers come from the list on screen. If the saved steps differ from it (a quick second
  // click, or someone else's edit), refuse rather than change the step that moved into that place.
  const onScreen = (m: Model) => {
    if (JSON.stringify(stepsIn(m)) !== JSON.stringify(steps)) throw new OpError('The steps just changed. Check them and try again.')
    return stepsIn(m)
  }
  const change = (edit: (steps: Step[]) => Step[]) => run(m => updateFlow(m, rec.id, { steps: edit(onScreen(m)) }))
  // A step with no "to", or one recorded by clicking the same box twice, is that box acting on its own.
  const ends = (from: string, to?: string) => (to === undefined || to === from ? `${nameOf(model, from)}, on its own` : `${nameOf(model, from)} → ${nameOf(model, to)}`)
  const addStep = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const text = String(new FormData(e.currentTarget).get('text')).trim()
    if (!text || !rec.from || !rec.to) return
    const step: Step = rec.to === rec.from ? { from: rec.from, text } : { from: rec.from, to: rec.to, text }
    // The first step creates the file: a flow with no steps is a problem, so it can't be saved before.
    const saved = await run(m => (Object.hasOwn(m.flows, rec.id)
      ? updateFlow(m, rec.id, { steps: [...onScreen(m), step] })
      : putFlow(m, { id: rec.id, name: rec.name, view, steps: [step] })))
    if (saved) onChange({ id: rec.id, name: rec.name })
  }
  return (
    <Panel onClose={onClose}>
      {flow
        ? <form className="form" onSubmit={e => e.preventDefault()}><Field label="Flow" value={flow.name} onSave={name => run(m => updateFlow(m, rec.id, { name }))} /></form>
        : <h2>{rec.name}</h2>}
      <ol className="steps form">
        {steps.map((s, i) => (
          <li key={i}>
            <Field label={ends(s.from, s.to)} value={s.text} onSave={text => change(all => all.with(i, { ...all[i], text }))} />
            <details className="more" open={Boolean(s.description) || undefined}>
              <summary>More</summary>
              {/* An empty field removes the detail, so the step's file stays as short as it can be. */}
              <Field label="Detail a reader can open (markdown)" value={String(s.description ?? '')} multiline onSave={description => change(all => all.with(i, withDescription(all[i], description)))} />
            </details>
            <div className="step-buttons">
              <button aria-label="Move up" disabled={i === 0} onClick={() => void change(all => all.with(i - 1, all[i]).with(i, all[i - 1]))}>↑</button>
              <button aria-label="Move down" disabled={i === steps.length - 1} onClick={() => void change(all => all.with(i + 1, all[i]).with(i, all[i + 1]))}>↓</button>
              <button aria-label="Delete step" onClick={() => void change(all => all.filter((_, j) => j !== i))}>×</button>
            </div>
          </li>
        ))}
      </ol>
      {rec.from && rec.to ? (
        <form className="form" onSubmit={addStep}>
          <label>
            {ends(rec.from, rec.to)}
            <input name="text" autoFocus placeholder="What happens? Press Enter" onKeyDown={e => e.key === 'Escape' && onChange({ id: rec.id, name: rec.name })} />
          </label>
        </form>
      ) : (
        <p className="muted">{rec.from ? `From ${nameOf(model, rec.from)}. Now click the box it goes to, or the same box for a step it does on its own.` : 'Click the box where the next step starts.'}</p>
      )}
      <div className="panel-buttons">
        {flow && <button className="danger" onClick={() => void run(m => deleteFlow(m, rec.id)).then(saved => saved && onClose())}>Delete flow</button>}
        <button onClick={onClose}>Done</button>
      </div>
    </Panel>
  )
}
