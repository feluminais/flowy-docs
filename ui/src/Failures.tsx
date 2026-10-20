import { Fragment, useState } from 'react'
import type { Problem } from '../../src/core/check.ts'
import { bandOf, BAND_NAMES, coverage, partName, ratingsOf, reach, riskOf } from '../../src/core/failures.ts'
import type { Band, Part, Ranked } from '../../src/core/failures.ts'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf.ts'
import { nameOf } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { Section } from './Chrome.tsx'
import { afterText, bandCounts, firstErrorAt, ratingCells, STATUS_NAMES } from './failuresview.ts'
import type { Filter } from './failuresview.ts'
import { AddMode, AnalysisForm, ModeForm, NewAnalysis } from './FailuresEdit.tsx'
import type { Preset } from './FailuresEdit.tsx'
import { Activity, Alert, Close, Copy, Info, Plus, Route } from './icons.tsx'
import type { Run as Edit } from './Panel.tsx'
import { KeyItem, KeyRow } from './Performance.tsx'

/** What the Failures tab's body is told: the folder, the analysis on show and the mode picked in it, the rows to list, and what to do about a click. */
export type FailuresProps = {
  model: Model
  /** The level the canvas shows: the list's "This view" is what this level holds. */
  view: string
  runs: Record<string, Run>
  /** Every problem of the model; the analysis's own are the ones whose file is its file. */
  problems: Problem[]
  /** Files in failures/ that were skipped, and run links that point at nothing. */
  failureProblems: Problem[]
  analysisId: string | undefined
  modeId?: string
  rows: { here: Ranked[]; elsewhere: Ranked[] }
  filter: Filter
  /** The shape or line picked on the canvas, if one is: the list shows what it carries. */
  part?: Part
  onAnalysis: (id: string) => void
  onMode: (id: string | undefined) => void
  onFilter: (filter: Filter) => void
  onClearPart: () => void
  /** Go to a shape on the canvas, from the list of those no mode names yet. */
  onPickShape: (id: string) => void
  onShowFlow: (flowId: string, step?: number) => void
  onSeenInRun: (modeId: string) => void
  onCopy: (format: 'markdown' | 'csv') => void
  /** In edit mode the tab holds the forms that write an analysis; `run` saves one edit and says whether it was saved. */
  editing: boolean
  run: Edit
}

/** Where a new mode starts: the shape picked, or the line picked when it is a connection of the model (a merged line may not be). */
const presetOf = (model: Model, part?: Part): Preset =>
  part === undefined ? {} : 'box' in part ? { on: part.box } : model.connections.some(c => c.from === part.line[0] && c.to === part.line[1]) ? { from: part.line[0], to: part.line[1] } : {}

const BAND_ORDER: Band[] = ['high', 'medium', 'low', 'unrated']
const RATINGS = [['severity', 'Severity'], ['occurrence', 'Likelihood'], ['detection', 'Hard to spot']] as const

