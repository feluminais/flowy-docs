import { useState } from 'react'
import { animationOf, outcomeLine } from '../../src/core/animation.ts'
import { LEGEND } from '../../src/core/captions.ts'
import type { Caption, Progress } from '../../src/core/captions.ts'
import type { Flow, Model } from '../../src/core/model.ts'
import type { GroupKind, Stop } from '../../src/core/structure.ts'
import { isView, nameOf, stepEnds } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import type { StateMark } from '../../src/core/states.ts'
import { Chip } from './Chrome.tsx'
import { ArrowLeft, ArrowRight, ArrowsSplit, Close, GitFork, Help, Pause, Play, Reload, Repeat, Route } from './icons.tsx'
import { StateKey } from './states.tsx'
import { store } from './store.ts'

/** The icon of a kind of group, in the chip, the bracket and the mark on the canvas. */
export const KIND_ICON = { repeat: Repeat, branch: GitFork, parallel: ArrowsSplit } as const satisfies Record<GroupKind, unknown>

type Place = [string, string] | null

const LEGEND_KEY = 'flowy.legend'
/** Whether the legend was left open, from last time. Storage may be blocked or empty: the legend then starts closed. */
function legendWasOpen(): boolean {
  try {
    return store.get(LEGEND_KEY) === 'open'
  } catch {
    return false
  }
}

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
  onStep: (stop: number) => void
  onAuto: () => void
  onReplay: () => void
  onRepeat: () => void
  onStop: () => void
  onOpenFlow: (id: string) => void
  onBack: () => void
}

/** How far a flow has got: a cell a stop, a branch's lanes on rows of their own, and a bracket under each group. */
function Bar({ progress, now }: { progress: Progress; now: number }) {
  const columns = `repeat(${progress.cols}, 1fr)`
  return (
    <div>
      <div className="progress" style={{ gridTemplateColumns: columns, gridTemplateRows: `repeat(${progress.rows}, 4px)` }}>
        {progress.cells.map(c => <span key={c.stop} title={c.title || undefined} className={c.stop <= now ? 'done' : undefined} style={{ gridColumn: c.col + 1, gridRow: c.row + 1 }} />)}
      </div>
      {progress.brackets.length > 0 && (
        <div className="brackets" style={{ gridTemplateColumns: columns }}>
          {progress.brackets.map((b, i) => {
            const Icon = KIND_ICON[b.kind]
            return <span key={i} title={b.title} className={`bracket ${b.kind}`} style={{ gridColumn: `${b.from + 1} / ${b.to + 2}` }}><Icon size={11} />{b.text}</span>
          })}
        </div>
      )}
    </div>
  )
}

/** The flow player's card: where you are, the group you are in, what happens at this stop (one block a step), and the buttons. */
export function Player({ model, flow, stops, stop, ends, caption, progress, marks, auto, moving, repeat, trail, onStep, onAuto, onReplay, onRepeat, onStop, onOpenFlow, onBack }: Props) {
  const here = stops[stop]
  const [legend, setLegend] = useState(legendWasOpen)
  const grouped = progress.brackets.length > 0 // the legend explains groups, so a flow with none has no button
  const toggleLegend = () => {
    setLegend(open => {
      try {
        store.set(LEGEND_KEY, open ? 'closed' : 'open')
      } catch {
        // not remembered: it still opens and closes
      }
      return !open
    })
  }
  const GroupIcon = here.kind === undefined ? undefined : KIND_ICON[here.kind]
  return (
    <section className="player" aria-live="polite">
      {trail && <button className="trail" onClick={onBack}><ArrowLeft size={14} />Back to “{trail.name}”, step {trail.step}</button>}
      <div className="chips">
        <Chip icon={Play}>{flow.name}</Chip>
        <Chip kind="accent">Step {stop + 1} of {stops.length}</Chip>
        {caption.chip !== '' && <Chip icon={GroupIcon}>{caption.chip}</Chip>}
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
      <Bar progress={progress} now={stop} />
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
                <button disabled={target.steps.length === 0 || !isView(model, target.view)} onClick={() => onOpenFlow(link!)}><Route size={16} />Open flow: {target.name || link}</button>
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
        <button onClick={onStop}><Close size={16} />Stop</button>
      </div>
    </section>
  )
}
