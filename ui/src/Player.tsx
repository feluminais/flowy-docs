import { animationOf, channelLine, outcomeLine } from '../../src/core/animation.ts'
import { captionOf, LEGEND } from '../../src/core/captions.ts'
import type { Caption, Progress } from '../../src/core/captions.ts'
import type { Change } from '../../src/core/flowdiff.ts'
import type { Flow, Model } from '../../src/core/model.ts'
import type { GroupKind, Stop } from '../../src/core/structure.ts'
import { isView, nameOf, stepEnds } from '../../src/core/views.ts'
import { Description } from './Box.tsx'
import { PayloadRow } from './Payloads.tsx'
import { stepPayload, stepReply } from '../../src/core/payloads.ts'
import { CHANGE_NAMES, changeOfStop } from './compare.ts'
import type { ChannelKind } from '../../src/core/animation.ts'
import { marksOf, statesAt } from '../../src/core/states.ts'
import type { StateMark } from '../../src/core/states.ts'
import { channelsAt, kindsOf } from '../../src/core/channels.ts'
import { Chip } from './Chrome.tsx'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { SPEEDS } from './clock.ts'
import type { PlayerClock, Speed } from './clock.ts'
import type { ReactNode } from 'react'
import { ArrowLeft, StepBack, StepForward, ArrowsSplit, ChevronsRight, Close, Columns, GitFork, Help, Pause, Play, Repeat, Route } from './icons.tsx'
import { ChannelKey } from './Channels.tsx'
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
  /** The kinds of channel open at this stop (see channelsAt), for the key. */
  channels: ChannelKind[]
  /** Whether the button says Pause (Play is on, or the step you took still moves) or Play. */
  showsPause: boolean
  moving: boolean
  /** Whether a step that moves plays again after a rest. */
  repeat: boolean
  autoplay: boolean
  /** The flow the reader came from and the step they left it at, when they opened this one from it. */
  trail?: { name: string; step: number }
  /** What differs from the other flow of a comparison, by file step number: the bar's cell for a step takes the mark's colour. */
  changes?: Record<number, Change>
  /** The player's time: the cell of the stop on show fills as far as its motion has got. */
  clock: PlayerClock
  speed: Speed
  onSpeed: (speed: Speed) => void
  /** Dragging the bar (see usePlayback): hold the player, go to a stop and a fraction of the way through it, let go. */
  scrub: Scrub
  onStep: (stop: number) => void
  onPlay: () => void
  onAutoplay: () => void
  onReplay: () => void
  onRepeat: () => void
  /** Compare with another flow: `off` is why the button is greyed out, `picker` the popover `open` shows above the card. Without it there is no Compare button (a pane of a comparison has none). */
  compare?: { off?: string; open: boolean; onToggle: () => void; picker: ReactNode }
  /** Stop, open a linked flow and go back to the one it was opened from. A pane of a comparison has none of them: its Stop and Open flow are greyed out, as it never leaves its flow. */
  onStop?: () => void
  onOpenFlow?: (id: string) => void
  onBack?: () => void
}

type Scrub = { start: () => void; to: (stop: number, fraction: number) => void; end: () => void }

const IN_A_PANE = 'Not while comparing'
const STILL = 'Nothing moves on this step'
/** How soon a second click of Back goes to the step before, in ms. */
const BACK_AGAIN = 2000

/** What Back does on this stop: a step that moves plays again first. */
const backTip = (stop: number, moving: boolean): string | undefined =>
  !moving ? (stop === 0 ? STILL : undefined) : stop === 0 ? 'Replay the step' : 'Replay the step, twice for the one before'

/**
 * The cell under the pointer, or the nearest one (a cell is four pixels high, so a drag strays off it), and how far along it the pointer is. Cells of another lane
 * of a branch count too: a drag can go into any of them.
 */
function cellAt(bar: HTMLElement, x: number, y: number): { stop: number; fraction: number } | undefined {
  let best: { stop: number; fraction: number; score: number } | undefined
  for (const cell of bar.querySelectorAll<HTMLElement>('.cell[data-stop]')) {
    const r = cell.getBoundingClientRect()
    const dx = Math.max(r.left - x, 0, x - r.right)
    const dy = Math.max(r.top - y, 0, y - r.bottom)
    const score = dx * 4 + dy
    if (best === undefined || score < best.score) best = { stop: Number(cell.dataset.stop), fraction: r.width > 0 ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0, score }
  }
  return best && { stop: best.stop, fraction: best.fraction }
}

