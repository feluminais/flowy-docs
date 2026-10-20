import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { bandOf, BAND_NAMES, partName, riskOf } from '../../src/core/failures.ts'
import type { Analysis, Mode, Model } from '../../src/core/model.ts'
import { getObject } from '../../src/core/model.ts'
import { deleteAnalysis, deleteMode, putAnalysis, putMode, updateAnalysis, updateMode } from '../../src/core/ops.ts'
import type { ModeChanges } from '../../src/core/ops.ts'
import type { Run as LoadRun } from '../../src/core/perf.ts'
import { isView } from '../../src/core/views.ts'
import { newId } from './edit.ts'
import { STATUS_NAMES } from './failuresview.ts'
import { Plus, Trash } from './icons.tsx'
import { Field } from './Panel.tsx'
import type { Run } from './Panel.tsx'

/** The forms that write a failure analysis: every save is one edit, refused with the checker's words when it would add a problem, and the field goes back to what it was. */

/** A select that saves when it changes, and goes back to what it was when the edit is refused. Keyed by its value so it shows the saved one after a reload. */
function Choice({ label, value, options, onSave }: { label: ReactNode; value: string; options: [string, string][]; onSave: (value: string) => Promise<boolean> }) {
  return (
    <label>
      {label}
      <select key={value} defaultValue={value} onChange={async e => { if (!(await onSave(e.target.value))) e.target.value = value }}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  )
}

const RATING_OPTIONS: [string, string][] = [['', '–'], ...Array.from({ length: 10 }, (_, i): [string, string] => [String(i + 1), String(i + 1)])]
const STATUS_OPTIONS: [string, string][] = Object.entries(STATUS_NAMES)

/** Every shape, by the path a reader sees. */
const shapeOptions = (model: Model): [string, string][] => Object.keys(model.objects).filter(id => getObject(model, id)).map(id => [id, partName(model, { on: id })])
/** The shapes a connection starts at, and the ones the chosen one connects to: only a line that exists can carry a mode. */
const fromOptions = (model: Model): [string, string][] => [...new Set(model.connections.map(c => c.from))].filter(id => getObject(model, id)).map(id => [id, partName(model, { on: id })])
const toOptions = (model: Model, from: string): [string, string][] => [...new Set(model.connections.filter(c => c.from === from).map(c => c.to))].filter(id => getObject(model, id)).map(id => [id, partName(model, { on: id })])

/** The first analysis: a name, and it is made. */
export function NewAnalysis({ model, run, onMade }: { model: Model; run: Run; onMade: (id: string) => void }) {
  const make = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const name = String(new FormData(form).get('name')).trim()
    if (!name) return
    let id = ''
    const saved = await run(m => {
      id = newId(name, Object.keys(m.failures), 'analysis') // from the fresh model, so it never lands on an existing analysis
      return putAnalysis(m, { id, name, modes: {} })
    })
    if (saved) {
      form.reset()
      onMade(id)
    }
  }
  return (
    <form className="form" onSubmit={make}>
      <label>Name<input name="name" /></label>
      <button className="primary"><Plus size={16} />New analysis</button>
    </form>
  )
}

/** The analysis itself: its name, About and Scope, and deleting it with its modes. */
export function AnalysisForm({ model, id, run }: { model: Model; id: string; run: Run }) {
  const a: Analysis = model.failures[id]
  const save = (changes: { name?: string; about?: string; scope?: string }) => run(m => updateAnalysis(m, id, changes))
  const scopes: [string, string][] = [['', 'Overview'], ...Object.keys(model.objects).filter(o => isView(model, o)).map((o): [string, string] => [o, partName(model, { on: o })])]
  const count = Object.keys(a.modes).length
  return (
    <details className="about">
      <summary>Edit analysis</summary>
      <div className="form">
        <Field label="Name" value={a.name} onSave={name => save({ name })} />
        <Field label="About" value={a.about ?? ''} multiline onSave={about => save({ about })} />
        <Choice label="Scope" value={a.scope && a.scope !== 'root' ? a.scope : ''} options={scopes} onSave={scope => save({ scope })} />
        <button className="danger" onClick={() => void run(m => deleteAnalysis(m, id))}><Trash size={16} />Delete analysis and its {count} mode{count === 1 ? '' : 's'}</button>
      </div>
    </details>
  )
}

/** Where a new mode starts: the part it names, if one is picked. */
export type Preset = { on?: string; from?: string; to?: string }

