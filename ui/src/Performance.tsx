import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { Problem } from '../../src/core/problem.ts'
import type { Model } from '../../src/core/model.ts'
import { kneeOf } from '../../src/core/perf/analyse.ts'
import { dialsOf, loadOfPosition } from '../../src/core/perf/dials.ts'
import { levelAt } from '../../src/core/perf/levels.ts'
import { eventText, kneeTextOf, sourceKeyAt } from '../../src/core/perf/text.ts'
import { OTHER_COLOR } from '../../src/core/perf/traffic.ts'
import type { Dial, Level, LineTraffic, Metrics, Run } from '../../src/core/perf/types.ts'
import { STATE_LABELS } from '../../src/core/states.ts'
import type { StateMark, StateName } from '../../src/core/states.ts'
import { nameOf } from '../../src/core/views.ts'
import { Section } from './Chrome.tsx'
import { Activity, Alert, Bolt, ChevronRight, Clock, Info, Pause, Play, Plus } from './icons.tsx'
import {
  ABOUT_FOLDS_OVER, activeSeries, boxAt, boxAtLevel, boxSeries, boxSeriesIn, BOX_KEYS, bracketOf, cursorX, dialTicks, dialTop, eventFractions, eventRows, failureMarks, fmtLoad, gridOf, heldText, isTested, isTime, levelLabels, levelX,
  lineAt, lineAtLevel, lineSeries, lineSeriesIn, LINE_KEYS, loadAt, METRICS, modeLabel, openingPositions, overText, pathOf, posAt, scaleOf, settingOf, slideDial, slidePos, sliderRange, sliderValue, sourceCss, tickLabels, top, xAt,
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
  /** A position along the tested loads of each dial of the run, in dial order (see dialsOf and loadOfPosition): a whole number is a tested load. A run with one source has one. */
  positions: number[]
  /** The dial the arrow keys and Ramp act on, and the Strip and the curves follow (the one that was moved last). */
  active: number
  /** The lines the canvas draws traffic on now (none with reduced motion), which the key and the selected line's readout are told by, so the tab makes no traffic of its own. */
  lines: LineTraffic[]
  ramping: boolean
  /** Reduced motion: no ramp, only the levels to step through. */
  still: boolean
  /** The states on the canvas now, for the key and for the state of the selected shape. */
  states: Record<string, StateMark>
  selection?: { kind: 'object'; id: string } | { kind: 'line'; from: string; to: string }
  onRun: (id: string) => void
  /** A dial was moved or clicked: the keys act on it from now on. */
  onActive: (dial: number) => void
  /** The slider of a dial is being dragged to a position: the states follow at once. */
  onSlide: (dial: number, pos: number) => void
  /** Go to a position of a single run, with the states moving to it (a click on an event). */
  onJump: (pos: number) => void
  /** Go to a place with every dial at its position (Go there), with the states moving to it. */
  onPlace: (positions: number[]) => void
  /** Ramp the dial, or stop the ramp that is running on it. */
  onRamp: (dial: number) => void
  /** Where there is a folder to put a run in: makes the start of one. */
  onCreate?: () => void
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

/**
 * The same chart along one dial of a run with several sources, the others held where they stand: one point for each tested load of the dial. It has no mark for where the run first
 * struggles, because that is a step of every dial together and rarely lies on this line.
 */
function StripAlong({ levels, dial, pos }: { levels: Level[]; dial: Dial; pos: number }) {
  const p50 = levels.map(l => l.overall.p50)
  const p95 = levels.map(l => l.overall.p95)
  const scale = scaleOf([...p50, ...p95], { log: true })
  if (p50.every(v => v === undefined) && p95.every(v => v === undefined)) return null
  const box: Area = { x: 44, y: 8, width: 266, height: 84 }
  const x = xAt(box, pos, levels.length)
  return (
    <figure className="stripfig">
      <svg className="strip" viewBox="0 0 320 120" role="img" aria-label={`Expected call and slowest 5% at each tested load of ${dial.name}`}>
        {gridOf(scale, box).map(g => (
          <g key={g.label}>
            <line x1={box.x} x2={box.x + box.width} y1={g.y} y2={g.y} className="grid" />
            <text x={box.x - 6} y={g.y} className="axis" textAnchor="end" dominantBaseline="central">{g.label}</text>
          </g>
        ))}
        {dialTicks(dial).map(t => <text key={t.label} x={box.x + box.width * t.fraction} y={108} className="axis" textAnchor="middle">{t.label}</text>)}
        <path d={pathOf(p95, scale, box)} className="p95" />
        <path d={pathOf(p50, scale, box)} className="p50" />
        <line x1={x} x2={x} y1={box.y} y2={box.y + box.height} className="cursor" />
      </svg>
      <figcaption>
        <KeyRow>
          <KeyItem swatch={<span className="sw p50" />}>Expected call</KeyItem>
          <KeyItem swatch={<span className="sw p95" />}>Slowest 5%</KeyItem>
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

/** A source's colour as the `--src` the dots in the key are drawn in, in both themes. */
const srcStyle = (color: string | undefined): CSSProperties | undefined => (color === undefined ? undefined : ({ '--src': sourceCss(color) } as CSSProperties))

/**
 * One number of the selected shape or line: its name, what it is at this load, and its curve across the tested levels with a cursor. `run` is the single run the
 * curve is for (a run over time has its points at their times); a run with several sources draws along one dial, `count` levels of it, evenly.
 */
function Reading({ run, count, metric, at, series, pos }: { run?: Run; count: number; metric: keyof Metrics; at?: number; series: (number | undefined)[]; pos: number }) {
  const m = METRICS[metric]
  const scale = scaleOf(series, m.log ? { log: true } : { from: 0, ...(m.max === undefined ? {} : { to: m.max }) })
  const box: Area = { x: 3, y: 3, width: 114, height: 22 }
  const x = run ? cursorX(run, box, pos) : xAt(box, pos, count)
  return (
    <div className="reading">
      <span className="label">{m.label}</span>
      <span className="value">{at === undefined ? '–' : m.show(at)}</span>
      <svg viewBox="0 0 120 28" aria-hidden="true">
        <path d={pathOf(series, scale, box, run)} />
        <line x1={x} x2={x} y1={0} y2={28} className="cursor" />
      </svg>
    </div>
  )
}

/** Which dial the Strip and the curves follow, and which are held where they stand: "Customer orders" with "Courier pings held at 100 pings/s" beside it. Only for runs with several sources. */
function Along({ dials, positions, active }: { dials: readonly Dial[]; positions: number[]; active: number }) {
  const held = heldText(dials, positions, active)
  return (
    <p className="along">
      <span className="sw call" style={srcStyle(dials[active].color)} aria-hidden="true" />
      <strong>{dials[active].name}</strong>
      {held.length > 0 && <span className="muted">{held.join(', ')}</span>}
    </p>
  )
}

/** The Performance tab's body: which run and where in it, what it says about where things first struggle, and the numbers of what is selected. */
export function PerfBody({ model, view, runs, runProblems, runId, positions, active, lines, ramping, still, states, selection, onRun, onActive, onSlide, onJump, onPlace, onRamp, onCreate }: PerfProps) {
  const run: Run | undefined = Object.hasOwn(runs, runId) ? runs[runId] : undefined
  const found = useMemo(() => dialsOf(runs, runId), [runs, runId])
  const struggle = useMemo(() => (found ? kneeOf(runs, runId) : undefined), [runs, runId, found])
  const dials = found?.dials ?? []
  const multi = found !== undefined && found.mode !== 'single'
  const dial = Math.min(Math.max(0, active), Math.max(0, dials.length - 1))
  // A run with several sources: the numbers at the setting of its dials, and the level at each tested load of the active dial with the others held (what the Strip and the curves plot).
  const positionKey = positions.join(',')
  const along = useMemo(() => (multi ? activeSeries(runs, runId, dials, positions, dial) : undefined), [multi, runs, runId, found, positionKey, dial])
  const ids = Object.keys(runs)
  const problems = (
    runProblems.length > 0 && (
      <>
        <Section icon={Alert} title="Problems" count={runProblems.length} />
        <ul className="plain">{runProblems.map((p, i) => <li key={i}><span className="muted">{p.file}</span> {p.message}</li>)}</ul>
      </>
    )
  )
  if (ids.length === 0 && runProblems.length === 0) {
    return (
      <div className="perf">
        <p className="muted">No load-test runs yet. A run holds what each shape and connection measured at each tested load, and this panel replays it on the diagram.</p>
        {onCreate && <div className="perf-buttons"><button className="primary" onClick={onCreate}><Plus size={16} />Create</button></div>}
        {onCreate && <p className="muted">Copies a starter run for this view to fill in and save in <code>flowy/perf/</code>.</p>}
      </div>
    )
  }
  if (!run || !found) return <div className="perf"><p className="muted">No run could be read.</p>{problems}</div>

  // A run of one source: its load, the levels either side of it, its slider and its events. A run with several has none of these of its own (an adder has no levels at all).
  const pos = positions[0] ?? 0
  const load = multi ? 0 : loadAt(run, pos)
  const lower = multi ? undefined : run.levels[Math.min(top(run) - 1, Math.floor(pos))]
  const upper = multi ? undefined : run.levels[Math.min(top(run), Math.floor(pos) + 1)]
  const timed = !multi && isTime(run)
  const range = multi ? { min: 0, max: 0 } : sliderRange(run)
  const events = multi ? [] : eventFractions(run)
  const rows = multi ? [] : eventRows(run, load)
  const level = multi ? levelAt(runs, runId, settingOf(dials, positions)) : undefined

  let selected: { title: string; keys: readonly (keyof Metrics)[]; at: Metrics | undefined; series: (key: keyof Metrics) => (number | undefined)[] } | undefined
  if (selection?.kind === 'object') {
    const id = selection.id
    selected = multi
      ? { title: nameOf(model, id), keys: BOX_KEYS, at: boxAtLevel(model, level!, view, id), series: key => boxSeriesIn(model, along!, view, id, key) }
      : { title: nameOf(model, id), keys: BOX_KEYS, at: boxAt(model, run, view, id, load), series: key => boxSeries(model, run, view, id, key) }
  } else if (selection?.kind === 'line') {
    const { from, to } = selection
    selected = multi
      ? { title: `${nameOf(model, from)} → ${nameOf(model, to)}`, keys: LINE_KEYS, at: lineAtLevel(model, level!, view, from, to), series: key => lineSeriesIn(model, along!, view, from, to, key) }
      : { title: `${nameOf(model, from)} → ${nameOf(model, to)}`, keys: LINE_KEYS, at: lineAt(model, run, view, from, to, load), series: key => lineSeries(model, run, view, from, to, key) }
  }
  const chosen = selection?.kind === 'object' && Object.hasOwn(states, selection.id) && !states[selection.id].inside ? states[selection.id] : undefined
  const shown = selected?.keys.filter(key => selected.series(key).some(v => v !== undefined)) ?? []
  const keyed = sourceKeyAt(runs, runId, lines)
  const marks = failureMarks(lines)
  const scaledLine = selection?.kind === 'line' && lines.some(l => l.from === selection.from && l.to === selection.to && l.capped)
  // The source's colour for the dots drawn in the key, in both themes. A run with several sources draws each in its own, and the dots that stand for any call are neutral.
  const one = keyed.sources[0]
  const dots = multi ? srcStyle('gray') : srcStyle(one?.color)
  const label = modeLabel(found.mode)
  const over = selection?.kind === 'object' && selected ? overText(found.mode, selected.at?.util) : undefined

  return (
    <div className="perf">
      {ids.length > 1
        ? <select aria-label="Run" value={runId} onChange={e => { onRun(e.target.value); e.target.blur() }}>{ids.map(id => <option key={id} value={id}>{runs[id].name}</option>)}</select>
        : <h2>{run.name}</h2>}
      {run.about && (run.about.length > ABOUT_FOLDS_OVER
        ? <details className="about"><summary><ChevronRight size={14} />About this run</summary><p>{run.about}</p></details>
        : <p className="about">{run.about}</p>)}
      {label !== undefined && <p className="modelabel">{label}</p>}

      <Section icon={timed ? Clock : Activity} title={timed ? 'Time' : 'Load'} />
      {multi
        ? dials.map((d, i) => {
            const at = positions[i] ?? 0
            const dialLoad = loadOfPosition(d.values, at)
            const { lower: from, upper: to, tested } = bracketOf(d, at)
            const here = i === dial
            const running = ramping && here
            return (
              <div key={d.id} className={here ? 'dial active' : 'dial'} style={srcStyle(d.color)}>
                <div className="dialname"><span className="sw call" aria-hidden="true" /><span>{d.name}</span></div>
                <div className="loadnum">
                  <strong>{fmtLoad(dialLoad, d.unit)}</strong>
                  <span className="muted">{tested ? 'Tested' : `Between ${from} and ${to}, estimated`}</span>
                </div>
                <div className="slide">
                  <input type="range" min={0} max={dialTop(d)} step="any" value={at} aria-label={d.name} aria-valuetext={fmtLoad(dialLoad, d.unit)}
                    onFocus={() => onActive(i)} onPointerDown={() => onActive(i)} onChange={e => onSlide(i, slideDial(d, Number(e.target.value)))} />
                  <div className="ticks" aria-hidden="true">
                    {dialTicks(d).map(t => <span key={t.label} style={{ left: `${t.fraction * 100}%` }}>{t.label}</span>)}
                  </div>
                </div>
                {!still && <button className="primary small" aria-pressed={running} aria-label={`${running ? 'Pause' : 'Ramp'} ${d.name}`} onClick={() => onRamp(i)}>{running ? <><Pause size={16} />Pause</> : <><Play size={16} />Ramp</>}</button>}
              </div>
            )
          })
        : (
          <>
            <div className="loadnum">
              <strong>{fmtLoad(load, run.unit)}</strong>
              <span className="muted">{isTested(pos) || !lower || !upper ? 'Tested' : `Between ${lower.load} and ${upper.load}, estimated`}</span>
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
                onChange={e => onSlide(0, slidePos(run, Number(e.target.value)))} />
              <div className="ticks" aria-hidden="true">
                {tickLabels(run).map(t => <span key={t.label} style={{ left: `${t.fraction * 100}%` }}>{t.label}</span>)}
              </div>
            </div>
          </>
        )}
      <div className="perf-buttons">
        {!multi && !still && <button className="primary" aria-pressed={ramping} onClick={() => onRamp(0)}>{ramping ? <><Pause size={16} />Pause</> : <><Play size={16} />{timed ? 'Play' : 'Ramp'}</>}</button>}
        <span className="hint muted"><kbd>←</kbd><kbd>→</kbd>Step{!still && <><kbd>P</kbd>{timed ? 'Play' : 'Ramp'}</>}</span>
      </div>

      {rows.length > 0 && !multi && (
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
        ? <p>{kneeTextOf(runs, runId, struggle, id => nameOf(model, id))} <button className="link" onClick={() => onPlace(openingPositions(dials, struggle))}>Go there</button></p>
        : <p className="muted">It never struggled in the tested range.</p>}
      {multi ? <Along dials={dials} positions={positions} active={dial} /> : null}
      {multi ? <StripAlong levels={along!} dial={dials[dial]} pos={positions[dial] ?? 0} /> : <Strip run={run} pos={pos} kneeAt={struggle?.index} />}

      <Section icon={Info} title={selected ? selected.title : 'Selected'} />
      {selected === undefined && <p className="muted">Click a shape or a line.</p>}
      {selected && shown.length === 0 && <p className="muted">Nothing measured here{selection?.kind === 'object' ? ' or inside it' : ''}.</p>}
      {selected && shown.length > 0 && multi && <Along dials={dials} positions={positions} active={dial} />}
      {selected && shown.map(key => (
        <Reading key={key} run={multi ? undefined : run} count={multi ? dials[dial].values.length : run.levels.length} metric={key} at={selected.at?.[key]} series={selected.series(key)} pos={multi ? positions[dial] ?? 0 : pos} />
      ))}
      {over && <p className="over">{over}</p>}
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
        {multi
          ? (
            <>
              {keyed.sources.flatMap(s => [
                <KeyItem key={s.id} swatch={<span className="sw call" />} style={srcStyle(s.color)}>{s.name}</KeyItem>,
                s.scale && <KeyItem key={`${s.id} scale`} swatch={<span className="sw call" />} style={srcStyle(s.color)}>{s.scale}</KeyItem>,
                s.bigger && <KeyItem key={`${s.id} bigger`} swatch={<span className="sw bigger"><i /><i /></span>} style={srcStyle(s.color)}>Bigger call</KeyItem>,
              ])}
              {keyed.other && <KeyItem swatch={<span className="sw call" />} style={srcStyle(OTHER_COLOR)}>Other calls</KeyItem>}
              {keyed.scaledDown && <KeyItem swatch={<Scaled />}>Scaled down</KeyItem>}
            </>
          )
          : one && (
            <>
              {one.scale && <KeyItem swatch={<span className="sw call" />}>{one.scale}</KeyItem>}
              {one.bigger && <KeyItem swatch={<span className="sw bigger"><i /><i /></span>}>Bigger call</KeyItem>}
              {keyed.scaledDown && <KeyItem swatch={<Scaled />}>Scaled down</KeyItem>}
            </>
          )}
      </KeyRow>
      <StateKey marks={states} />
      {problems}
    </div>
  )
}
