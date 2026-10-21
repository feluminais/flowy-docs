import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Problem } from '../../src/core/problem.ts'
import type { Model } from '../../src/core/model.ts'
import { eventText, knee, kneeText, sourceKey, traffic as trafficOf } from '../../src/core/perf.ts'
import type { Metrics, Run } from '../../src/core/perf.ts'
import { STATE_LABELS } from '../../src/core/states.ts'
import type { StateMark, StateName } from '../../src/core/states.ts'
import { nameOf } from '../../src/core/views.ts'
import { Section } from './Chrome.tsx'
import { Activity, Alert, Bolt, Clock, Info, Pause, Play } from './icons.tsx'
import {
  boxAt, boxSeries, BOX_KEYS, cursorX, eventFractions, eventRows, failureMarks, fmtLoad, gridOf, isTested, isTime, levelLabels, levelX, lineAt, lineSeries, LINE_KEYS, loadAt, METRICS, pathOf, posAt,
  scaleOf, slidePos, sliderRange, sliderValue, sourceCss, tickLabels, top,
} from './perfview.ts'
import type { Area } from './perfview.ts'
import { KeyItem, KeyRow } from './legend.tsx'
import { PlainSwatch, StateGlyph, StateKey, Swatch } from './states.tsx'

/** What the Performance tab's body is told: the runs, which is showing and where in it, and what is selected on the canvas. */
export type PerfProps = {
  model: Model
  /** The level the canvas shows, so a shape that holds others reads the way the canvas draws it. */
  view: string
  runs: Record<string, Run>
  runProblems: Problem[]
  runId: string
  /** A position along the run's tested levels (see loadAt): a whole number is a tested level. */
  pos: number
  ramping: boolean
  /** Reduced motion: no ramp, only the levels to step through. */
  still: boolean
  /** The states on the canvas now, for the key and for the state of the selected shape. */
  states: Record<string, StateMark>
  selection?: { kind: 'object'; id: string } | { kind: 'line'; from: string; to: string }
  onRun: (id: string) => void
  /** Go to a tested level, with the states moving to it. */
  onPos: (pos: number) => void
  /** The slider is being dragged to a position: the states follow at once. */
  onSlide: (pos: number) => void
  /** Go to a position, with the states moving to it (a click on an event). */
  onJump: (pos: number) => void
  onRamp: () => void
}

/** Latency against load, one point for each tested level: the expected call and the slowest 5%, a cursor at where the slider is, and a mark where it first struggles. */
function Strip({ run, pos, kneeAt }: { run: Run; pos: number; kneeAt?: number }) {
  const timed = isTime(run)
  const p50 = run.levels.map(l => l.overall.p50)
  const p95 = run.levels.map(l => l.overall.p95)
  const scale = scaleOf([...p50, ...p95], { log: true })
  if (p50.every(v => v === undefined) && p95.every(v => v === undefined)) return null
  const box: Area = { x: 44, y: 8, width: 266, height: 84 }
  return (
    <figure className="stripfig">
    <svg className="strip" viewBox="0 0 320 120" role="img" aria-label={`Expected call and slowest 5% at each tested ${timed ? 'time' : 'load'}`}>
      {gridOf(scale, box).map(g => (
        <g key={g.label}>
          <line x1={box.x} x2={box.x + box.width} y1={g.y} y2={g.y} className="grid" />
          <text x={box.x - 6} y={g.y} className="axis" textAnchor="end" dominantBaseline="central">{g.label}</text>
        </g>
      ))}
      {levelLabels(run, box).map(l => <text key={l.x} x={l.x} y={108} className="axis" textAnchor="middle">{l.label}</text>)}
      {kneeAt !== undefined && <line x1={levelX(run, box, kneeAt)} x2={levelX(run, box, kneeAt)} y1={box.y} y2={box.y + box.height} className="knee" />}
      <path d={pathOf(p95, scale, box, run)} className="p95" />
      <path d={pathOf(p50, scale, box, run)} className="p50" />
      <line x1={cursorX(run, box, pos)} x2={cursorX(run, box, pos)} y1={box.y} y2={box.y + box.height} className="cursor" />
    </svg>
    <figcaption>
      <KeyRow>
        <KeyItem swatch={<span className="sw p50" />}>Expected call</KeyItem>
        <KeyItem swatch={<span className="sw p95" />}>Slowest 5%</KeyItem>
        {kneeAt !== undefined && <KeyItem swatch={<span className="sw knee" />}>First struggles</KeyItem>}
      </KeyRow>
    </figcaption>
    </figure>
  )
}