/** A new mode: the part and the sentence, which is all the checker needs. The rest is filled in on the mode's own form. */
export function AddMode({ model, analysisId, preset, run, onAdded, onCancel }: { model: Model; analysisId: string; preset: Preset; run: Run; onAdded: (id: string) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<'shape' | 'line'>(preset.from !== undefined ? 'line' : 'shape')
  const [on, setOn] = useState(preset.on ?? '')
  const [from, setFrom] = useState(preset.from ?? '')
  const [to, setTo] = useState(preset.to ?? '')
  const targets = toOptions(model, from)
  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const sentence = String(new FormData(e.currentTarget).get('mode')).trim()
    if (!sentence) return
    let id = ''
    const saved = await run(m => {
      id = newId(sentence, Object.keys(m.failures[analysisId].modes), 'mode')
      return putMode(m, analysisId, id, { mode: sentence, ...(kind === 'shape' ? { on } : { from, to }) })
    })
    if (saved) onAdded(id)
  }
  return (
    <form className="form" onSubmit={add}>
      <label>Part<select value={kind} onChange={e => setKind(e.target.value as 'shape' | 'line')}><option value="shape">A shape</option><option value="line">A line</option></select></label>
      {kind === 'shape'
        ? <label>Shape<select value={on} onChange={e => setOn(e.target.value)}><option value="">–</option>{shapeOptions(model).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
        : (
          <>
            <label>From<select value={from} onChange={e => { setFrom(e.target.value); setTo(toOptions(model, e.target.value)[0]?.[0] ?? '') }}><option value="">–</option>{fromOptions(model).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label>To<select value={to} onChange={e => setTo(e.target.value)}><option value="">–</option>{targets.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
          </>
        )}
      <label>Mode<input name="mode" autoFocus /></label>
      <span className="perf-buttons"><button className="primary"><Plus size={16} />Add</button><button type="button" onClick={onCancel}>Cancel</button></span>
    </form>
  )
}

/** Every field of the picked mode. */
export function ModeForm({ model, analysisId, modeId, runs, run }: { model: Model; analysisId: string; modeId: string; runs: Record<string, LoadRun>; run: Run }) {
  const m: Mode = model.failures[analysisId].modes[modeId]
  const save = (changes: ModeChanges) => run(model2 => updateMode(model2, analysisId, modeId, changes))
  const text = (label: string, key: 'mode' | 'effect' | 'cause' | 'owner' | 'step', multiline = false) => (
    <Field label={label} value={m[key] ?? ''} multiline={multiline} onSave={value => save({ [key]: value })} />
  )
  const rating = (label: string, key: 'severity' | 'occurrence' | 'detection') => (
    <Choice label={label} value={m[key] ?? ''} options={RATING_OPTIONS} onSave={value => save({ [key]: value })} />
  )
  const after = (label: string, key: 'severity' | 'occurrence' | 'detection') => (
    <Choice label={label} value={m.after?.[key] ?? ''} options={RATING_OPTIONS} onSave={value => save({ after: { [key]: value } })} />
  )
  const kind = m.on !== undefined && m.on !== '' ? 'shape' : m.from !== undefined || m.to !== undefined ? 'line' : 'shape'
  const flows: [string, string][] = [['', '–'], ...Object.entries(model.flows).map(([id, f]): [string, string] => [id, f.name || id])]
  const runList: [string, string][] = [['', '–'], ...Object.entries(runs).map(([id, r]): [string, string] => [id, r.name || id])]
  const affects = m.affects ?? []
  const band = bandOf(m)
  return (
    <div className="form">
      {text('Mode', 'mode')}
      <Choice label="Part" value={kind} options={[['shape', 'A shape'], ['line', 'A line']]}
        onSave={value => (value === 'shape' ? save({ on: m.from ?? '', from: '', to: '' }) : save({ on: '', from: m.on ?? '', to: '' }))} />
      {kind === 'shape'
        ? <Choice label="Shape" value={m.on ?? ''} options={[['', '–'], ...shapeOptions(model)]} onSave={on => save({ on })} />
        : (
          <>
            <Choice label="From" value={m.from ?? ''} options={[['', '–'], ...fromOptions(model)]} onSave={from => save({ from, to: toOptions(model, from)[0]?.[0] ?? '' })} />
            <Choice label="To" value={m.to ?? ''} options={[['', '–'], ...toOptions(model, m.from ?? '')]} onSave={to => save({ to })} />
          </>
        )}
      {text('Effect', 'effect')}
      {text('Cause', 'cause')}
      {rating('Severity (1 to 10)', 'severity')}
      {rating('Likelihood (1 to 10)', 'occurrence')}
      {rating('Hard to spot (1 to 10)', 'detection')}
      <p className="riskline"><span className="label">Risk</span> <strong>{riskOf(m) ?? '–'}</strong> <span className={`sw ${band}`} aria-hidden="true" />{BAND_NAMES[band]}</p>
      {after('After: Severity (1 to 10)', 'severity')}
      {after('After: Likelihood (1 to 10)', 'occurrence')}
      {after('After: Hard to spot (1 to 10)', 'detection')}
      <Field label="Controls" value={m.controls ?? ''} multiline onSave={controls => save({ controls })} />
      <Field label="Next action" value={m.action ?? ''} multiline onSave={action => save({ action })} />
      {text('Owner', 'owner')}
      <Choice label="Status" value={m.status !== undefined && Object.hasOwn(STATUS_NAMES, m.status) ? m.status : 'open'} options={STATUS_OPTIONS} onSave={status => save({ status: status === 'open' ? '' : status })} />
      <div className="affects">
        <span className="label">Affects</span>
        <ul className="plain">
          {affects.map(id => (
            <li key={id}>{partName(model, { on: id })} <button type="button" className="link" onClick={() => void save({ affects: affects.filter(a => a !== id) })}>Remove</button></li>
          ))}
        </ul>
        <select aria-label="Add a shape to Affects" value="" onChange={e => { if (e.target.value !== '') void save({ affects: [...affects, e.target.value] }) }}>
          <option value="">Add a shape</option>
          {shapeOptions(model).filter(([id]) => !affects.includes(id)).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select>
      </div>
      <Choice label="Flow" value={m.flow ?? ''} options={flows} onSave={flow => save({ flow, ...(flow === '' ? { step: '' } : {}) })} />
      {text('Step (from 1)', 'step')}
      <Choice label="Run" value={m.run ?? ''} options={runList} onSave={r => save({ run: r })} />
      <Field label="More (Markdown)" value={m.description ?? ''} multiline onSave={description => save({ description })} />
      <button className="danger" onClick={() => void run(model2 => deleteMode(model2, analysisId, modeId))}><Trash size={16} />Delete mode</button>
    </div>
  )
}