/** Keeps the cell of the stop on show filled as far as the clock has got through its motion: written straight to the cell on each frame, not through React. */
function useFill(bar: React.RefObject<HTMLDivElement | null>, clock: PlayerClock, stop: number) {
  useEffect(() => {
    let frame = 0
    const draw = () => {
      const cell = bar.current?.querySelector<HTMLElement>('.cell.now')
      const length = clock.length
      cell?.style.setProperty('--fill', String(length > 0 ? Math.min(1, clock.elapsed() / length) : 1))
      frame = !clock.paused && length > 0 && clock.elapsed() < length ? requestAnimationFrame(draw) : 0 // a motion that says how long it is wakes it
    }
    draw()
    const heard = clock.subscribe(() => {
      if (frame === 0) frame = requestAnimationFrame(draw)
    })
    return () => {
      heard()
      cancelAnimationFrame(frame)
    }
  }, [clock, stop])
}

/** A branch's lanes on the bar, in pixels: a lane is a name 14 high over a strip 4 high, 4 apart, so a strip's middle is 16 down its lane. style.css keeps the same numbers. */
const LANE = 22
const STRIP = 16
const ELBOW = 16

/**
 * Where a branch splits, or with `join` where its lanes meet again: straight lines with square corners between the bar's line and each of
 * `rows` lanes. The way to lane `on` is drawn over the rest in the accent (-1 for none).
 */
function Elbow({ rows, on, join }: { rows: number; on: number; join?: boolean }) {
  const y = (r: number) => r * LANE + STRIP
  const way = (r: number) => join ? `M0 ${y(r)}H${ELBOW / 2}V${y(0)}H${ELBOW}` : `M0 ${y(0)}H${ELBOW / 2}V${y(r)}H${ELBOW}`
  return (
    <svg className="elbow" width={ELBOW} height={y(rows - 1) + 2} aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => <path key={r} d={way(r)} />)}
      {on >= 0 && <path className="on" d={way(on)} />}
    </svg>
  )
}

/**
 * How far a flow has got: a cell for each stop, filled up to the stop shown. A repeat or parallel group is boxed, with the line that says
 * what it is at the foot of the box, and a box with an `until` is dashed (it may stop before its last time). A branch is a fork: the bar
 * splits into a row for each lane, each named, and meets again when steps follow; an "only if" has an empty way round. The lanes the stop
 * shown is not in are hollow. In a comparison, a cell takes the colour of what differs at its stop (`changes`, by file step number).
 */