/** The state an event leaves a shape in, drawn as the canvas draws it (a plain outline for Running), and named for those who don't see it. */
function EventSwatch({ state }: { state: StateName }) {
  return (
    <span className="swatch" role="img" aria-label={STATE_LABELS[state]} title={STATE_LABELS[state]}>
      <span aria-hidden="true">{state === 'running' ? <PlainSwatch /> : <Swatch mark={{ state, inside: false }} />}</span>
    </span>
  )
}

/** The mark for a line that is scaled down to fit the screen: dots that thin out. */
const Scaled = () => <span className="sw scaled"><i /><i /><i /></span>

/** One number of the selected shape or line: its name, what it is at this load, and its curve across the tested levels with a cursor. */
function Reading({ run, metric, at, series, pos }: { run: Run; metric: keyof Metrics; at?: number; series: (number | undefined)[]; pos: number }) {
  const m = METRICS[metric]
  const scale = scaleOf(series, m.log ? { log: true } : { from: 0, ...(m.max === undefined ? {} : { to: m.max }) })
  const box: Area = { x: 3, y: 3, width: 114, height: 22 }
  return (
    <div className="reading">
      <span className="label">{m.label}</span>
      <span className="value">{at === undefined ? '–' : m.show(at)}</span>
      <svg viewBox="0 0 120 28" aria-hidden="true">
        <path d={pathOf(series, scale, box, run)} />
        <line x1={cursorX(run, box, pos)} x2={cursorX(run, box, pos)} y1={0} y2={28} className="cursor" />
      </svg>
    </div>
  )
}

