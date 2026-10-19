import type { Caption, Progress } from '../../src/core/captions.ts'
import type { Flow, Model } from '../../src/core/model.ts'
import type { GroupKind, Stop } from '../../src/core/structure.ts'
import { stepEnds } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { Chip } from './Chrome.tsx'
import { ArrowLeft, ArrowRight, ArrowsSplit, Close, GitFork, Pause, Play, Reload, Repeat, Route } from './icons.tsx'

/** The icon of a kind of group, in the chip, the bracket and the mark on the canvas. */
export const KIND_ICON = { repeat: Repeat, branch: GitFork, parallel: ArrowsSplit } as const satisfies Record<GroupKind, unknown>

type Place = [string, string] | null

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
  auto: boolean
  moving: boolean
  /** The flow the reader came from and the step they left it at, when they opened this one from it. */
  trail?: { name: string; step: number }
  onStep: (stop: number) => void
  onAuto: () => void
  onReplay: () => void
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
export function Player({ model, flow, stops, stop, ends, caption, progress, auto, moving, trail, onStep, onAuto, onReplay, onStop, onOpenFlow, onBack }: Props) {
  const here = stops[stop]
  const GroupIcon = here.kind === undefined ? undefined : KIND_ICON[here.kind]
  return (
    <section className="player" aria-live="polite">
      {trail && <button className="trail" onClick={onBack}><ArrowLeft size={14} />Back to “{trail.name}”, step {trail.step}</button>}
      <div className="chips">
        <Chip icon={Play}>{flow.name}</Chip>
        <Chip kind="accent">Step {stop + 1} of {stops.length}</Chip>
        {caption.chip !== '' && <Chip icon={GroupIcon}>{caption.chip}</Chip>}
      </div>
      {caption.tabs.length > 0 && (
        <div className="tabs">{caption.tabs.map((t, i) => <span key={i} className={i === caption.tab ? 'tab on' : 'tab'}>{t}</span>)}</div>
      )}
      {caption.text !== '' && <p className="group-text">{caption.text}</p>}
      <Bar progress={progress} now={stop} />
      {here.steps.map((i, n) => {
        const step = flow.steps[i]
        const link = typeof step.flow === 'string' && step.flow.trim() !== '' ? step.flow.trim() : undefined
        const target = link !== undefined && Object.hasOwn(model.flows, link) ? model.flows[link] : undefined
        return (
          <div key={i} className={here.steps.length > 1 ? 'lane-block' : undefined}>
            {caption.lanes[n] && <p className="lane-name">{caption.lanes[n]}</p>}
            <p className="player-ends">{stepEnds(model, step, ends[i])}</p>
            <p>{step.text}</p>
            {step.description && (
              <details key={`${stop}-${i}`} className="more">
                <summary>More</summary>
                <Description text={String(step.description)} />
              </details>
            )}
            {target && (
              <div className="player-buttons flow-link">
                <button disabled={target.steps.length === 0} onClick={() => onOpenFlow(link!)}><Route size={16} />Open flow: {target.name || link}</button>
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
        <button onClick={onStop}><Close size={16} />Stop</button>
      </div>
    </section>
  )
}