function Bar({ progress, now, stops, changes, clock, scrub }: { progress: Progress; now: number; stops: Stop[]; changes?: Record<number, Change>; clock: PlayerClock; scrub: Scrub }) {
  const bar = useRef<HTMLDivElement>(null)
  useFill(bar, clock, now)
  const dragging = useRef(false)
  const seekTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const at = cellAt(e.currentTarget, e.clientX, e.clientY)
    if (at) scrub.to(at.stop, at.fraction)
  }
  const press = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    scrub.start()
    seekTo(e)
  }
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) seekTo(e)
  }
  const release = () => {
    if (!dragging.current) return
    dragging.current = false
    scrub.end()
  }
  const here = progress.cells.find(c => c.stop === now)
  // The cells by where they go, read once: looking each column up in every cell would cost the square of the steps, at every step of a long flow.
  const groupAt = new Map<number, number>()
  const plainAt = new Map<number, Progress['cells']>()
  const inGroup = new Map<number, Progress['cells']>()
  const add = (map: Map<number, Progress['cells']>, key: number, c: Progress['cells'][number]) => {
    const list = map.get(key)
    if (list) list.push(c)
    else map.set(key, [c])
  }
  for (const c of progress.cells) {
    if (c.group < 0) add(plainAt, c.col, c)
    else {
      if (c.row === 0 && !groupAt.has(c.col)) groupAt.set(c.col, c.group)
      add(inGroup, c.group, c)
    }
  }
  const parts: ({ at: number; plain: true } | { at: number; plain: false; group: number })[] = []
  for (let col = 0; col < progress.cols;) {
    const group = groupAt.get(col) ?? -1
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
    const className = ['cell', c.stop < now ? 'done' : '', c.stop === now ? 'now' : '', off ? 'off' : ''].filter(Boolean).join(' ')
    const change = changes && changeOfStop(stops[c.stop]?.steps ?? [], changes)
    const title = [c.title, change && CHANGE_NAMES[change]].filter(Boolean).join(', ')
    return <span key={c.stop} data-stop={c.stop} title={title || undefined} data-change={change} className={className} style={{ gridColumn: c.col - (c.group >= 0 ? progress.brackets[c.group].from : c.col) + 1, gridRow: row }} />
  }
  const forked = progress.brackets.some(b => b.kind === 'branch')
  // How far a fork reaches over the gap to its neighbour, so its line runs on from it: the bar's gap, and a box's margin too. None at an end.
  const boxed = (p: (typeof parts)[number] | undefined) => p !== undefined && !p.plain && progress.brackets[p.group].kind !== 'branch'
  const reach = (p: (typeof parts)[number] | undefined) => (p === undefined ? 0 : boxed(p) ? -8 : -3)
  return (
    <div ref={bar} className={forked ? 'progress forked' : 'progress'} role="slider" tabIndex={0} aria-label="Step" aria-valuemin={1} aria-valuemax={stops.length} aria-valuenow={now + 1}
      aria-valuetext={`Step ${now + 1} of ${stops.length}`} onPointerDown={press} onPointerMove={move} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release}>
      {parts.map((part, i) => {
        if (part.plain) return <div key={part.at} className="stretch" style={{ flex: 1 }}>{(plainAt.get(part.at) ?? []).map(c => cell(c, 1))}</div>
        const b = progress.brackets[part.group]
        const span = b.to - b.from + 1
        const mine = inGroup.get(part.group) ?? []
        if (b.kind === 'branch') {
          const rows = mine.reduce((n, c) => Math.max(n, c.row + 1), b.lanes.length) // not Math.max(...): a group of very many steps would overflow the stack
          const ways = rows === 1 ? 2 : rows // an "only if" may also go round its lane
          const on = here?.group === part.group ? here.row : -1
          const byRow = new Map<number, Progress['cells']>()
          for (const c of mine) add(byRow, c.row, c)
          return (
            <div key={part.at} className="stretch fork" style={{ flex: span, marginLeft: reach(parts[i - 1]), marginRight: reach(parts[i + 1]) }} title={b.title}>
              <Elbow rows={ways} on={on} />
              <div className="lanes">
                {Array.from({ length: ways }, (_, r) => (
                  <div key={r}>
                    <div className={`lane${on === r ? ' on' : ''}`}>{b.lanes[r] ?? ''}</div>
                    {r < rows
                      ? <div className="runs" style={{ gridTemplateColumns: `repeat(${span}, 1fr)` }}>{(byRow.get(r) ?? []).map(c => cell(c, 1))}</div>
                      : <div className="round" />}
                  </div>
                ))}
              </div>
              {b.to + 1 < progress.cols && <Elbow rows={ways} on={on} join />}
            </div>
          )
        }
        const Icon = KIND_ICON[b.kind]
        return (
          <div key={part.at} className={`stretch grp ${b.kind}${b.maybe ? ' maybe' : ''}`} style={{ flex: span }} title={b.title}>
            <div className="runs" style={{ gridTemplateColumns: `repeat(${span}, 1fr)`, gridTemplateRows: '4px' }}>{mine.map(c => cell(c, 1))}</div>
            <span className="bracket"><Icon size={11} /><span>{b.text}</span></span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Scrolls `box` the least it takes to show `item`, which is in it, and `below` pixels under it. Only `box` moves: scrollIntoView would move the
 * card and the canvas behind it too.
 */
function inView(box: HTMLElement, item: HTMLElement, below = 0) {
  const b = box.getBoundingClientRect()
  const i = item.getBoundingClientRect()
  if (i.top < b.top) box.scrollTop -= b.top - i.top
  else if (i.bottom + below > b.bottom) box.scrollTop += i.bottom + below - b.bottom
}

/** The stops a card measures to keep the size of its tallest; a longer flow keeps the card as each stop draws it. */
const RESERVE_MOST = 300

/** The chips over the card's body: the flow, the step and the group it is in, then Compare and the legend's button. */
function Chips({ flow, stop, count, caption, kind, compare, legend, grouped, onLegend, minHeight }: {
  flow: Flow; stop: number; count: number; caption: Caption; kind: GroupKind | undefined; compare?: Props['compare']; legend: boolean; grouped: boolean; onLegend: () => void; minHeight?: number
}) {
  const GroupIcon = kind === undefined ? undefined : KIND_ICON[kind]
  return (
    <div className="chips" style={minHeight ? { minHeight } : undefined}>
      <Chip icon={Play}>{flow.name}</Chip>
      <Chip kind="accent">Step {stop + 1} of {count}</Chip>
      {caption.chip !== '' && <Chip icon={GroupIcon}>{caption.chip}</Chip>}
      {compare && (
        <button className="compare-btn" data-compare-toggle aria-pressed={compare.open} disabled={compare.off !== undefined} title={compare.off ?? 'Compare with another flow (C)'} onClick={compare.onToggle}><Columns size={14} />Compare</button>
      )}
      {grouped && (
        <button className="help" aria-label="What do these mean?" title="What do these mean?" aria-pressed={legend} onClick={onLegend}><Help size={15} /></button>
      )}
    </div>
  )
}

type BodyProps = Pick<Props, 'model' | 'flow' | 'stops' | 'stop' | 'ends' | 'caption' | 'progress' | 'marks' | 'channels' | 'changes' | 'clock' | 'scrub' | 'onOpenFlow'> & { legend: boolean; grouped: boolean }

/** What the card shows of one stop between its chips and its buttons: the legend, the group's tabs and words, the bar, the keys and each step. */
function StopBody({ model, flow, stops, stop, ends, caption, progress, marks, channels, changes, clock, scrub, legend, grouped, onOpenFlow }: BodyProps) {
  const here = stops[stop]
  return (
    <>
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
      <Bar progress={progress} now={stop} stops={stops} changes={changes} clock={clock} scrub={scrub} />
      <StateKey marks={marks} />
      <ChannelKey kinds={channels} />
      {here.steps.map((i, n) => {
        const step = flow.steps[i]
        const link = typeof step.flow === 'string' && step.flow.trim() !== '' ? step.flow.trim() : undefined
        const target = link !== undefined && Object.hasOwn(model.flows, link) ? model.flows[link] : undefined
        const animation = animationOf(step)
        const ended = animation && outcomeLine(animation, id => nameOf(model, id))
        // What a step leaves open or closes is not a failure, so it is told in the accent colour, not the outcome's red.
        const channel = animation && ended === undefined ? channelLine(animation) : undefined
        const outcome = ended ?? channel
        const sends = stepPayload(model, step)
        const answer = stepReply(model, step)
        return (
          <div key={i} className={here.steps.length > 1 ? 'lane-block' : undefined}>
            {caption.lanes[n] && <p className="lane-name">{caption.lanes[n]}</p>}
            <p className="player-ends">{stepEnds(model, step, ends[i])}</p>
            <p>{step.text}</p>
            {outcome !== undefined && <p className={channel === undefined ? 'player-outcome' : 'player-outcome channel'}>{outcome}</p>}
            {/* What the step sends and what comes back, folded away. */}
            {sends && <PayloadRow key={`${stop}-${i}-sends`} shown={sends} />}
            {answer && <PayloadRow key={`${stop}-${i}-reply`} shown={answer} back />}
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
    </>
  )
}

/**
 * The height of the card's chips and of its body at its tallest stop, so the card keeps one size as the flow plays. Every stop is drawn once out of sight (in
 * `measure`) when what the stops look like may have changed (`deps`) or the card's width did, and taken away again before anything is painted.
 */
function useReserve(section: RefObject<HTMLElement | null>, count: number, deps: readonly unknown[]) {
  const measure = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const at = section.current
    if (!at) return
    const seen = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)))
    seen.observe(at)
    return () => seen.disconnect()
  }, [section])
  const token = useMemo(() => ({}), [...deps, width]) // eslint-disable-line react-hooks/exhaustive-deps
  const [reserve, setReserve] = useState<{ for: object; chips: number; body: number }>()
  const measuring = count <= RESERVE_MOST && reserve?.for !== token
  useLayoutEffect(() => {
    if (!measuring || !measure.current) return
    let chips = 0
    let body = 0
    for (const row of measure.current.children) {
      chips = Math.max(chips, (row.children[0] as HTMLElement).offsetHeight)
      body = Math.max(body, (row.children[1] as HTMLElement).offsetHeight)
    }
    setReserve({ for: token, chips, body })
  })
  return { measure, measuring, reserve: reserve?.for === token ? reserve : undefined }
}

/**
 * The flow player's card: where you are, the group you are in, what happens at this stop (one block a step), and the buttons. It keeps the size of its tallest stop
 * (see useReserve), so its edge and its buttons stay put as the flow plays.
 */
export function Player({ model, flow, stops, stop, ends, caption, progress, marks, channels, showsPause, moving, repeat, autoplay, trail, changes, compare, clock, speed, onSpeed, scrub, onStep, onPlay, onReplay, onRepeat, onAutoplay, onStop, onOpenFlow, onBack }: Props) {
  const here = stops[stop]
  const [legendPref, setLegendPref] = usePref(LEGEND_KEY, 'closed')
  const legend = legendPref === 'open'
  const grouped = progress.brackets.length > 0 // the legend explains groups, so a flow with none has no button
  const toggleLegend = () => setLegendPref(legend ? 'closed' : 'open')
  const body = useRef<HTMLDivElement>(null)
  const section = useRef<HTMLElement>(null)
  const { measure, measuring, reserve } = useReserve(section, stops.length, [model, flow, stops, legend, ends])
  // The lanes' tabs and the lanes in the bar scroll when there are many: the lane this stop is in is scrolled to.
  useLayoutEffect(() => {
    for (const on of body.current?.querySelectorAll<HTMLElement>('.tabs > .on') ?? []) inView(on.parentElement!, on)
    for (const on of body.current?.querySelectorAll<HTMLElement>('.fork .lane.on') ?? []) inView(on.closest<HTMLElement>('.fork')!, on, 8) // its cells, under its name
  }, [stop, flow])
  // Back plays the step again, and a second click soon after goes to the step before; on a step that doesn't move it goes there at once.
  const lastBack = useRef(-Infinity)
  const back = () => {
    const again = performance.now() - lastBack.current < BACK_AGAIN
    lastBack.current = performance.now()
    if (moving && (!again || stop === 0)) onReplay()
    else onStep(stop - 1)
  }
  const shared = { model, flow, stops, ends, progress, changes, clock, scrub, legend, grouped, onOpenFlow }
  return (
    <section className="player" aria-live="polite" ref={section}>
      {trail && onBack && <button className="trail" onClick={onBack}><ArrowLeft size={14} />Back to “{trail.name}”, step {trail.step}</button>}
      <Chips flow={flow} stop={stop} count={stops.length} caption={caption} kind={here.kind} compare={compare} legend={legend} grouped={grouped} onLegend={toggleLegend} minHeight={reserve?.chips} />
      <div className="player-body" ref={body}>
        <div className="player-stop" style={reserve ? { minHeight: reserve.body } : undefined}>
          <StopBody {...shared} stop={stop} caption={caption} marks={marks} channels={channels} />
        </div>
      </div>
      <div className="player-buttons">
        <button disabled={stop === 0 && !moving} title={backTip(stop, moving)} onClick={back}><StepBack size={16} />Back</button>
        {/* Play and Pause are one button as wide as its longer word, and Repeat stays greyed out on a step that doesn't move, so the row never reflows. */}
        <button onClick={onPlay} title={showsPause ? 'Pause (P)' : 'Play (P)'}>
          {showsPause ? <Pause size={16} /> : <Play size={16} />}
          <span className="same-width"><span className={showsPause ? undefined : 'ghost'} aria-hidden={!showsPause}>Pause</span><span className={showsPause ? 'ghost' : undefined} aria-hidden={showsPause}>Play</span></span>
        </button>
        <button className="primary" disabled={stop === stops.length - 1} onClick={() => onStep(stop + 1)}><StepForward size={16} />Next</button>
        <button aria-label="Autoplay" aria-pressed={autoplay} title="Autoplay (A)" onClick={onAutoplay}><ChevronsRight size={16} /></button>
        <button aria-label="Repeat" aria-pressed={repeat} disabled={!moving || autoplay} title={!moving ? STILL : autoplay ? 'Autoplay is on' : repeat ? 'Repeating: plays again after a rest' : 'Repeat: play again after a rest'} onClick={onRepeat}><Repeat size={16} /></button>
        <div className="speed" role="group" aria-label="Speed" title="Speed (S)">
          {SPEEDS.map(s => <button key={s} aria-pressed={speed === s} onClick={() => onSpeed(s)}>{s}×</button>)}
        </div>
        <button disabled={onStop === undefined} title={onStop === undefined ? 'Close the comparison to stop' : undefined} onClick={onStop}><Close size={16} />Stop</button>
      </div>
      {compare?.open && compare.picker}
      {/* Every stop out of sight, for useReserve: here only until it is measured, before anything is painted. */}
      {measuring && (
        <div className="player-measure" ref={measure} aria-hidden="true" inert>
          {stops.map((s, k) => {
            const at = k === stop ? caption : captionOf(flow, s)
            return (
              <div key={k}>
                <Chips flow={flow} stop={k} count={stops.length} caption={at} kind={s.kind} compare={compare} legend={legend} grouped={grouped} onLegend={toggleLegend} />
                <div className="player-stop">
                  <StopBody {...shared} stop={k} caption={at} marks={k === stop ? marks : marksOf(model, statesAt(flow, stops, k))} channels={k === stop ? channels : kindsOf(channelsAt(flow, stops, k))} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