/** The Failures tab's body, read only: which analysis, how it adds up, what to look at first, and everything about the mode picked. */
export function FailuresBody(p: FailuresProps) {
  const { model, analysisId, modeId, rows, filter, part } = p
  const [adding, setAdding] = useState<Preset>()
  const analysis = analysisId !== undefined && Object.hasOwn(model.failures, analysisId) ? model.failures[analysisId] : undefined
  const ids = Object.keys(model.failures)
  const mode = analysis && modeId !== undefined && Object.hasOwn(analysis.modes, modeId) ? analysis.modes[modeId] : undefined
  const problems = [...p.failureProblems, ...p.problems.filter(x => analysisId !== undefined && x.file === `failures/${analysisId}.yaml`)]
  const problemList = problems.length > 0 && (
    <>
      <Section icon={Alert} title="Problems" count={problems.length} />
      <ul className="plain">{problems.map((x, i) => <li key={i}><span className="muted">{x.file}</span> {x.message}</li>)}</ul>
    </>
  )
  if (!analysis) {
    return (
      <div className="perf fail">
        {problems.length === 0 && <p className="muted">No failure analyses.</p>}
        {p.editing && <NewAnalysis model={model} run={p.run} onMade={p.onAnalysis} />}
        {problemList}
      </div>
    )
  }

  const counts = bandCounts(analysis)
  const covered = coverage(model, analysis)
  const total = covered.analysed.length + covered.left.length
  const listed = rows.here.length + rows.elsewhere.length
  const picked = part === undefined ? undefined : partName(model, 'box' in part ? { on: part.box } : { from: part.line[0], to: part.line[1] })
  const lit = mode ? reach(model, p.view, mode) : undefined
  const flowShown = mode?.flow !== undefined && Object.hasOwn(model.flows, mode.flow)
  const run = mode?.run !== undefined && Object.hasOwn(p.runs, mode.run) ? p.runs[mode.run] : undefined
  const seen = mode && run ? firstErrorAt(model, run, mode) !== undefined : false

  const list = (title: string, group: Ranked[]) => group.length > 0 && (
    <Fragment key={title}>
      <Section icon={Info} title={title} count={group.length} />
      <ul className="failrows">
        {group.map(r => (
          <li key={r.id}>
            <button className="failrow" aria-current={r.id === modeId || undefined} onClick={() => p.onMode(r.id === modeId ? undefined : r.id)}>
              <span className={`sw ${r.band}`} aria-hidden="true" />
              <span className="visually-hidden">{BAND_NAMES[r.band]}.</span>
              <span className="what"><span className="part">{partName(model, r.mode)}</span><span>{r.mode.mode}</span></span>
              <span className="risk">{riskOf(r.mode) ?? ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </Fragment>
  )

  return (
    <div className="perf fail">
      {ids.length > 1
        ? <select aria-label="Analysis" value={analysisId} onChange={e => { p.onAnalysis(e.target.value); e.target.blur() }}>{ids.map(id => <option key={id} value={id}>{model.failures[id].name || id}</option>)}</select>
        : <h2>{analysis.name || analysisId}</h2>}
      {p.editing && analysisId !== undefined && <AnalysisForm model={model} id={analysisId} run={p.run} />}
      {p.editing && <details className="about"><summary>New analysis</summary><NewAnalysis model={model} run={p.run} onMade={p.onAnalysis} /></details>}
      {!p.editing && analysis.about && <details className="about"><summary>About</summary><p>{analysis.about}</p></details>}
      <div className="perf-buttons">
        <button onClick={() => p.onCopy('markdown')}><Copy size={16} />Copy as table</button>
        <button onClick={() => p.onCopy('csv')}><Copy size={16} />Copy as CSV</button>
      </div>

      <ul className="failsum">
        {BAND_ORDER.map(b => (
          <li key={b}>
            <button aria-pressed={filter.band === b} onClick={() => p.onFilter({ band: filter.band === b ? undefined : b })}>
              <span className={`sw ${b}`} aria-hidden="true" />{BAND_NAMES[b]}<span className="count">{counts[b]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="coverage">
        <span>Analysed {covered.analysed.length} of {total}</span>
        {covered.left.length > 0 && <button className="link" aria-pressed={filter.left === true} onClick={() => p.onFilter({ left: filter.left ? undefined : true })}>Not analysed ({covered.left.length})</button>}
      </p>
      {picked !== undefined && <span className="chip partchip">{picked}<button className="link" aria-label="Clear" onClick={p.onClearPart}><Close size={12} /></button></span>}

      {p.editing && analysisId !== undefined && (adding !== undefined
        ? <AddMode key={JSON.stringify(adding)} model={model} analysisId={analysisId} preset={adding} run={p.run} onAdded={id => { setAdding(undefined); p.onMode(id) }} onCancel={() => setAdding(undefined)} />
        : <button onClick={() => setAdding(presetOf(model, part))}><Plus size={16} />Add failure mode</button>)}

      {filter.left
        ? (
          <>
            <Section icon={Info} title="Not analysed" count={covered.left.length} />
            <ul className="failrows">
              {covered.left.map(id => (
                <li key={id}>
                  <button className="failrow" onClick={() => p.onPickShape(id)}><span className="what"><span>{partName(model, { on: id })}</span></span></button>
                  {p.editing && <button className="link" onClick={() => setAdding({ on: id })}>Add failure mode</button>}
                </li>
              ))}
            </ul>
          </>
        )
        : (
          <>
            {list('This view', rows.here)}
            {list('Other views', rows.elsewhere)}
            {listed === 0 && <p className="muted">{Object.keys(analysis.modes).length === 0 ? 'No failure modes yet.' : 'None here.'}</p>}
          </>
        )}

      {mode && p.editing && analysisId !== undefined && modeId !== undefined && (
        <>
          <Section icon={Alert} title={partName(model, mode)} />
          <ModeForm model={model} analysisId={analysisId} modeId={modeId} runs={p.runs} run={p.run} />
          <div className="perf-buttons">
            {flowShown && mode.flow !== undefined && <button onClick={() => p.onShowFlow(mode.flow!, mode.step === undefined ? undefined : Number(mode.step))}><Route size={16} />Show it</button>}
          </div>
        </>
      )}
      {mode && !p.editing && (
        <>
          <Section icon={Alert} title={partName(model, mode)} />
          <p className="modeline"><strong>{mode.mode}</strong></p>
          <dl className="faildl">
            {mode.effect && <><dt>Effect</dt><dd>{mode.effect}</dd></>}
            {mode.cause && <><dt>Cause</dt><dd>{mode.cause}</dd></>}
          </dl>
          {RATINGS.map(([key, label]) => {
            const value = ratingsOf(mode)[key]
            const scale = analysis.scale?.[key]
            return (
              <div className="rating" key={key}>
                <span className="label">{label}</span>
                <span className="cells" aria-hidden="true">{ratingCells(value).map((on, i) => <i key={i} className={on ? 'on' : undefined} />)}</span>
                <span className="value">{value ?? '–'}</span>
                {scale && (scale.low || scale.high) && <span className="ends muted"><span>1: {scale.low}</span><span>10: {scale.high}</span></span>}
              </div>
            )
          })}
          <p className="riskline">
            <span className="label">Risk</span> <strong>{riskOf(mode) ?? '–'}</strong> <span className={`sw ${bandOf(mode)}`} aria-hidden="true" />{BAND_NAMES[bandOf(mode)]}
            {afterText(mode) !== undefined && <span className="muted"> · After: {afterText(mode)}</span>}
          </p>
          <dl className="faildl">
            {mode.controls && <><dt>Controls</dt><dd>{mode.controls}</dd></>}
            {(mode.action || mode.owner || mode.status) && <><dt>Next action</dt><dd>{[mode.action, mode.owner && `${mode.owner}`, STATUS_NAMES[mode.status ?? 'open'] ?? mode.status].filter(Boolean).join(' · ')}</dd></>}
            {mode.affects && mode.affects.length > 0 && <><dt>Affects</dt><dd>{mode.affects.map(id => nameOf(model, id)).join(', ')}</dd></>}
          </dl>
          {mode.description && <div className="prose"><Description text={mode.description} /></div>}
          <div className="perf-buttons">
            {flowShown && mode.flow !== undefined && <button onClick={() => p.onShowFlow(mode.flow!, mode.step === undefined ? undefined : Number(mode.step))}><Route size={16} />Show it</button>}
            {seen && modeId !== undefined && <button onClick={() => p.onSeenInRun(modeId)}><Activity size={16} />Seen in a run</button>}
          </div>
        </>
      )}

      <span className="hint muted"><kbd>←</kbd><kbd>→</kbd>Step<kbd>Esc</kbd>Close</span>
      <Section icon={Info} title="Key" />
      <KeyRow>
        {BAND_ORDER.filter(b => counts[b] > 0).map(b => <KeyItem key={b} swatch={<span className={`sw ${b}`} />}>{BAND_NAMES[b]}</KeyItem>)}
        {lit && <KeyItem swatch={<span className="sw fails" />}>Fails</KeyItem>}
        {lit && lit.affects.length > 0 && <KeyItem swatch={<span className="sw affects" />}>Affects</KeyItem>}
      </KeyRow>
      {problemList}
    </div>
  )
}
