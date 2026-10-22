import { animationOf, outcomeLine } from '../../src/core/animation.ts'
import { LEGEND } from '../../src/core/captions.ts'
import type { Caption, Progress } from '../../src/core/captions.ts'
import type { Change } from '../../src/core/flowdiff.ts'
import type { Flow, Model } from '../../src/core/model.ts'
import type { GroupKind, Stop } from '../../src/core/structure.ts'
import { isView, nameOf, stepEnds } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { CHANGE_NAMES, changeOfStop } from './compare.ts'
import type { StateMark } from '../../src/core/states.ts'
import { Chip } from './Chrome.tsx'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, ArrowsSplit, Close, Columns, GitFork, Help, Pause, Play, Reload, Repeat, Route } from './icons.tsx'
import { StateKey } from './states.tsx'
import { usePref } from './store.ts'

/** The icon of a kind of group, in the chip, the bracket and the mark on the canvas. */
export const KIND_ICON = { repeat: Repeat, branch: GitFork, parallel: ArrowsSplit } as const satisfies Record<GroupKind, unknown>

type Place = [string, string] | null

/** Where the legend's open or closed is kept, so it is as last time. Storage may be blocked or empty: the legend then starts closed. */
const LEGEND_KEY = 'flowy.legend'

type Props = {
  model: Model
  flow: Flow
  stops: Stop[]
  /** The stop on show. */
  stop: number
  /** Where each step of the flow lands in the view (null where it can't be shown), by file step number. */
  ends: Place[]
  caption: Caption
  progress: Progress
  /** The shapes on the canvas that are in a state at this stop (see marksOf), for the key. */
  marks: Record<string, StateMark>
  auto: boolean
  moving: boolean
  /** Whether a step that moves plays again after a rest. */
  repeat: boolean
  /** The flow the reader came from and the step they left it at, when they opened this one from it. */
  trail?: { name: string; step: number }
  /** What differs from the other flow of a comparison, by file step number: the bar's cell for a step takes the mark's colour. */
  changes?: Record<number, Change>
  onStep: (stop: number) => void
  onAuto: () => void
  onReplay: () => void
  onRepeat: () => void
  /** Compare with another flow: `off` is why the button is greyed out, `picker` the popover `open` shows above the card. Without it there is no Compare button (a pane of a comparison has none). */
  compare?: { off?: string; open: boolean; onToggle: () => void; picker: ReactNode }
  /** Stop, open a linked flow and go back to the one it was opened from. A pane of a comparison has none of them: its Stop and Open flow are greyed out, as it never leaves its flow. */
  onStop?: () => void
  onOpenFlow?: (id: string) => void
  onBack?: () => void
}

const IN_A_PANE = 'Not while comparing'

/**
 * How far a flow has got: a cell for each stop, filled up to the stop shown. A group is boxed, with the line that says what it is at the
 * foot of the box, and a box with an `until` is dashed (it may stop before its last time). A branch's lanes are rows of their own, each
 * named, and the lanes the stop shown is not in are dashed, as they are on the canvas. In a comparison, a cell takes the colour of what
 * differs at its stop (`changes`, by file step number).
 */
