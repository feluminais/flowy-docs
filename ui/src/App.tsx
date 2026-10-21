import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import type { FitViewOptions, NodeChange, XYPosition } from '@xyflow/react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/problem.ts'
import { getObject, LINE_STYLES, lineStyle, ROOT } from '../../src/core/model.ts'
import type { LineStyle, Model, Step } from '../../src/core/model.ts'
import { connect, deleteObjects, forgetLayout, placeBoxes, removeConnection, setLines } from '../../src/core/ops.ts'
import { flowToMermaid, viewToMermaid } from '../../src/core/mermaid.ts'
import { animationOf, followsLanding, leavesMarks } from '../../src/core/animation.ts'
import { captionOf, progressOf } from '../../src/core/captions.ts'
import { marksOf, statesAt, usesStates } from '../../src/core/states.ts'
import type { StateMark } from '../../src/core/states.ts'
import { otherLaneSteps, stopIndexOf, stopsOf } from '../../src/core/structure.ts'
import { kneeOf, runStates } from '../../src/core/perf/analyse.ts'
import { dialsOf } from '../../src/core/perf/dials.ts'
import { trafficAt } from '../../src/core/perf/traffic.ts'
import { eventsOf } from '../../src/core/perf/types.ts'
import type { Dial, LineTraffic, Setting } from '../../src/core/perf/types.ts'
import { drawnIn, homeView, lightFor, rollUp, table } from '../../src/core/failures.ts'
import type { Mark, Part } from '../../src/core/failures.ts'
import { expandTo, outline } from '../../src/core/outline.ts'
import type { OutlineRow } from '../../src/core/outline.ts'
import { chain, hasChildren, isView, nameOf, parentOf, placeEnds, placeStep, stepEnds } from '../../src/core/views.ts'
import { Box, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { Alert, ArrowLeft, ArrowRight, ChevronRight, Close, Copy, Grid, Home, Keyboard, Pencil, Plus, Redo, Route, Search as SearchIcon, Undo } from './icons.tsx'
import { connectionsOf, locate, moveBetween } from './edit.ts'
import type { Move } from './edit.ts'
import { fitOptions, focusEdges, frameNode, isStepLine, lineId, NAV, PANEL, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode, Playing } from './graph.ts'
import { alongFailures, readHash, toHash } from './hash.ts'
import { escapeStep, letter, takesEnter, undoesMove } from './keys.ts'
import { activeAnalysis, firstErrorAt, modeCount, modeIn, neighbour, rowsFor } from './failuresview.ts'
import type { Filter } from './failuresview.ts'
import { FailuresBody } from './Failures.tsx'
import { Line, LineMarksContext, LineStyleContext, LineWidthsContext } from './Line.tsx'
import { TrafficLayer } from './TrafficLayer.tsx'
import { keepOwnLines, LINE_NAMES, ownLines } from './lines.ts'
import { DWELL, GAP } from './motion.ts'
import { clampWidth, openTab } from './navstate.ts'
import type { NavTab } from './navstate.ts'
import { keepNav, loadNav } from './navstore.ts'
import { store } from './store.ts'
import { DetailsRail, Explorer, FlowsTab, NavPanel, NavRail, NavTabs, Sash } from './Navigator.tsx'
import { PerfBody } from './Performance.tsx'
import { activeRun, clampDial, clampPos, dialTop, loadAt, openingPositions, placeActive, rampActive, rampFrom, rampFromActive, rampPos, RAMP_STEP_MS, settingOf, snap, stepFrom, top } from './perfview.ts'
import { AddPanel, LinePanel, ObjectPanel, OverviewPanel } from './Panel.tsx'
import { Recorder } from './Recorder.tsx'
import { PickedBar } from './PickedBar.tsx'
import { addsToSelection, banded, keepsSelection, toggled } from './selection.ts'
import { Search } from './Search.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import { StepMotion, takenBy } from './StepMotion.tsx'
import { GroupMarks } from './GroupMarks.tsx'
import { Player } from './Player.tsx'
import { closeFlow, followBack, openFlow as leaveFlow } from './trail.ts'
import type { Spot } from './trail.ts'
import type { Recording } from './Recorder.tsx'
import type { SaveEdit as Run } from './forms.tsx'
import { copyMessage } from '../../src/core/host.ts'
import { saveState, vscode } from './host.ts'
import { useReveal } from './reveal.ts'
import { useColorMode } from './hosttheme.ts'
import { createHistoryStore } from './historystore.ts'
import type { HistoryClient } from './historyclient.ts'
import { useModel } from './useModel.ts'
import type { Edit, Loaded, Restore } from './useModel.ts'
import { Yaml } from './Yaml.tsx'

const nodeTypes = { box: Box, frame: Frame }
const NO_MARKS: Record<string, StateMark> = {} // the same object every time, so a flow with no states never rebuilds the graph for them
const NO_DIALS: Dial[] = [] // and no dials, for a run that is not there
const NO_LINES: LineTraffic[] = [] // and no traffic, so the Performance panel's key is not rebuilt for it
const edgeTypes = { line: Line }
const SCRUB_MS = 250 // ms after the slider of a run was last dragged that the shapes still change their state at once, with no fade
const DOUBLE_CLICK = 250 // ms a click on a box that opens waits, in case it is the first half of a double-click
const LEAVE = 220 // ms the old view takes to fly off; keep in sync with the leave-* keyframes in style.css
const ARRIVE = 320 // ms the new view takes to settle; keep in sync with the arrive-* keyframes

/**
 * A move between views, heading `to` a view. In and out zoom about (x, y) on the canvas. Across slides:
 * the old view moves away from (x, y) and the new one comes in from that side; (dx, dy) is that way, in
 * percent of the canvas.
 */
type Motion = { dir: Move; phase: 'leave' | 'arrive'; x: number; y: number; dx: number; dy: number; to: string }

/** What the side panel shows. One thing at a time. */
type Side =
  | { kind: 'object'; id: string }
  | { kind: 'objects'; ids: string[] } // several shapes picked in edit mode, to move or delete together
  | { kind: 'line'; from: string; to: string }
  | { kind: 'add' }
  | ({ kind: 'flow' } & Recording)

/** The panel for a set of shapes: none shows nothing, one is an ordinary click on it. */
const sideFor = (ids: string[]): Side | undefined => (ids.length === 0 ? undefined : ids.length === 1 ? { kind: 'object', id: ids[0] } : { kind: 'objects', ids })

/** A box clicked while recording: the first one starts the step, the second ends it (the same box again: a step it does on its own), a third starts over. */
function pick(rec: Recording, id: string): Recording {
  if (!rec.id) return rec
  if (!rec.from || rec.to) return { ...rec, from: id, to: undefined }
  return { ...rec, to: id }
}

export function App() {
  const { loaded, banner, edit, undo, redo, restore, history, changes, live } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {loaded && <Reader {...loaded} edit={edit} undo={undo} redo={redo} restore={restore} historyApi={history} changes={changes} live={live} readOnly={!live || banner !== undefined} broken={banner !== undefined} />}
    </div>
  )
}

/** "N problems": a list that opens from the top bar. Picking one shows where it is. */
function Problems({ problems, onPick }: { problems: Problem[]; onPick: (p: Problem) => void }) {
  if (problems.length === 0) return null
  return (
    <details className="problems">
      <summary><Alert size={14} />{problems.length} problem{problems.length === 1 ? '' : 's'}</summary>
      <ul>
        {problems.map((p, i) => (
          <li key={i}>
            <button onClick={e => {
              e.currentTarget.closest('details')!.open = false
              onPick(p)
            }}><span className="muted">{p.file}</span> {p.message}</button>
          </li>
        ))}
      </ul>
    </details>
  )
}

type Back = () => Promise<string | undefined>