/** The Performance tab's body: which run and where in it, what it says about where things first struggle, and the numbers of what is selected. */
export function PerfBody({ model, view, runs, runProblems, runId, pos, ramping, still, states, selection, onRun, onPos, onSlide, onJump, onRamp }: PerfProps) {
  const run: Run | undefined = Object.hasOwn(runs, runId) ? runs[runId] : undefined
  const struggle = useMemo(() => (run ? knee(run) : undefined), [run])
  // The lines the canvas draws traffic on at this position, which the key and the selected line's readout are told by. Reduced motion draws none.
  const drawn = useMemo(() => (run && !still ? trafficOf(model, run, loadAt(run, pos), view).lines : []), [model, run, pos, view, still])
  const ids = Object.keys(runs)
  const problems = (
    runProblems.length > 0 && (
      <>
        <Section icon={Alert} title="Problems" count={runProblems.length} />
        <ul className="plain">{runProblems.map((p, i) => <li key={i}><span className="muted">{p.file}</span> {p.message}</li>)}</ul>
      </>
    )
  )
  if (!run) return <div className="perf"><p className="muted">No run could be read.</p>{problems}</div>

  const load = loadAt(run, pos)
  const lower = run.levels[Math.min(top(run) - 1, Math.floor(pos))]
  const upper = run.levels[Math.min(top(run), Math.floor(pos) + 1)]
  const timed = isTime(run)
  const range = sliderRange(run)
  const events = eventFractions(run)
  const rows = eventRows(run, load)

  let selected: { title: string; keys: readonly (keyof Metrics)[]; at: Metrics | undefined; series: (key: keyof Metrics) => (number | undefined)[] } | undefined
  if (selection?.kind === 'object') {
    const id = selection.id
    selected = { title: nameOf(model, id), keys: BOX_KEYS, at: boxAt(model, run, view, id, load), series: key => boxSeries(model, run, view, id, key) }
  } else if (selection?.kind === 'line') {
    const { from, to } = selection
    selected = { title: `${nameOf(model, from)} → ${nameOf(model, to)}`, keys: LINE_KEYS, at: lineAt(model, run, view, from, to, load), series: key => lineSeries(model, run, view, from, to, key) }
  }
  const chosen = selection?.kind === 'object' && Object.hasOwn(states, selection.id) && !states[selection.id].inside ? states[selection.id] : undefined
  const shown = selected?.keys.filter(key => selected.series(key).some(v => v !== undefined)) ?? []
  const source = sourceKey(run, drawn)
  const marks = failureMarks(drawn)
  const scaledLine = selection?.kind === 'line' && drawn.some(l => l.from === selection.from && l.to === selection.to && l.capped)
  // The source's colour for the dots drawn in the key, in both themes.
  const dots = source?.color === undefined ? undefined : ({ '--src': sourceCss(source.color) } as CSSProperties)

  return (
    <div className="perf">
      {ids.length > 1
        ? <select aria-label="Run" value={runId} onChange={e => { onRun(e.target.value); e.target.blur() }}>{ids.map(id => <option key={id} value={id}>{runs[id].name}</option>)}</select>
        : <h2>{run.name}</h2>}
      {run.about && <details className="about"><summary>About this run</summary><p>{run.about}</p></details>}

      <Section icon={timed ? Clock : Activity} title={timed ? 'Time' : 'Load'} />
      <div className="loadnum">
        <strong>{fmtLoad(load, run.unit)}</strong>
        <span className="muted">{isTested(pos) ? 'Tested' : `Between ${lower.load} and ${upper.load}, estimated`}</span>
      </div>
      <div className={timed ? 'slide timed' : 'slide'}>
        {events.length > 0 && (
          <div className="event-marks">
            {events.map(({ fraction, event }, i) => (
              <button key={i} type="button" tabIndex={-1} aria-hidden="true" className={`event-mark state-${event.state}${event.at <= load ? ' passed' : ''}`}
                style={{ left: `${fraction * 100}%` }} title={`${fmtLoad(event.at, run.unit)}: ${eventText(event, id => nameOf(model, id))}`} onClick={() => onJump(posAt(run, event.at))} />
            ))}
          </div>
        )}
        <input type="range" min={range.min} max={range.max} step="any" value={sliderValue(run, pos)} aria-label={timed ? 'Time' : 'Load'} aria-valuetext={fmtLoad(load, run.unit)}
          onChange={e => onSlide(slidePos(run, Number(e.target.value)))} />
        <div className="ticks" aria-hidden="true">
          {tickLabels(run).map(t => <span key={t.label} style={{ left: `${t.fraction * 100}%` }}>{t.label}</span>)}
        </div>
      </div>
      <div className="perf-buttons">
        {!still && <button className="primary" aria-pressed={ramping} onClick={onRamp}>{ramping ? <><Pause size={16} />Pause</> : <><Play size={16} />{timed ? 'Play' : 'Ramp'}</>}</button>}
        <span className="hint muted"><kbd>←</kbd><kbd>→</kbd>Step{!still && <><kbd>P</kbd>{timed ? 'Play' : 'Ramp'}</>}</span>
      </div>

      {rows.length > 0 && (
        <>
          <Section icon={Bolt} title="Events" />
          <ul className="events">
            {rows.map(({ event, passed, current }, i) => (
              <li key={i}>
                <button type="button" className={`event${passed ? ' passed' : ''}`} aria-current={current ? 'true' : undefined} onClick={() => onJump(posAt(run, event.at))}>
                  <span className="when">{fmtLoad(event.at, run.unit)}</span>
                  <EventSwatch state={event.state} />
                  <span className="what">{eventText(event, id => nameOf(model, id))}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <Section icon={Alert} title="Where it struggles" />
      {struggle
        ? <p>{kneeText(run, struggle, id => nameOf(model, id))} <button className="link" onClick={() => onPos(struggle.index)}>Go there</button></p>
        : <p className="muted">It never struggled in the tested range.</p>}
      <Strip run={run} pos={pos} kneeAt={struggle?.index} />

      <Section icon={Info} title={selected ? selected.title : 'Selected'} />
      {selected === undefined && <p className="muted">Click a shape or a line.</p>}
      {selected && shown.length === 0 && <p className="muted">Nothing measured here{selection?.kind === 'object' ? ' or inside it' : ''}.</p>}
      {selected && shown.map(key => <Reading key={key} run={run} metric={key} at={selected.at?.[key]} series={selected.series(key)} pos={pos} />)}
      {chosen && <p className="stateline"><StateGlyph mark={chosen} />{STATE_LABELS[chosen.state]}</p>}
      {scaledLine && <KeyRow style={dots}><KeyItem swatch={<Scaled />}>Scaled down</KeyItem></KeyRow>}

      <Section icon={Info} title="Key" />
      <KeyRow style={dots}>
        <KeyItem swatch={<span className="sw heat" />}>Busy</KeyItem>
        <KeyItem swatch={<span className="sw queue">3</span>}>Waiting</KeyItem>
        <KeyItem swatch={<span className="sw none" />}>Not measured</KeyItem>
        <KeyItem swatch={<span className="sw call" />}>A call (slower dots, slower calls)</KeyItem>
        {marks.fade && <KeyItem swatch={<span className="sw call bad" />}>A call that fails</KeyItem>}
        {marks.lost && <KeyItem swatch={<span className="sw lost" />}>Lost call</KeyItem>}
        {marks.rejected && <KeyItem swatch={<span className="sw rejected" />}>Rejected call</KeyItem>}
        <KeyItem swatch={<span className="sw busy" />}>More calls</KeyItem>
        {source && (
          <>
            {source.scale && <KeyItem swatch={<span className="sw call" />}>{source.scale}</KeyItem>}
            {source.bigger && <KeyItem swatch={<span className="sw bigger"><i /><i /></span>}>Bigger call</KeyItem>}
            {source.scaledDown && <KeyItem swatch={<Scaled />}>Scaled down</KeyItem>}
          </>
        )}
      </KeyRow>
      <StateKey marks={states} />
      {problems}
    </div>
  )
}