function Bar({ progress, now, stops, changes }: { progress: Progress; now: number; stops: Stop[]; changes?: Record<number, Change> }) {
  const here = progress.cells.find(c => c.stop === now)
  const parts: ({ at: number; plain: true } | { at: number; plain: false; group: number })[] = []
  for (let col = 0; col < progress.cols;) {
    const group = progress.cells.find(c => c.col === col && c.row === 0 && c.group >= 0)?.group ?? -1
    if (group < 0) {
      parts.push({ at: col, plain: true })
      col++
    } else {
      parts.push({ at: col, plain: false, group })
      col = progress.brackets[group].to + 1
    }
  }
  const cell = (c: Progress['cells'][number], row: number) => {
    const off = here !== undefined && c.group >= 0 && c.group === here.group && progress.brackets[c.group].kind === 'branch' && c.row !== here.row
    const className = ['cell', c.stop <= now ? 'done' : '', off ? 'off' : ''].filter(Boolean).join(' ')
    const change = changes && changeOfStop(stops[c.stop]?.steps ?? [], changes)
    const title = [c.title, change && CHANGE_NAMES[change]].filter(Boolean).join(', ')
    return <span key={c.stop} title={title || undefined} data-change={change} className={className} style={{ gridColumn: c.col - (c.group >= 0 ? progress.brackets[c.group].from : c.col) + 1, gridRow: row }} />
  }
  return (
    <div className="progress">
      {parts.map(part => {
        if (part.plain) return <div key={part.at} className="stretch" style={{ flex: 1 }}>{progress.cells.filter(c => c.col === part.at && c.group < 0).map(c => cell(c, 1))}</div>
        const b = progress.brackets[part.group]
        const Icon = KIND_ICON[b.kind]
        const mine = progress.cells.filter(c => c.group === part.group)
        const branch = b.kind === 'branch'
        const rows = branch ? Math.max(b.lanes.length, ...mine.map(c => c.row + 1)) : 1
        return (
          <div key={part.at} className={`stretch grp ${b.kind}${b.maybe ? ' maybe' : ''}`} style={{ flex: b.to - b.from + 1 }} title={b.title}>
            <div className="runs" style={{ gridTemplateColumns: `repeat(${b.to - b.from + 1}, 1fr)`, gridTemplateRows: branch ? `repeat(${rows}, auto 4px)` : '4px' }}>
              {branch && Array.from({ length: rows }, (_, r) => (
                <div key={r} className={`lane${here?.group === part.group && here.row === r ? ' on' : ''}`} style={{ gridColumn: '1 / -1', gridRow: r * 2 + 1 }}>{b.lanes[r] ?? ''}</div>
              ))}
              {mine.map(c => cell(c, branch ? c.row * 2 + 2 : 1))}
            </div>
            <span className="bracket"><Icon size={11} />{b.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/** The flow player's card: where you are, the group you are in, what happens at this stop (one block a step), and the buttons. */
export function Player({ model, flow, stops, stop, ends, caption, progress, marks, auto, moving, repeat, trail, changes, compare, onStep, onAuto, onReplay, onRepeat, onStop, onOpenFlow, onBack }: Props) {
  const here = stops[stop]
  const [legendPref, setLegendPref] = usePref(LEGEND_KEY, 'closed')
  const legend = legendPref === 'open'
  const grouped = progress.brackets.length > 0 // the legend explains groups, so a flow with none has no button
  const toggleLegend = () => setLegendPref(legend ? 'closed' : 'open')
  const GroupIcon = here.kind === undefined ? undefined : KIND_ICON[here.kind]
  return (
    <section className="player" aria-live="polite">
      {trail && onBack && <button className="trail" onClick={onBack}><ArrowLeft size={14} />Back to “{trail.name}”, step {trail.step}</button>}
      <div className="chips">
        <Chip icon={Play}>{flow.name}</Chip>
        <Chip kind="accent">Step {stop + 1} of {stops.length}</Chip>
        {caption.chip !== '' && <Chip icon={GroupIcon}>{caption.chip}</Chip>}
        {compare && (
          <button className="compare-btn" data-compare-toggle aria-pressed={compare.open} disabled={compare.off !== undefined} title={compare.off ?? 'Compare with another flow (C)'} onClick={compare.onToggle}><Columns size={14} />Compare</button>
        )}
        {grouped && (
          <button className="help" aria-label="What do these mean?" title="What do these mean?" aria-pressed={legend} onClick={toggleLegend}><Help size={15} /></button>
        )}
      </div>
      {grouped && legend && (
        <dl className="legend">
          {LEGEND.map(row => {
            const Icon = row.kind === null ? undefined : KIND_ICON[row.kind]
            return (
              <div key={row.title}>
                <dt>{Icon && <Icon size={13} />}{row.title}</dt>
                <dd>{row.text}</dd>
              </div>
            )
          })}
        </dl>
      )}
      {caption.tabs.length > 0 && (
        <div className="tabs">{caption.tabs.map((t, i) => <span key={i} className={i === caption.tab ? 'tab on' : 'tab'}>{t}</span>)}</div>
      )}
      {caption.text !== '' && <p className="group-text">{caption.text}</p>}
      <Bar progress={progress} now={stop} stops={stops} changes={changes} />
      <StateKey marks={marks} />
      {here.steps.map((i, n) => {
        const step = flow.steps[i]
        const link = typeof step.flow === 'string' && step.flow.trim() !== '' ? step.flow.trim() : undefined
        const target = link !== undefined && Object.hasOwn(model.flows, link) ? model.flows[link] : undefined
        const animation = animationOf(step)
        const outcome = animation && outcomeLine(animation, id => nameOf(model, id))
        return (
          <div key={i} className={here.steps.length > 1 ? 'lane-block' : undefined}>
            {caption.lanes[n] && <p className="lane-name">{caption.lanes[n]}</p>}
            <p className="player-ends">{stepEnds(model, step, ends[i])}</p>
            <p>{step.text}</p>
            {outcome !== undefined && <p className="player-outcome">{outcome}</p>}
            {step.description && (
              <details key={`${stop}-${i}`} className="more">
                <summary>More</summary>
                <Description text={String(step.description)} />
              </details>
            )}
            {target && (
              <div className="player-buttons flow-link">
                <button disabled={onOpenFlow === undefined || target.steps.length === 0 || !isView(model, target.view)} title={onOpenFlow === undefined ? IN_A_PANE : undefined} onClick={() => onOpenFlow?.(link!)}><Route size={16} />Open flow: {target.name || link}</button>
              </div>
            )}
          </div>
        )
      })}
      <div className="player-buttons">
        <button disabled={stop === 0} onClick={() => onStep(stop - 1)}><ArrowLeft size={16} />Back</button>
        <button className="primary" disabled={stop === stops.length - 1} onClick={() => onStep(stop + 1)}><ArrowRight size={16} />Next</button>
        <button onClick={onAuto} title="Step through the flow on its own (P)">{auto ? <><Pause size={16} />Pause</> : <><Play size={16} />Autoplay</>}</button>
        {moving && <button aria-label="Replay this step" title="Replay this step (R)" onClick={onReplay}><Reload size={16} /></button>}
        {moving && <button aria-label="Repeat" aria-pressed={repeat} title={repeat ? 'Repeating: plays again after a rest' : 'Repeat: play again after a rest'} onClick={onRepeat}><Repeat size={16} /></button>}
        <button disabled={onStop === undefined} title={onStop === undefined ? 'Close the comparison to stop' : undefined} onClick={onStop}><Close size={16} />Stop</button>
      </div>
      {compare?.open && compare.picker}
    </section>
  )
}