function Reader({ model, problems, codeBase, runs, runProblems, failureProblems, edit, undo, redo, restore, historyApi, changes, live, readOnly, broken }: Loaded & {
  edit: Edit; undo: Back; redo: Back; restore: Restore; historyApi?: HistoryClient; changes: number; live: boolean; readOnly: boolean; broken: boolean
}) {
  const colorMode = useColorMode()
  // A link opens where its address says (see hash.ts). The effects below keep the address up to date.
  const [viewId, setViewId] = useState(() => {
    // An address that names a mode whose part is outside the view it names opens on the view that draws the part.
    const named = readHash(location.hash)
    const m = modeIn(model, named.failures?.analysis, named.failures?.mode)
    return m !== undefined && !drawnIn(model, named.view, m) ? homeView(model, m) : named.view
  })
  const [side, setSide] = useState<Side>()
  // The left-hand panel's tab (the navigator: Explorer, Flows, Failures or YAML), and whether the right-hand Details panel was opened from its rail. Details shows
  // `side`, or the level you are in, so a `side` opens it too. An address that names a failure analysis opens on the Failures tab.
  const [remembered] = useState(loadNav)
  const [tab, setNavTab] = useState<NavTab | undefined>(() => (readHash(location.hash).failures !== undefined ? 'failures' : remembered.tab))
  // Whether the navigator is where the reader last clicked or opened something: Escape closes it then, and leaves it alone once they work in
  // the diagram. A navigator that came back with the page has not been used.
  const navUsed = useRef(false)
  const setTab = (t: NavTab | undefined) => {
    navUsed.current = t !== undefined
    setNavTab(t)
  }
  const [details, setDetails] = useState(false)
  const [navWidth, setNavWidth] = useState(remembered.navWidth ?? NAV) // dragged by the sashes on the panels' edges
  const [detailsWidth, setDetailsWidth] = useState(remembered.detailsWidth ?? PANEL)
  // The Performance panel, which takes Details' place on the right: which run, and where along its tested levels. A whole number is a tested level; a ramp goes between them.
  // A run has a position for each of its dials (one for a run of one source), and `active` is the dial the keys and Ramp act on, the one that was moved last.
  const [perf, setPerf] = useState(() => readHash(location.hash).perf !== undefined)
  // Where a run opens: a single run at the level its address names, else at its first struggle, else at the top. A run with several sources at the places its address names when it
  // names one for each dial, else together at the first struggle (each dial along its own loads), else every dial at its top.
  const startPositions = (id: string, level?: number, levels?: number[]): number[] => {
    const dialled = dialsOf(runs, id)
    if (!dialled) return [0]
    if (dialled.mode === 'single') return [clampPos(runs[id], (levels === undefined ? level : undefined) ?? kneeOf(runs, id)?.index ?? top(runs[id]))]
    if (levels !== undefined && levels.length === dialled.dials.length) return dialled.dials.map((d, i) => clampDial(d, levels[i]))
    return openingPositions(dialled.dials, kneeOf(runs, id))
  }
  const [runId, setRunId] = useState(() => {
    const named = readHash(location.hash).perf?.run
    return named !== undefined && Object.hasOwn(runs, named) ? named : Object.keys(runs)[0] ?? ''
  })
  const [positions, setPositions] = useState(() => startPositions(runId, readHash(location.hash).perf?.level, readHash(location.hash).perf?.levels))
  const [active, setActive] = useState(0)
  // The Failures tab: which analysis, which mode is picked in it, and what the list is narrowed to.
  const [analysisId, setAnalysisId] = useState(() => readHash(location.hash).failures?.analysis ?? '')
  const [modeId, setModeId] = useState<string | undefined>(() => readHash(location.hash).failures?.mode)
  const [filter, setFilter] = useState<Filter>({})
  const [ramping, setRamping] = useState(false)
  const [scrubbing, setScrubbing] = useState(false) // the slider of a run is being dragged: the states of shapes snap instead of moving
  const scrubTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(scrubTimer.current), [])
  const posNow = useRef(positions) // the ramp reads where it is from here, so a render in between never makes it start over
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT, ...remembered.expanded])) // the project's own row starts open
  const [playing, setPlaying] = useState<{ flow: string; step: number; auto?: boolean; trail?: Spot[] } | undefined>(() => {
    const { flow } = readHash(location.hash)
    return flow === undefined ? undefined : { flow, step: 0 }
  })
  const [replays, setReplays] = useState(0) // R counts up, and a new count plays the step again
  const [repeat, setRepeat] = useState(() => {
    try {
      return store.get('flowy.repeat') !== 'off'
    } catch {
      return true
    }
  }) // whether a step that moves plays again after a rest
  const toggleRepeat = () => {
    setRepeat(!repeat)
    try {
      store.set('flowy.repeat', repeat ? 'off' : 'on')
    } catch {
      // storage is blocked: the choice lasts until the page closes
    }
  }
  const [settledKey, setSettledKey] = useState('') // the step (and replay) whose motion has finished
  const [editMode, setEditMode] = useState(false)
  const [notice, setNotice] = useState<string>()
  // Where boxes are being dragged to. Nodes are controlled, so a box only moves through this.
  const [moved, setMoved] = useState(new Map<string, XYPosition>())
  // What each box measured. React Flow throws a box's measurements away when it gets a node object
  // it hasn't seen, which every render here is, and its lines have nowhere to land until the browser
  // has measured it again: they'd blink away for a frame on every drag, click and hover.
  const sizes = useRef(new Map<string, { width: number; height: number }>())
  const layoutSaves = useRef(0) // layout saves still queued; `moved` is cleared once the last one is back
  const justMoved = useRef(false) // the last thing done was dragging a box, and nothing has been done since: Esc or Backspace take it back
  const banding = useRef(false) // a box is being drawn round shapes to pick them (Shift and drag)
  const [hovered, setHovered] = useState<string>() // the line the pointer is on
  const [searching, setSearching] = useState(false)
  const [shortcuts, setShortcuts] = useState(false) // the list ? opens
  const fitNow = useRef<(options: Omit<FitViewOptions, 'nodes'>) => void>(undefined) // for F; set once each canvas is ready
  const [tidied, setTidied] = useState(0) // Tidy counts up, so the camera fits the new layout
  const opening = useRef<ReturnType<typeof setTimeout>>(undefined) // a click on a box that opens, waiting out the double-click window
  const openingBox = useRef<string>(undefined) // that box: a Ctrl+click in the meantime still counts it as picked
  const cancelOpen = () => {
    clearTimeout(opening.current)
    openingBox.current = undefined
  }
  const quiet = useRef(true) // the next address write replaces instead of pushing (see the address effect)
  const [motion, setMotion] = useState<Motion>()
  const motionTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const canvas = useRef<HTMLElement>(null)

  const editing = editMode && !readOnly // a file that can't be read, a lost server, or an exported page makes the canvas read-only
  // In edit mode lines show the project's style, which is what the picker changes there. Reading, the
  // picker only changes this screen.
  const [mine, setMine] = useState(ownLines)
  const projectLines = lineStyle(model)
  const lines = editing ? projectLines : mine ?? projectLines
  // A box with children opens. In edit mode an empty system, app or store opens too, so its first child can be added.
  const canOpen = (id: string) => hasChildren(model, id) || (editing && typesIn(model, id).length > 0)
  // After a live reload the view's object may be gone or empty: show the nearest view that still exists.
  const view = chain(model, viewId).find(v => v === ROOT || canOpen(v)) ?? ROOT
  const recording = editing && side?.kind === 'flow' ? side : undefined
  const flowsHere = Object.entries(model.flows).filter(([, f]) => f.view === view && (editing || f.steps.length > 0))
  // The run on show and where along it: a run that was renamed, deleted or cut short under a live reload falls back to one that is there.
  const runKey = activeRun(runs, runId)
  const loadTest = runKey ? runs[runKey] : undefined
  // What the run is turned up on: one dial for a run of one source, one for each source of a run with several.
  const found = useMemo(() => (runKey ? dialsOf(runs, runKey) : undefined), [runs, runKey])
  const dials = found?.dials ?? NO_DIALS
  const multi = found !== undefined && found.mode !== 'single'
  const activeDial = Math.min(active, Math.max(0, dials.length - 1))
  const here = multi ? dials.map((d, i) => clampDial(d, positions[i] ?? 0)) : [loadTest ? clampPos(loadTest, positions[0] ?? 0) : 0]
  const hereKey = here.join(',')
  if (!ramping) posNow.current = here // while it ramps, the ramp is ahead of what the screen shows
  const showPerf = Object.keys(runs).length > 0 || runProblems.length > 0 // the tab is there whenever there is a run, or a run file to complain about
  const canPerf = showPerf && !editing // while editing the tab is greyed out: the numbers would sit on a model that is changing
  const perfOpen = perf && canPerf && loadTest !== undefined
  const load = loadTest && !multi ? loadAt(loadTest, here[0]) : 0 // the load at the position on show, or for a run over time the time (a run with several sources has none of its own)
  // The Failures tab is there whenever there is an analysis or a file of one to complain about, and always in edit mode, so the first analysis can be made.
  const analysisKey = activeAnalysis(model.failures, analysisId)
  const analysis = analysisKey === undefined ? undefined : model.failures[analysisKey]
  const mode = modeIn(model, analysisKey, modeId)
  const showFailures = Object.keys(model.failures).length > 0 || failureProblems.length > 0 || editing
  const totals = useMemo(() => outline(model, { expanded: new Set(), editing }).totals, [model, editing])
  const showFlows = totals.flows > 0 || editing // the Flows tab is there whenever there is a flow to find
  // The YAML tab needs a server that keeps the history: not an exported page, not the VS Code webview.
  const yamlStore = useMemo(() => (live && historyApi ? createHistoryStore(historyApi) : undefined), [live, historyApi])
  useEffect(() => { void yamlStore?.refresh() }, [yamlStore, changes]) // after every load, whether it worked or not: a change may have left a file broken
  // A server that answers 404 keeps no history (an older flowy), and then there is nothing for the tab to show.
  const subscribeYaml = useMemo(() => (listener: () => void) => (yamlStore ? yamlStore.subscribe(listener) : () => undefined), [yamlStore])
  const yamlGone = useSyncExternalStore(subscribeYaml, () => yamlStore?.get().unavailable === true)
  const showYaml = yamlStore !== undefined && !yamlGone
  const nav = openTab(tab, { flows: showFlows, yaml: showYaml, failures: showFailures })
  const failuresOpen = nav === 'failures' // a tab of the navigator on the left, with Explorer, Flows and YAML
  // A flow that was playing waits behind the Performance and Failures tabs, so a step's motion, the traffic and the risk marks never draw at once.
  const flow = editing || perfOpen || failuresOpen ? undefined : flowsHere.find(([id]) => id === playing?.flow)?.[1]
  // The player moves through stops, not steps: a stop is what is on screen at once (see structure.ts). `playing.step` is a stop.
  const stops = useMemo(() => (flow ? stopsOf(flow) : []), [flow])
  const stopIndex = flow && playing ? Math.max(0, Math.min(playing.step, stops.length - 1)) : 0
  const stop = flow ? stops[stopIndex] : undefined
  // Where shapes stand at this stop: the flow's start and each step's changes up to it (nothing is stored, so stepping back needs no undo).
  const flowMarks = useMemo(() => (flow && stop ? marksOf(model, statesAt(flow, stops, stopIndex)) : NO_MARKS), [model, flow, stop, stops, stopIndex])
  // While the Performance tab is open, a run over time sets the states instead: the latest event at or before the time on show. The marks are kept as text so
  // that the graph (which takes dagre tens of ms) is rebuilt only when a state changes, not on every step of a Play.
  const timeEvents = perfOpen && loadTest !== undefined && eventsOf(loadTest).length > 0
  const marksText = timeEvents && loadTest ? JSON.stringify(marksOf(model, runStates(loadTest, load))) : ''
  const runMarks = useMemo(() => (marksText === '' || marksText === '{}' ? NO_MARKS : (JSON.parse(marksText) as Record<string, StateMark>)), [marksText])
  const stateMarks = flow ? flowMarks : runMarks
  const manyPicked = side?.kind === 'objects' // several shapes picked: a bar at the foot of the canvas, no panel over them
  const detailsOpen = (details || (side !== undefined && !manyPicked)) && !perfOpen // the Performance panel is in its place while it is open
  const rightOpen = detailsOpen || perfOpen // a panel on the right, whichever it is

  // A drag re-renders on every mouse move, and dagre takes tens of ms on a big view, so the graph is
  // rebuilt only when what it is built from changes. `flow`, `recording` and `model` keep their identity between renders.
  const shown = useMemo<Playing | undefined>(() => {
    const placeSteps = (steps: Step[]) => steps.map(s => placeStep(model, view, s))
    if (flow && stops[stopIndex]) {
      // A shape that takes a request off the line (`by`) is lit with the step, so it does not sit at the faint level while it flashes.
      const also = stops[stopIndex].steps.flatMap(i => {
        const taker = animationOf(flow.steps[i])?.by
        const at = taker && 'shape' in taker ? placeStep(model, view, { from: taker.shape }) : null
        return at ? [at[0]] : []
      })
      return { ends: placeSteps(flow.steps), steps: stops[stopIndex].steps, faint: otherLaneSteps(stops, stopIndex), ...(also.length > 0 ? { also } : {}) }
    }
    if (!recording) return undefined
    const done = placeSteps(Object.hasOwn(model.flows, recording.id) ? model.flows[recording.id].steps : [])
    return recording.from && recording.to
      ? { ends: [...done, placeStep(model, view, { from: recording.from, to: recording.to === recording.from ? undefined : recording.to })], step: done.length }
      : { ends: done }
  }, [model, view, flow, stops, stopIndex, recording])
  // Every step of the stop that moves, with where it lands in this view. A step the view can't show doesn't move.
  const animated = flow && stop ? stop.steps.flatMap(i => {
    const a = animationOf(flow.steps[i])
    const p = shown?.ends[i]
    return a && p ? [{ i, animation: a, placed: p, by: takenBy(model, view, a, p) }] : []
  }) : []
  const moving = animated.length > 0
  const stepKey = flow && playing ? `${playing.flow}:${stopIndex}:${replays}` : ''
  const caption = flow && stop ? captionOf(flow, stop) : undefined
  const progress = useMemo(() => (flow ? progressOf(flow, stops) : undefined), [flow, stops])
  const marks = flow && stop && caption ? stop.steps.flatMap((i, n) => {
    const p = shown?.ends[i]
    return p && stop.kind && caption.marks[n] !== '' ? [{ ends: p, text: caption.marks[n], kind: stop.kind }] : []
  }) : []
  // A stop settles when every motion in it has finished, not the first.
  const finishedSteps = useRef(new Set<number>())
  useEffect(() => {
    finishedSteps.current = new Set()
  }, [stepKey])
  const finished = (i: number) => {
    finishedSteps.current.add(i)
    if (finishedSteps.current.size >= animated.length) setSettledKey(stepKey)
  }
  const lastLeft = playing?.trail?.at(-1)
  const leftFlow = lastLeft && Object.hasOwn(model.flows, lastLeft.flow) ? model.flows[lastLeft.flow] : undefined
  const trail = flow && lastLeft ? { name: leftFlow?.name ?? lastLeft.flow, step: Math.min(lastLeft.step, leftFlow ? stopsOf(leftFlow).length - 1 : lastLeft.step) + 1 } : undefined
  const graph = useMemo(() => toGraph(model, view, shown, problems, stateMarks), [model, view, shown, problems, stateMarks])
  // The states on the canvas now, for the key: a shape on another view that is in one is not drawn here.
  const marksHere = useMemo(() => Object.fromEntries(graph.nodes.flatMap(n => (n.data.state ? [[n.id, n.data.state] as const] : []))), [graph])
  const setting = useMemo<Setting>(() => (multi ? settingOf(dials, here) : { '': load }), [multi, dials, hereKey, load])
  const loadTraffic = useMemo(() => (perfOpen && loadTest ? trafficAt(model, runs, runKey, setting, view) : undefined), [perfOpen, model, runs, runKey, loadTest, setting, view])
  const widths = useMemo(() => new Map(loadTraffic?.lines.map(l => [lineId(l.from, l.to), l.width])), [loadTraffic])
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches // no ramp and no traffic: the colours, thickness, badges and numbers say it all
  const drawnLines = useMemo(() => (still ? NO_LINES : loadTraffic?.lines ?? NO_LINES), [still, loadTraffic]) // what the panel's key is told, so the tab makes no traffic of its own
  const chosen = side?.kind === 'objects' ? side.ids : side?.kind === 'object' ? [side.id] : [] // the shapes picked for editing, one or several
  const picked = recording ? [recording.from, recording.to] : chosen
  // What the Failures tab draws: the badges (rolled up to what this view draws), and for a picked mode its part, what it affects, and the rest faded.
  const part: Part | undefined = side?.kind === 'object' ? { box: side.id } : side?.kind === 'line' ? { line: [side.from, side.to] } : undefined
  const failMarks = useMemo(() => (failuresOpen && analysis ? rollUp(model, analysis, view) : undefined), [failuresOpen, model, analysis, view])
  const lineMarks = useMemo(() => new Map<string, Mark>(Object.entries(failMarks?.lines ?? {})), [failMarks])
  const drawing = side?.kind === 'add' || side?.kind === 'flow' // Add and a flow being recorded are drawn on the canvas: a faded one would hide what they make
  const lit = useMemo(() => (failuresOpen && mode && !drawing ? lightFor(model, view, mode) : undefined), [failuresOpen, model, mode, view, drawing])
  const partKey = part === undefined ? '' : JSON.stringify(part)
  const rows = useMemo(
    () => (failuresOpen && analysis ? rowsFor(model, analysis, view, { band: filter.band, part }) : { here: [], elsewhere: [] }),
    [failuresOpen, model, analysis, view, filter.band, partKey], // `part` is `partKey` in words
  )
  const litClass = (id: string) => (lit === undefined ? undefined : lit.fails.includes(id) ? 'fails' : lit.affects.includes(id) ? 'affected' : 'dim')
  // Nodes are controlled: selection and drag positions only show through these props, applied on every render after the memoized graph.
  const nodes = graph.nodes.map(n => ({
    ...n,
    data: loadTraffic || failMarks || scrubbing ? { ...n.data, ...(loadTraffic ? { perf: loadTraffic.boxes[n.id] } : {}), ...(failMarks && Object.hasOwn(failMarks.boxes, n.id) ? { fail: failMarks.boxes[n.id] } : {}), ...(scrubbing ? { snap: true } : {}) } : n.data,
    className: [n.className, litClass(n.id)].filter(Boolean).join(' ') || undefined,
    position: moved.get(n.id) ?? n.position, selected: picked.includes(n.id), measured: sizes.current.get(n.id),
  }))
  // Inside a box, a frame named after it wraps its own boxes and follows them while they're dragged.
  const inner = view === ROOT ? [] : nodes.filter(n => graph.members.includes(n.id))
  // A click on its outline is a click on that shape: its Details open, as the rail's button opens them. While a flow is recorded or a load shows,
  // the panel has its own work, so the outline takes no click.
  const openLevel = recording || perfOpen ? undefined : () => {
    justMoved.current = false
    clearTimeout(opening.current)
    if (details && side === undefined) return closeDetails() // its Details are already showing: a second click closes them
    setSide(undefined)
    setDetails(true)
  }
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })), openLevel)]
  const selectedLine = side?.kind === 'line' ? lineId(side.from, side.to) : undefined
  const selectedBox = side?.kind === 'object' ? side.id : undefined
  // The lines a pipe plays along move their labels aside (see Line), unless motion is reduced and there is no pipe. A step that leaves marks (a cross, a bar) keeps its label clear of them.
  const pipes = animated.filter(m => !still || leavesMarks(m.animation)).map(m => lineId(m.placed[0], m.placed[1])).join('\n')
  const edges = useMemo(() => {
    const lifted = new Set(pipes === '' ? [] : pipes.split('\n'))
    const drawn = focusEdges(graph.edges, { box: selectedBox, line: selectedLine, hover: hovered }).map(e => (lifted.has(e.id) ? { ...e, data: { lift: true } } : e))
    // A picked failure mode outlines its line and fades every other.
    return lit === undefined ? drawn : drawn.map(e => ({ ...e, className: [e.className, e.id === lit.failsLine ? 'fails' : 'dim'].filter(Boolean).join(' ') }))
  }, [graph, selectedBox, selectedLine, hovered, pipes, lit])
  // The tree follows the canvas: going into a level opens it, and a selected shape is brought into view. It only ever opens rows.
  const reveal = (id: string, self: boolean) =>
    setExpanded(e => {
      const next = expandTo(model, id, e, self)
      return next.size === e.size ? e : next
    })
  useEffect(() => reveal(view, true), [view])
  useEffect(() => {
    if (selectedBox !== undefined) reveal(selectedBox, false)
  }, [selectedBox])
  useEffect(() => keepNav({ tab, expanded: [...expanded], navWidth, detailsWidth }), [tab, expanded, navWidth, detailsWidth])

  const run: Run = async op => {
    justMoved.current = false
    setNotice(undefined)
    const message = await edit(op)
    setNotice(message)
    return message === undefined
  }
  const close = () => setSide(undefined)
  const closeDetails = () => {
    setSide(undefined)
    setDetails(false)
  }
  /** Shows what a click on the canvas, a problem or a button points at, in the Details panel on the right (or, while Performance is open, in its readings). */
  const show = (s: Side | undefined) => setSide(s)
  // The Failures tab and Performance never show at once: the traffic and the risk marks would draw over each other.
  const pickTab = (t: NavTab | undefined) => {
    if (t === 'failures') setPerf(false)
    setTab(t)
  }
  const toggleTab = (t: NavTab) => pickTab(nav === t ? undefined : t)
  const openPerf = () => {
    setDetails(false) // so that closing it again doesn't leave Details open in its place
    setNavTab(t => (t === 'failures' ? undefined : t))
    setPerf(true)
  }
  const openFailures = () => pickTab('failures')
  const closeFailures = () => setTab(undefined)
  const closePerf = () => {
    setPerf(false)
    setSide(undefined) // what was picked for its readings is no reason for Details to open in its place
  }
  const takeBack = async () => {
    justMoved.current = false
    setNotice(undefined)
    setNotice((await undo()) ?? 'Undone.')
    setMoved(new Map()) // a box dragged back shows where the file says
  }
  const bringBack = async () => {
    justMoved.current = false
    setNotice(undefined)
    setNotice((await redo()) ?? 'Redone.')
    setMoved(new Map())
  }
  // Fenced, so it pastes straight into a README or a PR, where GitHub draws it.
  const copyText = async (text: string, notice: string) => {
    try {
      // In VS Code the editor writes it: a webview can't count on the clipboard API, which wants the page focused.
      if (vscode) vscode.postMessage(copyMessage(text))
      else await navigator.clipboard.writeText(text)
      setNotice(notice)
    } catch {
      setNotice("Couldn't copy: the browser didn't allow it.")
    }
  }
  const copyMermaid = () => {
    const diagram = flow && playing ? flowToMermaid(model, playing.flow) : viewToMermaid(model, view)
    return copyText('```mermaid\n' + diagram + '```\n', `Copied ${flow ? 'this flow' : 'this view'} as Mermaid. Paste it into a README or a PR: GitHub draws it.`)
  }
  const copyFailures = (format: 'markdown' | 'csv') => {
    if (analysis) void copyText(table(model, analysis, format), format === 'csv' ? 'Copied this analysis as CSV.' : 'Copied this analysis as a table.')
  }
  const go = (id: string) => {
    justMoved.current = false
    cancelOpen()
    clearTimeout(motionTimer.current)
    setMotion(undefined)
    setViewId(id)
    setPlaying(undefined)
    setMoved(new Map())
    setSide(s => (s?.kind === 'object' ? s : undefined)) // lines, Add and recording belong to one view
  }
  /** Open `id` with a zoom. A second zoom on the way, or reduced motion, opens it straight away. */
  const zoomTo = (id: string, dir: Move, x: number, y: number) => {
    if (motion || matchMedia('(prefers-reduced-motion: reduce)').matches) return go(id)
    const r = canvas.current?.getBoundingClientRect()
    const [ux, uy] = [x - (r?.width ?? 0) / 2, y - (r?.height ?? 0) / 2]
    const length = Math.hypot(ux, uy) || 1 // a box dead in the middle slides nowhere and just fades
    const slide = { dx: (ux / length) * 25, dy: (uy / length) * 25 }
    // A busy view takes a while to lay out the first time. The old one is still flying off (transform and opacity run off the main
    // thread), so work the new one out now, behind that, instead of when it should arrive.
    setTimeout(() => toGraph(model, id), 30)
    setMotion({ dir, phase: 'leave', x, y, ...slide, to: id })
    motionTimer.current = setTimeout(() => {
      go(id)
      setMotion({ dir, phase: 'arrive', x, y, ...slide, to: id })
      motionTimer.current = setTimeout(() => setMotion(undefined), ARRIVE)
    }, LEAVE)
  }
  /** Open box `id`, from where it sits on screen: zoom in when it's inside this view, slide across when it sits beside it. */
  const zoomInto = (id: string) => {
    cancelOpen() // a click on the box queued its panel; the zoom replaces it
    close()
    const c = canvas.current!.getBoundingClientRect()
    const b = canvas.current!.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
    zoomTo(id, moveBetween(model, view, id), b ? b.x + b.width / 2 - c.x : c.width / 2, b ? b.y + b.height / 2 - c.y : c.height / 2)
  }
  /** Zoom out to `id`, about the middle of the canvas: the box's place in the outer view isn't known until it's drawn. */
  const zoomOut = (id: string) => {
    const r = canvas.current?.getBoundingClientRect()
    zoomTo(id, 'out', (r?.width ?? 0) / 2, (r?.height ?? 0) / 2)
  }
  /** Play a flow where it plays (going to its level first), or while editing open it to edit. */
  const openFlow = (id: string) => {
    const f = model.flows[id]
    if (f.view !== view) go(f.view)
    if (editing) show({ kind: 'flow', id, name: f.name })
    else setPlaying({ flow: id, step: 0 })
  }
  /** Pick a mode in the Failures list; when its part is outside this view, the canvas goes to the view that draws it. */
  const selectMode = (id: string | undefined) => {
    setModeId(id)
    const m = modeIn(model, analysisKey, id)
    if (m && !drawnIn(model, view, m)) go(homeView(model, m))
  }
  /** A click on a shape in the list of those no mode names yet: go to it and pick it. */
  const pickShape = (id: string) => {
    if (parentOf(model, id) !== view) go(parentOf(model, id))
    setSide({ kind: 'object', id })
  }
  /** Show it: play the flow that tells a failure, at the step it names (counted from 1), or open it to edit. */
  const showFlow = (id: string, step?: number) => {
    const f = Object.hasOwn(model.flows, id) ? model.flows[id] : undefined
    if (!f || f.steps.length === 0 || !isView(model, f.view)) return setNotice("That flow can't play yet.")
    closeFailures()
    if (f.view !== view) go(f.view)
    if (editing) show({ kind: 'flow', id, name: f.name })
    else setPlaying({ flow: id, step: stopIndexOf(stopsOf(f), step === undefined ? 0 : Math.max(0, step - 1)) })
  }
  /** Seen in a run: open Performance on the first tested level where the mode's part has errors, on the view that draws it. */
  const seenInRun = (id: string) => {
    const m = modeIn(model, analysisKey, id)
    const name = m?.run
    if (m === undefined || name === undefined || !Object.hasOwn(runs, name)) return
    const at = firstErrorAt(model, runs[name], m)
    if (at === undefined) return
    closeFailures()
    go(homeView(model, m))
    setRamping(false)
    setRunId(name)
    setPositions([clampPos(runs[name], at)])
    setActive(0)
    openPerf()
  }
  // VS Code asks to show a shape (the one a file belongs to, or a pick from its list) or a flow.
  useReveal(target => {
    if ('shape' in target) {
      if (!getObject(model, target.shape)) return setNotice("That shape isn't in the model any more.")
      setSearching(false)
      go(parentOf(model, target.shape)) // the view the box sits in
      show({ kind: 'object', id: target.shape })
    } else if (Object.hasOwn(model.flows, target.flow)) openFlow(target.flow)
    else setNotice("That flow isn't in the model any more.")
  })
  /** A click in the Explorer: show the shape where it is drawn and select it (its Details open on the right), or play the flow. */
  const pickRow = (row: OutlineRow) => {
    if (row.kind === 'flow') return openFlow(row.id)
    if (row.id === ROOT) {
      if (view !== ROOT) go(ROOT)
      return setSide(undefined)
    }
    if (parentOf(model, row.id) !== view) go(parentOf(model, row.id))
    setSide({ kind: 'object', id: row.id })
  }
  /** Enter or a double-click in the Explorer: zoom into a shape that opens, else the same as a click. */
  const openRow = (row: OutlineRow) => {
    if (row.kind === 'shape' && (row.id === ROOT || canOpen(row.id))) {
      go(row.id)
      return setSide(undefined)
    }
    pickRow(row)
  }
  const toggleOpen = (id: string, expand: boolean) =>
    setExpanded(e => {
      const next = new Set(e)
      if (expand) next.add(id)
      else next.delete(id)
      return next
    })
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, stops.length - 1)), auto: false })
  const togglePlay = () => {
    if (!playing || !flow) return
    const atEnd = stopIndex === stops.length - 1
    setPlaying(playing.auto ? { ...playing, auto: false } : { ...playing, step: atEnd ? 0 : stopIndex, auto: true })
  }
  /** A step's story continues in another flow: open it (on its own view), leaving the place to come back to. */
  const openLinked = (id: string) => {
    const f = Object.hasOwn(model.flows, id) ? model.flows[id] : undefined
    if (!playing || !f || f.steps.length === 0 || !isView(model, f.view)) return // a flow whose view can't open can't play
    if (f.view !== view) go(f.view)
    setPlaying({ flow: id, step: 0, trail: leaveFlow(playing.trail ?? [], { flow: playing.flow, step: stopIndex }) })
  }
  /** Back to the flow this one was opened from, at the stop the reader left. */
  const goBack = () => {
    const closed = closeFlow(playing?.trail ?? [])
    const parent = closed && Object.hasOwn(model.flows, closed.back.flow) ? model.flows[closed.back.flow] : undefined
    if (!closed || !parent || !isView(model, parent.view)) return setPlaying(undefined) // the flow it came from is gone, or can't play any more
    if (parent.view !== view) go(parent.view)
    setPlaying({ flow: closed.back.flow, step: closed.back.step, ...(closed.trail.length > 0 ? { trail: closed.trail } : {}) })
  }
  // Autoplay: a step that doesn't move waits a moment, then each finished step is followed by the next. Taking a step yourself stops it.
  useEffect(() => {
    if (!playing?.auto || moving) return
    const wait = setTimeout(() => setSettledKey(stepKey), DWELL)
    return () => clearTimeout(wait)
  }, [playing?.auto, moving, stepKey])
  useEffect(() => {
    if (!playing?.auto || !flow || settledKey !== stepKey) return
    const wait = setTimeout(() => setPlaying(stopIndex < stops.length - 1 ? { ...playing, step: stopIndex + 1 } : { ...playing, auto: false }), GAP)
    return () => clearTimeout(wait)
  }, [playing?.auto, settledKey, stepKey])
  // Ramp: the load sweeps up through the tested levels on its own, with a frame for each step of the screen.
  useEffect(() => {
    if (!ramping || !loadTest) return
    let last = performance.now()
    let shown = last // when the screen last got a position
    let frame = 0
    const tick = (t: number) => {
      const ms = Math.min(100, t - last) // a tab that was asleep doesn't jump
      const next = multi ? rampActive(dials, posNow.current, activeDial, ms) : [rampPos(loadTest, posNow.current[0], ms)]
      last = t
      posNow.current = next
      const done = multi ? next[activeDial] >= dialTop(dials[activeDial]) : next[0] >= top(loadTest)
      if (done || t - shown >= RAMP_STEP_MS) {
        shown = t
        setPositions(next)
      }
      if (done) setRamping(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ramping, loadTest, multi, dials, activeDial])
  useEffect(() => {
    if (!perfOpen) setRamping(false)
  }, [perfOpen])
  // Ramp a dial (the active one when none is named), or stop the ramp that runs on it. Pressing another dial's button moves the ramp there.
  const toggleRamp = (dial = activeDial) => {
    if (!loadTest || still) return
    if (ramping && dial === activeDial) {
      setPositions(posNow.current) // where it has got to, not where the screen last was
      return setRamping(false)
    }
    setActive(dial) // a ramp is of the dial it was started on
    const from = multi ? rampFromActive(dials, posNow.current, dial) : [rampFrom(loadTest, posNow.current[0])] // at the top, a ramp starts again from the bottom
    posNow.current = from // the ramp reads it before the next render
    setPositions(from)
    setRamping(true)
  }
  // To a tested level of the active dial (or of the dial named): the arrow keys and Home and End.
  const stepLevel = (to: number, dial = activeDial) => {
    if (!loadTest) return
    setRamping(false)
    if (multi) {
      setActive(dial)
      setPositions(placeActive(dials, here, dial, Math.round(clampDial(dials[dial], to))))
    } else setPositions([snap(loadTest, to)])
  }
  // Go to a place with every dial at its position (Go there), at tested levels.
  const placeAll = (to: number[]) => {
    if (!loadTest) return
    setRamping(false)
    setPositions(multi ? dials.map((d, i) => clampDial(d, to[i] ?? 0)) : [snap(loadTest, to[0] ?? 0)])
  }
  // Anywhere along the run, not only at a level: a click on an event. The states move to it, as they do for a step.
  const jumpTo = (to: number) => {
    if (!loadTest) return
    setRamping(false)
    setPositions([clampPos(loadTest, to)])
  }
  // The slider of a dial is being dragged: the states follow at once, and for a moment after the last move (a drag is many moves), so the shapes don't fade behind the thumb.
  const slide = (to: number, dial = activeDial) => {
    if (!loadTest) return
    setScrubbing(true)
    clearTimeout(scrubTimer.current)
    scrubTimer.current = setTimeout(() => setScrubbing(false), SCRUB_MS)
    if (multi) {
      setRamping(false)
      setActive(dial)
      setPositions(placeActive(dials, here, dial, to))
    } else jumpTo(to)
  }
  const pickLines = (value: string) => {
    const style = LINE_STYLES.find(s => s === value)
    if (style === undefined) return
    const own = (s: LineStyle | undefined) => {
      keepOwnLines(s)
      setMine(s)
    }
    // In edit mode the project's style is what you see, so once it's saved your own choice goes.
    if (editing) void run(m => setLines(m, style)).then(saved => saved && own(undefined))
    else own(style === projectLines ? undefined : style) // the project's own style isn't kept as a pick: the screen follows the project again
  }
  const toggleEdit = () => {
    justMoved.current = false
    quiet.current = true // E isn't a step to go back to
    setEditMode(!editing)
    setPerf(false) // editing and the Performance panel don't mix: the numbers would sit on a model that is changing
    setNotice(undefined) // "Press E to fix this flow" is stale the moment E is pressed
    setPlaying(undefined)
    setSide(s => (s?.kind === 'object' || s?.kind === 'line' ? s : undefined))
  }
  // Pressing on a box that isn't one of several picked starts over with that box alone. Otherwise dragging it would carry the others along.
  const pressBox = (e: ReactPointerEvent<HTMLElement>) => {
    if (!editing || side?.kind !== 'objects') return
    const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.react-flow__node-box')?.dataset.id : undefined
    if (id !== undefined && !keepsSelection(side.ids, id, addsToSelection(e))) setSide(undefined)
  }
  const remove = () => {
    // One edit for the lot, so one undo brings them all back, and a shape that can't go (it has things inside, or a flow uses it) stops them all.
    if (side?.kind === 'object' || side?.kind === 'objects') void run(m => deleteObjects(m, chosen)).then(saved => saved && close())
    if (side?.kind !== 'line') return
    const merged = connectionsOf(model, view, side.from, side.to)
    if (merged.length > 1) return setNotice(`This line stands for ${merged.length} connections. Delete them one at a time in the panel.`)
    const c = merged[0]?.connection
    if (c) void run(m => removeConnection(m, { from: c.from, to: c.to, label: c.label ?? '' })).then(saved => saved && close())
  }
  const jump = (p: Problem) => {
    const spot = locate(model, p)
    go(spot.view)
    if (spot.failure) {
      setAnalysisId(spot.failure.analysis)
      setModeId(spot.failure.mode)
      setFilter({})
      setSide(undefined)
      return openFailures()
    }
    if (spot.object) show({ kind: 'object', id: spot.object })
    else if (spot.line) show({ kind: 'line', from: spot.line[0], to: spot.line[1] })
    else if (spot.flow !== undefined && editing) show({ kind: 'flow', id: spot.flow, name: model.flows[spot.flow].name })
    else if (spot.flow !== undefined) {
      // The player only lists flows with steps in a view that opens (flowsHere); locate() falls back to ROOT for a bad view.
      const f = model.flows[spot.flow]
      if (f.view === spot.view && f.steps.length > 0) setPlaying({ flow: spot.flow, step: stopIndexOf(stopsOf(f), spot.step ?? 0) })
      else setNotice(readOnly ? `This flow can't play yet. Fix ${p.file} first.` : 'Press E to fix this flow in edit mode.')
    }
  }
  // A drag (or an arrow key on a selected box) ends with dragging: false. Then the whole view's layout is saved.
  const onNodesChange = (changes: NodeChange<BoxNode | FrameNode>[]) => {
    // The browser measured a box: keep it, so the next render hands it back instead of hiding its lines.
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sizes.current.set(c.id, c.dimensions)
    // Drawing a box round shapes: the ones it takes in are the selection. Boxes outside this view's own (the people and systems around it) stay out.
    if (banding.current) setSide(sideFor(banded(chosen, changes, new Set(graph.members))))
    const moves = changes.flatMap(c => (c.type === 'position' && c.position ? [{ ...c, position: c.position }] : []))
    if (moves.length === 0) return
    const next = new Map(moved)
    for (const c of moves) next.set(c.id, c.position)
    setMoved(next)
    if (moves.some(c => c.dragging)) return
    const boxes = Object.fromEntries(nodes.map(n => {
      const { x, y } = next.get(n.id) ?? n.position
      return [n.id, [Math.round(x), Math.round(y)] as [number, number]]
    }))
    // Arrow keys queue a save per press. Clearing `moved` after an early one would snap the box back mid-way.
    layoutSaves.current++
    void run(m => placeBoxes(m, view, boxes)).then(saved => {
      layoutSaves.current--
      if (layoutSaves.current === 0) setMoved(new Map())
      justMoved.current = saved
    })
  }

  // The address names the view and the flow playing, so a link opens there and Back goes back. It's checked
  // on every render. A step the reader takes pushes an entry. Anything else replaces the address: the page
  // opening (which also drops a part that named nothing), Back or a typed address, E, or a live reload that
  // falls back to another view.
  const failuresAt = failuresOpen && analysisKey !== undefined ? { analysis: analysisKey, ...(mode ? { mode: modeId } : {}) } : undefined
  // The address of a run with several sources keeps a place between two loads (to two decimals) while the screen stands still, and rounds to a load during a ramp, which would otherwise rewrite it every step.
  const perfAt = perfOpen ? (multi ? { run: runKey, level: Math.round(here[0]), levels: here.map(p => (ramping ? Math.round(p) : Math.round(p * 100) / 100)) } : { run: runKey, level: Math.round(here[0]) }) : undefined
  const address = toHash(view, flow ? playing?.flow : undefined, perfAt, failuresAt)
  useEffect(() => {
    if (quiet.current || address !== location.hash) {
      const was = readHash(location.hash)
      const alongRun = perfOpen && was.perf?.run === runKey && was.view === view // moving along a run is not a step to go back to
      // Nor is picking another mode, even one that moves the canvas to its view. A zoom with a mode picked is a step: same mode, another view.
      history[quiet.current || view !== viewId || alongRun || alongFailures(was.failures, failuresAt) ? 'replaceState' : 'pushState'](null, '', address || location.pathname + location.search)
    }
    quiet.current = false
    saveState({ hash: address }) // a VS Code panel that is restored opens where the reader was
  })

  // Back, Forward, or an address typed in: show what it names. Added again on every render, like the keys below.
  useEffect(() => {
    const follow = () => {
      quiet.current = true
      const named = readHash(location.hash)
      go(named.view)
      if (named.flow !== undefined) {
        // Back arrives twice (popstate, then hashchange), and the second must not undo the first: a flow already playing stays where it is.
        if (playing?.flow === named.flow) setPlaying(playing)
        else {
          const back = followBack(playing?.trail ?? [], named.flow) // Back lands on the stop the reader left, when it is the flow they came from
          setPlaying({ flow: named.flow, step: back.step, ...(back.trail.length > 0 ? { trail: back.trail } : {}) })
        }
      }
      setRamping(false)
      if (named.perf !== undefined && Object.hasOwn(runs, named.perf.run)) {
        setRunId(named.perf.run)
        setPositions(startPositions(named.perf.run, named.perf.level, named.perf.levels))
        setActive(0)
        openPerf()
      } else setPerf(false)
      if (named.failures !== undefined && Object.hasOwn(model.failures, named.failures.analysis)) {
        const m = modeIn(model, named.failures.analysis, named.failures.mode)
        setAnalysisId(named.failures.analysis)
        setModeId(m ? named.failures.mode : undefined)
        if (m) setSide(undefined) // a picked shape would narrow the list to what it carries, and the mode named here may not be in it
        openFailures()
        if (m && !drawnIn(model, named.view, m)) go(homeView(model, m)) // the mode's part is outside the view the address names
      } else setNavTab(t => (t === 'failures' ? undefined : t))
    }
    window.addEventListener('popstate', follow)
    window.addEventListener('hashchange', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      window.removeEventListener('hashchange', follow)
    }
  })

  // Where the last click landed: in the navigator, Escape closes it; anywhere else (the diagram, Details, the bar), it leaves the navigator be.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      navUsed.current = e.target instanceof Element && e.target.closest('.navpanel') !== null
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [])

  // Added again on every render, so the handler always sees the current state.
  useEffect(() => {
    // The list ? shows (Shortcuts.tsx) follows this handler: keep the two in step.
    const onKey = (e: KeyboardEvent) => {
      const key = letter(e)
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey
      const control = (e.ctrlKey || e.metaKey) && !e.repeat // held down, undo or redo would run through the whole stack
      const inNavigator = e.target instanceof Element && e.target.closest('.navpanel') !== null
      // A field keeps its keys, except the load slider: its arrows and Home and End are the tab's own, so they work right after it was used.
      // The navigator's filters clear themselves on Escape and stop it, so one that gets here is empty: a click in it lets Escape close the navigator.
      // A field in the Failures tab's forms keeps its Escape: a half-filled form is not thrown away by it.
      if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (!(e.key === 'Escape' && inNavigator && e.target instanceof HTMLInputElement && e.target.closest('.navfind') !== null)) return
      }
      // A second press while a zoom out is still leaving goes up from where that one is heading.
      const up = () => zoomOut(parentOf(model, motion?.phase === 'leave' && motion.dir === 'out' ? motion.to : view))
      if (undoesMove(e, { editing, justMoved: justMoved.current, shortcuts, plain })) {
        void takeBack()
      }
      else if (e.key === 'Escape') {
        const navigator = nav !== undefined && (navUsed.current || inNavigator)
        const layer = escapeStep({ shortcuts, navigator, flow: flow !== undefined, halfStep: recording?.from !== undefined, panel: rightOpen || manyPicked, inside: view !== ROOT })
        if (layer === 'shortcuts') setShortcuts(false)
        else if (layer === 'navigator') setTab(undefined)
        else if (layer === 'flow') setPlaying(undefined)
        else if (layer === 'step' && recording) setSide({ ...recording, from: undefined, to: undefined })
        else if (layer === 'panel') {
          if (perfOpen) closePerf()
          else closeDetails()
        }
        else if (layer === 'up') up()
        else return
      }
      else if (perfOpen && e.key === 'ArrowRight') stepLevel(stepFrom(here[activeDial], 1))
      else if (perfOpen && e.key === 'ArrowLeft') stepLevel(stepFrom(here[activeDial], -1))
      else if (perfOpen && e.key === 'Home') stepLevel(0)
      else if (perfOpen && loadTest && e.key === 'End') stepLevel(multi ? dialTop(dials[activeDial]) : top(loadTest))
      else if (perfOpen && key === 'p' && plain && !e.repeat) toggleRamp()
      // In edit mode the arrow keys nudge a picked shape, so the list is stepped with them only outside it.
      else if (failuresOpen && !editing && analysis && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        selectMode(neighbour([...rows.here, ...rows.elsewhere].map(r => r.id), mode ? modeId : undefined, e.key === 'ArrowRight' ? 1 : -1))
      }
      else if (flow && e.key === 'ArrowRight') stepTo(stopIndex + 1)
      else if (flow && e.key === 'ArrowLeft') stepTo(stopIndex - 1)
      else if (flow && e.key === 'Home') stepTo(0)
      else if (flow && e.key === 'End') stepTo(stops.length - 1)
      else if (flow && key === 'p' && plain && !e.repeat) togglePlay()
      else if (flow && key === 'r' && plain && !e.repeat) setReplays(n => n + 1)
      else if (e.key === 'Enter' && !recording && !takesEnter(e.target as Element | null)) {
        // The box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel.
        const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.react-flow__node-box')?.dataset.id ?? selectedBox
        if (id === undefined) return
        if (canOpen(id)) zoomInto(id)
        else show({ kind: 'object', id })
      }
      // ? before the slash key's fallback: some layouts type ? on that key without Shift.
      else if (e.key === '?') setShortcuts(open => !open)
      else if ((key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/' || (e.code === 'Slash' && !e.shiftKey)) setSearching(true)
      else if (key === 'f' && plain) fitNow.current?.({ ...fitOptions(detailsOpen ? detailsWidth : 0, flow !== undefined, nav ? navWidth : 0), duration: 300 })
      else if (key === 'l' && plain && !e.repeat && showFlows) toggleTab('flows')
      else if (key === 'o' && plain && !e.repeat) toggleTab('explorer')
      else if (key === 'y' && plain && !e.repeat && showYaml) toggleTab('yaml')
      else if (key === 't' && plain && !e.repeat && canPerf) (perfOpen ? closePerf() : openPerf())
      else if (key === 'm' && plain && !e.repeat && showFailures) (failuresOpen ? closeFailures() : openFailures())
      else if (key === 'e' && plain && !e.repeat && !readOnly) toggleEdit()
      else if (editing && key === 'n' && plain && !recording) show({ kind: 'add' })
      else if (editing && e.key === 'Delete') remove()
      else if (editing && control && key === 'a' && !recording) show(sideFor(graph.members))
      else if (editing && control && ((key === 'z' && e.shiftKey) || key === 'y')) void bringBack()
      else if (editing && control && key === 'z') void takeBack()
      // Z zooms out, always: Esc and Backspace may be busy taking a drag back, and going up should stay one key away.
      else if ((e.key === 'Backspace' || (key === 'z' && plain)) && view !== ROOT && !recording) up()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** What the canvas can give one panel: all of it but a strip to look at, and what the other panel takes. */
  const spare = (other: number) => (canvas.current?.clientWidth ?? Infinity) - 160 - other
  const navTabs = <NavTabs tab={nav ?? 'explorer'} showFlows={showFlows} showYaml={showYaml} showFailures={showFailures} onPick={pickTab} />
  // Putting a version back from the YAML tab: the notice says which, and a shape dragged earlier shows where the file says.
  const restoreVersion = async (id: string, seen: Record<string, string | null>, label: string) => {
    justMoved.current = false
    setNotice(undefined)
    const message = await restore(id, seen, label)
    setNotice(message ?? `${label}.`)
    setMoved(new Map())
    return message
  }
  const clearHistory = async () => {
    await historyApi?.clear()
    await yamlStore?.refresh()
  }
  return (
    <>
      <header className="bar">
        <nav className="crumbs" aria-label="Zoom level">
          {chain(model, view).reverse().map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <ChevronRight size={14} />}
              <button disabled={id === view} onClick={() => zoomOut(id)}>{i === 0 && <Home size={16} />}{nameOf(model, id)}</button>
            </Fragment>
          ))}
        </nav>
        {editing && <button onClick={() => show({ kind: 'flow', id: '', name: '' })}><Route size={16} />New flow</button>}
        {editing && <button onClick={() => show({ kind: 'add' })}><Plus size={16} />Add</button>}
        {editing && <button className="icon" aria-label="Undo" title="Undo the last change (Ctrl+Z)" onClick={() => void takeBack()}><Undo size={16} /></button>}
        {editing && <button className="icon" aria-label="Redo" title="Redo what you undid (Ctrl+Y or Ctrl+Shift+Z)" onClick={() => void bringBack()}><Redo size={16} /></button>}
        {editing && (
          <button title="Forget where shapes here were dragged, and lay this view out again" onClick={() => void run(m => forgetLayout(m, view)).then(saved => {
            if (!saved) return
            setMoved(new Map())
            setTidied(n => n + 1)
          })}>
            <Grid size={16} />Tidy
          </button>
        )}
        <span className="grow" />
        <select aria-label="Line style" value={lines}
          title={editing ? 'How lines look for everyone (saved in model.yaml)' : 'How lines look on this screen'}
          onChange={e => {
            pickLines(e.target.value)
            e.target.blur()
          }}>
          {LINE_STYLES.map(s => <option key={s} value={s}>Lines: {LINE_NAMES[s]}</option>)}
        </select>
        {/* mousedown would blur the open field, closing it, and the click would open it again */}
        <button title="Find a shape (Ctrl+K or /)" aria-pressed={searching} onMouseDown={e => searching && e.preventDefault()} onClick={() => setSearching(!searching)}><SearchIcon size={16} />Search</button>
        <button title="Copy this view, or the flow playing, as a Mermaid diagram" onClick={() => void copyMermaid()}><Copy size={16} />Mermaid</button>
        <button className="icon" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-pressed={shortcuts} onClick={() => setShortcuts(!shortcuts)}><Keyboard size={16} /></button>
        <Problems problems={problems} onPick={jump} />
        {live && <button className="toggle" aria-pressed={editing} disabled={readOnly} title="Edit mode (E)" onClick={toggleEdit}><Pencil size={16} />Edit</button>}
      </header>
      <div className="stage">
        <NavRail tab={nav} flows={totals.flows} shapes={totals.shapes} modes={modeCount(model)} showFlows={showFlows} showYaml={showYaml} showFailures={showFailures} onPick={toggleTab} />
        <main ref={canvas} onPointerDownCapture={pressBox} className={['canvas', editing && 'editing', nav && 'nav', loadTraffic && 'loaded', failuresOpen && 'failing', ((flow && usesStates(flow)) || timeEvents) && 'states', scrubbing && 'scrubbing', motion && `${motion.phase}-${motion.dir}`].filter(Boolean).join(' ')}
          style={{ '--nav-w': `${navWidth}px`, '--panel-w': `${detailsWidth}px`, ...(motion && { '--ox': `${motion.x}px`, '--oy': `${motion.y}px`, '--dx': `${motion.dx}%`, '--dy': `${motion.dy}%` }) } as CSSProperties}>
          <LineStyleContext value={lines}>
            <LineWidthsContext value={widths}>
            <LineMarksContext value={lineMarks}>
            <ReactFlow
              key={view} // a fresh canvas per view
              nodes={[...frame, ...nodes]}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              minZoom={0.2} // the default 0.5 stops the fit short, so a wide diagram in a small window is cut off
              colorMode={colorMode}
              defaultMarkerColor="var(--edge)"
              nodesDraggable={editing && !recording}
              nodesConnectable={editing && !recording}
              zoomOnDoubleClick={false}
              deleteKeyCode={null}
              selectionKeyCode={editing && !recording ? 'Shift' : null} // Shift and drag on the empty canvas draws a box round shapes to pick them
              onSelectionStart={() => {
                banding.current = true
                justMoved.current = false
                cancelOpen()
              }}
              onSelectionEnd={() => {
                banding.current = false
              }}
              onNodesChange={onNodesChange}
              isValidConnection={c => placeEnds(model, view, c.source, c.target) !== null} // only lines this view can show
              onConnect={c => void run(m => connect(m, { from: c.source, to: c.target }))
                .then(saved => saved && show({ kind: 'line', from: c.source, to: c.target }))}
              onNodeClick={(e, node) => {
                if (node.type !== 'box') return // the frame takes no pointer events, this is a guard
                justMoved.current = false
                const waiting = openingBox.current
                cancelOpen()
                if (recording) return setSide({ kind: 'flow', ...pick(recording, node.id) })
                // Ctrl, Cmd or Shift adds the box to the shapes picked, or takes it out again. A box clicked a moment ago is picked too, though its panel hasn't opened yet.
                if (editing && addsToSelection(e)) return show(sideFor(toggled(waiting === undefined ? chosen : [waiting], node.id)))
                if (side?.kind === 'object' && side.id === node.id) return closeDetails() // its panel is already open: a second click closes it
                const open = () => show({ kind: 'object', id: node.id })
                // Zooming into a box is a double-click, and its first click must not open the panel. With a panel already open there's
                // nothing to open, only its box to change, so that goes at once: no wait between one box and the next.
                if (canOpen(node.id) && side === undefined) {
                  openingBox.current = node.id
                  opening.current = setTimeout(() => {
                    openingBox.current = undefined
                    open()
                  }, DOUBLE_CLICK)
                } else open()
              }}
              onNodeDoubleClick={(e, node) => {
                if (recording || node.type !== 'box' || !canOpen(node.id) || addsToSelection(e)) return
                zoomInto(node.id)
              }}
              onInit={instance => {
                fitNow.current = options => void instance.fitView(options)
              }}
              onEdgeClick={(_, e) => {
                justMoved.current = false
                if (recording || isStepLine(e.id)) return
                if (selectedLine === e.id) closeDetails() // its panel is already open: a second click closes it
                else show({ kind: 'line', from: e.source, to: e.target })
              }}
              onEdgeMouseEnter={(_, e) => setHovered(e.id)}
              onEdgeMouseLeave={() => setHovered(undefined)}
              onPaneClick={() => {
                justMoved.current = false
                cancelOpen()
                setSide(recording ? { ...recording, from: undefined, to: undefined } : undefined)
              }}
            >
              <Camera count={nodes.length + frame.length} fitKey={`${view} ${flow ? playing?.flow : ''} ${tidied}`} player={flow !== undefined} reveal={selectedBox} panel={detailsWidth} nav={nav ? navWidth : 0} />
              {/* The fit button reads its own options, not ReactFlow's fitViewOptions. Camera does the automatic fits. */}
              <Controls showInteractive={false} fitViewOptions={fitOptions(rightOpen ? detailsWidth : 0, flow !== undefined, nav ? navWidth : 0)} />
              {loadTraffic && !still && <TrafficLayer lines={loadTraffic.lines} style={lines} />}
              {flow && stop && animated.map(m => (
                <StepMotion key={`${stepKey}:${m.i}`} ends={m.placed} animation={m.animation} by={m.by} afterLanding={stop.before.some(j => followsLanding(shown?.ends[j], m.placed))} repeat={repeat} onDone={() => finished(m.i)} />
              ))}
              {flow && <GroupMarks marks={marks} />}
            </ReactFlow>
            </LineMarksContext>
            </LineWidthsContext>
          </LineStyleContext>
          {nodes.length === 0 && (
            <p className="empty">{editing
              ? 'Nothing here yet. Press Add to put the first shape here.'
              : live
                ? 'Nothing here yet. Ask Claude to map this repo into Flowy, press E to draw it yourself, or add YAML to the flowy/ folder.'
                : 'Nothing here yet.'}</p>
          )}
          {searching && (
            <Search model={model} onClose={() => setSearching(false)} onPick={id => {
              setSearching(false)
              go(parentOf(model, id)) // the view the box sits in
              show({ kind: 'object', id })
            }} />
          )}
          {shortcuts && <Shortcuts editable={live && !readOnly} performance={canPerf} failures={showFailures} onClose={() => setShortcuts(false)} />}
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button aria-label="Dismiss" onClick={() => setNotice(undefined)}><Close size={16} /></button>
            </div>
          )}
          {detailsOpen && (side?.kind === 'object' || (side === undefined && view !== ROOT)) && (
            <ObjectPanel model={model} id={side?.kind === 'object' ? side.id : view} editing={editing} problems={problems} codeBase={codeBase} run={run} onClose={closeDetails} state={side?.kind === 'object' && Object.hasOwn(stateMarks, side.id) ? stateMarks[side.id] : undefined}
              onPick={id => setSide({ kind: 'object', id })} onHover={setHovered} />
          )}
          {detailsOpen && side === undefined && view === ROOT && <OverviewPanel totals={totals} onClose={closeDetails} />}
          {detailsOpen && side?.kind === 'line' && (
            <LinePanel model={model} view={view} from={side.from} to={side.to} editing={editing} problems={problems} run={run} onClose={closeDetails} />
          )}
          {editing && side?.kind === 'objects' && <PickedBar count={side.ids.length} onDelete={remove} onClear={closeDetails} />}
          {detailsOpen && editing && side?.kind === 'add' && (
            <AddPanel model={model} view={view} run={run} onAdded={id => setSide({ kind: 'object', id })} onClose={closeDetails} />
          )}
          {detailsOpen && recording && (
            <Recorder model={model} view={view} rec={recording} onChange={rec => setSide({ kind: 'flow', ...rec })} run={run} onClose={closeDetails} />
          )}
          {perfOpen && (
            <aside className="panel perfpanel">
              <button className="close" aria-label="Close" onClick={closePerf}><Close size={16} /></button>
              <PerfBody model={model} view={view} runs={runs} runProblems={runProblems} runId={runKey} positions={here} active={activeDial} lines={drawnLines} ramping={ramping} still={still} states={marksHere}
                selection={side?.kind === 'object' || side?.kind === 'line' ? side : undefined}
                onRun={id => {
                  setRamping(false)
                  setRunId(id)
                  setPositions(startPositions(id))
                  setActive(0)
                }}
                onActive={setActive} onSlide={(dial, to) => slide(to, dial)} onJump={jumpTo} onPlace={placeAll} onRamp={toggleRamp} />
            </aside>
          )}
          {nav === 'flows' && (
            <NavPanel tabs={navTabs} onClose={() => setTab(undefined)}>
              <FlowsTab model={model} view={view} editing={editing} current={recording?.id || (flow ? playing?.flow : undefined)} onOpen={f => openFlow(f.id)} />
            </NavPanel>
          )}
          {nav === 'explorer' && (
            <NavPanel tabs={navTabs} onClose={() => setTab(undefined)}>
              <Explorer model={model} problems={problems} editing={editing} expanded={expanded} onToggle={toggleOpen} here={view} selected={selectedBox}
                playing={flow ? playing?.flow : undefined} onPick={pickRow} onOpen={openRow} />
            </NavPanel>
          )}
          {nav === 'failures' && (
            <NavPanel tabs={navTabs} onClose={closeFailures}>
              <FailuresBody model={model} view={view} runs={runs} problems={problems} failureProblems={failureProblems} analysisId={analysisKey} modeId={mode ? modeId : undefined}
                rows={rows} filter={filter} part={part}
                onAnalysis={id => {
                  setAnalysisId(id)
                  setModeId(undefined)
                  setFilter({})
                }}
                onMode={selectMode} onFilter={setFilter} onClearPart={() => setSide(undefined)} onPickShape={pickShape}
                onShowFlow={showFlow} onSeenInRun={seenInRun} onCopy={copyFailures} editing={editing} run={run} />
            </NavPanel>
          )}
          {nav === 'yaml' && yamlStore && (
            <NavPanel tabs={navTabs} onClose={() => setTab(undefined)}>
              <Yaml store={yamlStore}editing={editing} broken={broken} flow={recording?.id || (flow ? playing?.flow : undefined) || undefined} selected={selectedBox}
                onRestore={restoreVersion} onClear={clearHistory} />
            </NavPanel>
          )}
          {nav && <Sash side="nav" width={navWidth} onResize={w => setNavWidth(clampWidth(w, spare(rightOpen ? detailsWidth : 0)))} onReset={() => setNavWidth(NAV)} />}
          {rightOpen && <Sash side="details" width={detailsWidth} onResize={w => setDetailsWidth(clampWidth(w, spare(nav ? navWidth : 0)))} onReset={() => setDetailsWidth(PANEL)} />}
          {flow && stop && caption && progress && (
            <Player model={model} flow={flow} stops={stops} stop={stopIndex} ends={shown?.ends ?? []} caption={caption} progress={progress} marks={marksHere} auto={playing?.auto === true} moving={moving}
              trail={trail} onStep={stepTo} onAuto={togglePlay} onReplay={() => setReplays(n => n + 1)} repeat={repeat} onRepeat={toggleRepeat} onStop={() => setPlaying(undefined)} onOpenFlow={openLinked} onBack={goBack} />
          )}
        </main>
        <DetailsRail open={detailsOpen} onToggle={() => { if (detailsOpen) closeDetails(); else { setPerf(false); setDetails(true) } }}
          perf={showPerf ? { open: perfOpen, runs: Object.keys(runs).length, off: editing ? 'not while editing' : undefined, onToggle: () => (perfOpen ? closePerf() : openPerf()) } : undefined} />
      </div>
    </>
  )
}
