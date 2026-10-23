import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { ReactFlow } from '@xyflow/react'
import type { Edge, FitViewOptions, NodeChange, ReactFlowInstance } from '@xyflow/react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/problem.ts'
import { compareOf } from '../../src/core/compare.ts'
import { getObject, LINE_STYLES, lineStyle, ROOT } from '../../src/core/model.ts'
import type { LineStyle, Model } from '../../src/core/model.ts'
import { dependents, needsDecision } from '../../src/core/dependents.ts'
import type { Target } from '../../src/core/dependents.ts'
import { connect, deleteWith, moveFlow, placeBoxes, setLines, tidyLayout } from '../../src/core/ops.ts'
import { flowToMermaid, viewToMermaid } from '../../src/core/mermaid.ts'
import { followsLanding, leavesMarks } from '../../src/core/animation.ts'
import { usesStates } from '../../src/core/states.ts'
import { stopIndexOf, stopsOf } from '../../src/core/structure.ts'
import type { LineTraffic } from '../../src/core/perf/types.ts'
import { drawnIn, homeView, lightFor, rollUp, table } from '../../src/core/failures.ts'
import type { Mark, Part } from '../../src/core/failures.ts'
import { expandTo, outline } from '../../src/core/outline.ts'
import type { OutlineRow } from '../../src/core/outline.ts'
import { chain, hasChildren, isView, nameOf, parentOf, placeEnds, stepEnds } from '../../src/core/views.ts'
import { Box, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { ZoomControls } from './ZoomControls.tsx'
import { Alert, ArrowLeft, ArrowRight, ChevronRight, Close, Copy, Grid, Home, Keyboard, Pencil, Plus, Redo, Route, Search as SearchIcon, Undo } from './icons.tsx'
import { connectionsOf, locate, moveBetween } from './edit.ts'
import { DOUBLE_CLICK, fitOptions, focusEdges, frameNode, isStepLine, lineId, NAV, PANEL, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode } from './graph.ts'
import { addressChange, readHash, runAddress, toHash } from './hash.ts'
import { compareOff, draftKey, firstLinked, firstLinkedRun, flipped, fromAddress, keepsDrafts, noteOf, noteOff, openable, pairKey, pairOf, playable, runCompareOff, runPairOf, unsaved, withDraft } from './compare.ts'
import type { Compare, Drafts } from './compare.ts'
import { CompareView } from './CompareView.tsx'
import type { CompareHandle } from './CompareView.tsx'
import { ComparePicker } from './ComparePicker.tsx'
import type { PickAt } from './ComparePicker.tsx'
import { contextOf, dispatch } from './keymap.ts'
import type { KeyActions, KeyState } from './keymap.ts'
import { activeAnalysis, firstErrorAt, modeCount, modeIn, neighbour, rowsFor } from './failuresview.ts'
import type { Filter } from './failuresview.ts'
import { FailuresBody } from './Failures.tsx'
import { createHoverStore, LabelSpots, Line, LineHover, LineMarksContext, labelSpots, LineStyleContext, LineWidthsContext } from './Line.tsx'
import { TrafficLayer } from './TrafficLayer.tsx'
import { keepOwnLines, LINE_NAMES, ownLines } from './lines.ts'
import { clampWidth, openTab } from './navstate.ts'
import type { NavTab } from './navstate.ts'
import { keepNav, loadNav } from './navstore.ts'
import { compareRowAttr, DetailsRail, Explorer, FlowsTab, NavPanel, NavRail, NavTabs, NavTitle, Sash } from './Navigator.tsx'
import { PerfBody } from './Performance.tsx'
import { RunLinks } from './RunLinks.tsx'
import { clampPos, dialTop, starterRun, stepFrom, top } from './perfview.ts'
import { AddPanel, LinePanel, ObjectPanel, OverviewPanel } from './Panel.tsx'
import type { Delete } from './Panel.tsx'
import { UsedBy } from './UsedBy.tsx'
import { doneText, planOf } from './usedby.ts'
import { Recorder } from './Recorder.tsx'
import { PickedBar } from './PickedBar.tsx'
import { addsToSelection, banded, keepsSelection, toggled } from './selection.ts'
import { Search } from './Search.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import { keepSame, nothingKept, useLatest } from './stable.ts'
import type { Kept } from './stable.ts'
import { StepMotion } from './StepMotion.tsx'
import { GroupMarks } from './GroupMarks.tsx'
import { Player } from './Player.tsx'
import { cameBack, remember } from './levels.ts'
import type { Levels } from './levels.ts'
import { cameFrom, closeFlow, followBack, openFlow as leaveFlow } from './trail.ts'
import type { Recording } from './Recorder.tsx'
import { copyMessage } from '../../src/core/host.ts'
import { saveState, vscode } from './host.ts'
import { ModelPicker } from './ModelPicker.tsx'
import { fetchModels } from './models.ts'
import type { ModelList } from './models.ts'
import { useReveal } from './reveal.ts'
import { useColorMode } from './hosttheme.ts'
import { createHistoryStore } from './historystore.ts'
import { noHistory } from './yamlview.ts'
import { clearOutcome } from './historyclient.ts'
import type { HistoryClient } from './historyclient.ts'
import { useModel } from './useModel.ts'
import type { Tag } from './useModel.ts'
import { useEditSession } from './useEditSession.ts'
import { usePerfRun } from './usePerfRun.ts'
import { useRunDrawing } from './useRunDrawing.ts'
import { usePlayback, usePlayer } from './usePlayer.ts'
import { useFlowStage } from './useFlowStage.ts'
import { useZoom } from './useZoom.ts'
import type { Edit, Loaded, Restore } from './useModel.ts'
import { Yaml } from './Yaml.tsx'

const nodeTypes = { box: Box, frame: Frame }
const NO_LINES: LineTraffic[] = [] // and no traffic, so the Performance panel's key is not rebuilt for it
const edgeTypes = { line: Line }
/** What the side panel shows. One thing at a time. */
type Side =
  | { kind: 'object'; id: string }
  | { kind: 'objects'; ids: string[] } // several shapes picked in edit mode, to move or delete together
  | { kind: 'line'; from: string; to: string; view?: string } // `view` is the view of the pane of a comparison it was clicked in; on the single canvas it is the one on show
  | { kind: 'add' }
  | { kind: 'usedby'; targets: Target[]; back: Side | undefined } // what is waiting on the shapes or lines about to be deleted (see UsedBy)
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
  const { loaded, banner, edit, undo, redo, restore, tag, history, changes, live } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {loaded && <Reader {...loaded} edit={edit} undo={undo} redo={redo} restore={restore} tag={tag} historyApi={history} changes={changes} live={live} readOnly={!live || banner !== undefined} broken={banner !== undefined} />}
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

function Reader({ model, problems, codeBase, runs, runProblems, failureProblems, edit, undo, redo, restore, tag, historyApi, changes, live, readOnly, broken }: Loaded & {
  edit: Edit; undo: Back; redo: Back; restore: Restore; tag: Tag; historyApi?: HistoryClient; changes: number; live: boolean; readOnly: boolean; broken: boolean
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
  // Two flows side by side (see CompareView), named by the address. While one is open the single canvas and its flow player wait behind it, as they do behind the Performance and Failures tabs.
  /** Whether both sides of a comparison are there to open: flows that play, or runs. */
  const comparable = (c: Compare) => (c.kind === 'run' ? openable(runs, c.a) && openable(runs, c.b) : playable(model, c.a) && playable(model, c.b))
  const [compare, setCompare] = useState<Compare | undefined>(() => fromAddress(model, runs, readHash(location.hash).compare).compare)
  // The stop the flow that was playing was at when the comparison opened: its pane starts there.
  const [compareStart, setCompareStart] = useState<{ flow: string; step: number }>()
  const [picking, setPicking] = useState(false) // the popover of the player's Compare button
  const [rowPicking, setRowPicking] = useState<{ flow: string; at: PickAt }>() // the popover of a flow row's Compare button, in the Flows tab or the Explorer
  const [pickingRun, setPickingRun] = useState<'compare'>() // the popover under the Compare button of the Performance tab's run header
  const [linkingRun, setLinkingRun] = useState<string>() // the run whose Link with picker is open in the Performance tab while editing
  const [dropping, setDropping] = useState<{ id: string; other: string | undefined }>() // a run's link about to go with the note it holds, until the reader says yes
  const compareRef = useRef<CompareHandle>(null)
  // The note on the pair: what is typed in its editor is kept here, not in the strip, so it survives the strip going away (the Performance tab opening over the panes) and so leaving can ask
  // first. Each pair keeps its own (a Map by pair); another pair starts with none, and typing on one never replaces another's. A pair with no tag has no file to hold it, so there it is a draft.
  // A pair's is only dropped by Discard or Cancel on that pair, by saving it, or by reloading the page: closing the comparison any other way (an address, a live reload that takes a flow
  // away) keeps it, and it is back when the pair is compared again. `saved` in a draft is the note the pair held when it was last typed in, to tell a draft that differs from it.
  const [drafts, setDrafts] = useState<Drafts>(new Map())
  const pair = compare && draftKey(compare.kind, compare.a, compare.b)
  const draft = pair === undefined ? undefined : drafts.get(pair)?.text
  const savedNote = compare ? noteOf(compare.kind === 'flow' ? model.flows : runs, compare.a, compare.b).text : ''
  const dirty = compare !== undefined && unsaved(draft, savedNote) // the pair on show is the one a close would lose a note on
  const keeping = keepsDrafts(drafts) // a note typed and not saved, on any pair: closing the page loses it
  const dirtyRef = useRef(false) // read by handlers an earlier render made, which are the ones a prompt holds on to
  dirtyRef.current = dirty
  const [asking, setAsking] = useState<{ leave: () => void }>() // what to do once the reader says to discard the note
  const [flagged, setFlagged] = useState<string[]>([]) // the shapes the row of the Used by panel in focus names
  // The left-hand panel's tab (the navigator: Explorer, Flows, Performance, Failures or YAML), and whether the right-hand Details panel was opened from its rail. Details shows
  // `side`, or the level you are in, so a `side` opens it too. The Performance and Failures panels are tabs of the navigator too, and an address that names one opens on it.
  const [remembered] = useState(loadNav)
  const [tab, setNavTab] = useState<NavTab | undefined>(() => {
    const named = readHash(location.hash)
    // A comparison waits behind the Performance and Failures tabs, so an address that names one opens without the tab that was left open.
    const left = named.compare !== undefined && (remembered.tab === 'performance' || remembered.tab === 'failures')
    return named.perf !== undefined ? 'performance' : named.failures !== undefined ? 'failures' : left ? undefined : remembered.tab
  })
  // Whether the navigator is where the reader last clicked or opened something: Escape closes it then, and leaves it alone once they work in
  // the diagram. A navigator that came back with the page has not been used.
  const navUsed = useRef(false)
  const levels = useRef<Levels>([]) // the levels the reader has left, for Esc to go back through
  const arriving = useRef<{ id: string; how: 'back' | 'jump' }>(undefined) // the level a way back or a jump up is heading for
  const setTab = (t: NavTab | undefined) => {
    navUsed.current = t !== undefined
    setNavTab(t)
  }
  const [details, setDetails] = useState(false)
  const [models, setModels] = useState<ModelList>() // the models the server lists and how its search went; none from an exported page or VS Code
  useEffect(() => {
    if (live && !vscode) void fetchModels().then(setModels)
  }, [live])
  const [navWidth, setNavWidth] = useState(remembered.navWidth ?? NAV) // dragged by the sashes on the panels' edges
  const [detailsWidth, setDetailsWidth] = useState(remembered.detailsWidth ?? PANEL)
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches // no ramp and no traffic: the colours, thickness, badges and numbers say it all
  // The run the Performance panel (a tab on the left) shows and where along it (see usePerfRun.ts).
  const perfRun = usePerfRun({ runs, named: () => readHash(location.hash).perf, still })
  const { runKey, loadTest, dials, multi, activeDial, here, hereKey, load, ramping, scrubbing, startPositions } = perfRun
  // The Failures panel, a tab on the left too: which analysis, which mode is picked in it, and what the list is narrowed to.
  const [analysisId, setAnalysisId] = useState(() => readHash(location.hash).failures?.analysis ?? '')
  const [modeId, setModeId] = useState<string | undefined>(() => readHash(location.hash).failures?.mode)
  const [filter, setFilter] = useState<Filter>({})
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT, ...remembered.expanded])) // the project's own row starts open
  // The flow playing, and the player's small settings (see usePlayer.ts).
  const { playing, setPlaying, replays, replay, repeat, toggleRepeat, settledKey, setSettledKey } = usePlayer({ initialFlow: () => readHash(location.hash).flow })
  // Edit mode, the notice, the boxes being dragged and the runner every edit goes through (see useEditSession.ts).
  const session = useEditSession({ edit, undo, redo, restore, readOnly })
  const { editing, notice, setNotice, announce, undoable, moved, run, takeBack, bringBack, restoreVersion, clearMoved, didSomethingElse } = session
  // What each box measured. React Flow throws a box's measurements away when it gets a node object
  // it hasn't seen, which every render here is, and its lines have nowhere to land until the browser
  // has measured it again: they'd blink away for a frame on every drag, click and hover.
  const sizes = useRef(new Map<string, { width: number; height: number }>())
  const [hover] = useState(createHoverStore) // the line the pointer is on: not state of this page (see HoverStore)
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
  const canvas = useRef<HTMLElement>(null)
  const zoom = useZoom({ canvas, model, go: id => go(id) }) // the zoom between views (see useZoom.ts)
  const { motion } = zoom

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
  // The Performance and Failures tabs are always there: with nothing to show, their panels say how to make a run or an analysis.
  const canPerf = !editing // while editing the tab lists the runs to link and shows no numbers: they would sit on a model that is changing
  const analysisKey = activeAnalysis(model.failures, analysisId)
  const analysis = analysisKey === undefined ? undefined : model.failures[analysisKey]
  const mode = modeIn(model, analysisKey, modeId)
  const totals = useMemo(() => outline(model, { expanded: new Set(), editing }).totals, [model, editing])
  // The YAML tab is always there. Its files and steps need a server that keeps the history (not an exported page, not the VS Code webview); without one its panel says why.
  const yamlStore = useMemo(() => (live && historyApi ? createHistoryStore(historyApi) : undefined), [live, historyApi])
  // A server that answers 404 keeps no history (an older flowy), and then there is nothing for the tab to show.
  const subscribeYaml = useMemo(() => (listener: () => void) => (yamlStore ? yamlStore.subscribe(listener) : () => undefined), [yamlStore])
  const yamlGone = useSyncExternalStore(subscribeYaml, () => yamlStore?.get().unavailable === true)
  const yamlWhy = noHistory({ live, inVscode: vscode !== undefined, hasApi: historyApi !== undefined, unavailable: yamlGone })
  const nav = openTab(tab, {})
  // The tab shows what the server keeps, so it is read once to know whether there is a history, and again after every load, whether it worked or not (a change may have left a file broken), while the tab is open.
  const yamlRead = useRef<typeof yamlStore>(undefined)
  useEffect(() => {
    if (yamlStore && (nav === 'yaml' || yamlRead.current !== yamlStore)) void yamlStore.refresh()
    yamlRead.current = yamlStore
  }, [yamlStore, changes, nav === 'yaml'])
  const runsOpen = editing && nav === 'performance' // while editing the tab lists the runs to link, and draws none
  const perfOpen = nav === 'performance' && !editing && loadTest !== undefined // a run is drawn on the canvas
  useEffect(() => {
    if (!perfOpen) perfRun.stopRamp()
  }, [perfOpen])
  const failuresOpen = nav === 'failures' // a tab of the navigator on the left, with Explorer, Flows and YAML
  const comparing = compare && !editing && !perfOpen && !failuresOpen && comparable(compare) ? compare : undefined
  const flowsCompared = comparing?.kind === 'flow' // two flows stay on their own views; two runs share the level the address names, and going to another one moves both panes
  // A flow that was playing waits behind the Performance and Failures tabs and a comparison, so a step's motion, the traffic and the risk marks never draw at once.
  const flow = editing || perfOpen || failuresOpen || comparing ? undefined : flowsHere.find(([id]) => id === playing?.flow)?.[1]
  const { stops, stopIndex, stop, flowMarks, shown, animated, moving, stepKey, caption, progress, marks } = useFlowStage({ model, view, flow, playing, replays, recording })
  // While the Performance tab is open, a run over time sets the states instead: the latest event at or before the time on show. A pane of a comparison of runs draws its run the same way (see useRunDrawing).
  const { timeEvents, runMarks, loadTraffic, widths } = useRunDrawing({ model, runs, perf: perfRun, view, shown: perfOpen })
  const stateMarks = flow ? flowMarks : runMarks
  const manyPicked = side?.kind === 'objects' // several shapes picked: a bar at the foot of the canvas, no panel over them
  const detailsOpen = details || (side !== undefined && !manyPicked) // the right-hand side holds Details and nothing else
  const { finished, stepTo, togglePlay } = usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions: animated.length, settledKey, setSettledKey })
  const left = cameFrom(model.flows, playing?.trail ?? [])
  const trail = flow ? left : undefined
  const graph = useMemo(() => toGraph(model, view, shown, problems, stateMarks), [model, view, shown, problems, stateMarks])
  // The states on the canvas now, for the key: a shape on another view that is in one is not drawn here.
  const marksHere = useMemo(() => Object.fromEntries(graph.nodes.flatMap(n => (n.data.state ? [[n.id, n.data.state] as const] : []))), [graph])
  const drawnLines = useMemo(() => (still ? NO_LINES : loadTraffic?.lines ?? NO_LINES), [still, loadTraffic]) // what the panel's key is told, so the tab makes no traffic of its own
  const chosen = side?.kind === 'objects' ? side.ids : side?.kind === 'object' ? [side.id] : [] // the shapes picked for editing, one or several
  const picked = recording ? [recording.from, recording.to] : chosen
  const pickedSet = new Set(picked)
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
  // While the Used by panel is open, the shapes about to go are outlined in red and the ones its focused row names in the accent colour.
  const going = new Set(side?.kind === 'usedby' ? side.targets.flatMap(t => ('object' in t ? [t.object] : [])) : [])
  const usedClass = (id: string) => (going.has(id) ? 'going' : flagged.includes(id) ? 'flagged' : undefined)
  // Nodes are controlled: selection and drag positions only show through these props, applied on every render after the memoized graph.
  const keptNodes = useRef<Kept<BoxNode>>(nothingKept)
  keptNodes.current = keepSame(keptNodes.current, graph.nodes.map(n => ({
    ...n,
    data: loadTraffic || failMarks || scrubbing ? { ...n.data, ...(loadTraffic ? { perf: loadTraffic.boxes[n.id] } : {}), ...(failMarks && Object.hasOwn(failMarks.boxes, n.id) ? { fail: failMarks.boxes[n.id] } : {}), ...(scrubbing ? { snap: true } : {}) } : n.data,
    className: [n.className, litClass(n.id), usedClass(n.id)].filter(Boolean).join(' ') || undefined,
    position: moved.get(n.id) ?? n.position, selected: pickedSet.has(n.id), measured: sizes.current.get(n.id),
  })))
  // The same objects as last time wherever a shape says the same: a hover or a drag changes one or two, and React Flow re-draws only those.
  const nodes = keptNodes.current.list as BoxNode[]
  // Inside a box, a frame named after it wraps its own boxes and follows them while they're dragged.
  const members = useMemo(() => new Set(graph.members), [graph])
  const inner = view === ROOT ? [] : nodes.filter(n => members.has(n.id))
  // A click on its outline is a click on that shape: its Details open, as the rail's button opens them. While a flow is recorded or a load shows,
  // the panel has its own work, so the outline takes no click.
  const openLevelNow = recording || perfOpen ? undefined : () => {
    didSomethingElse()
    clearTimeout(opening.current)
    if (details && side === undefined) return closeDetails() // its Details are already showing: a second click closes them
    setSide(undefined)
    setDetails(true)
  }
  const openLevelStable = useLatest(() => openLevelNow?.())
  const openLevel = openLevelNow && openLevelStable
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })), openLevel)]
  const keptFlowNodes = useRef<Kept<BoxNode | FrameNode>>(nothingKept)
  keptFlowNodes.current = keepSame(keptFlowNodes.current, [...frame, ...nodes])
  const selectedLine = side?.kind === 'line' ? lineId(side.from, side.to) : undefined
  const selectedBox = side?.kind === 'object' ? side.id : undefined
  // The lines a pipe plays along move their labels aside (see Line), unless motion is reduced and there is no pipe. A step that leaves marks (a cross, a bar) keeps its label clear of them.
  const pipes = animated.filter(m => !still || leavesMarks(m.animation)).map(m => lineId(m.placed[0], m.placed[1])).join('\n')
  const keptEdges = useRef<Kept<Edge>>(nothingKept)
  const edgesNow = useMemo(() => {
    const lifted = new Set(pipes === '' ? [] : pipes.split('\n'))
    const drawn = focusEdges(graph.edges, { box: selectedBox, line: selectedLine }).map(e => (lifted.has(e.id) ? { ...e, data: { ...e.data, lift: true } } : e))
    // A picked failure mode outlines its line and fades every other.
    return lit === undefined ? drawn : drawn.map(e => ({ ...e, className: [e.className, e.id === lit.failsLine ? 'fails' : 'dim'].filter(Boolean).join(' ') }))
  }, [graph, selectedBox, selectedLine, pipes, lit])
  keptEdges.current = keepSame(keptEdges.current, edgesNow)
  const edges = keptEdges.current.list as Edge[] // a hover changes one or two lines, and only those draw again
  // Labels that would overlap (the lines of a selected shape) are spread along their lines. They follow the boxes, so a drag moves them.
  const placedAt = nodes.map(n => `${n.position.x},${n.position.y},${n.measured?.width},${n.measured?.height}`).join(' ')
  const spots = useMemo(() => labelSpots(lines, edges, nodes), [lines, edges, placedAt])
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
  // Written a moment after the last change, not on every pixel of a dragged edge (it is the whole tree's open rows each time), and at once when the page is left.
  useEffect(() => {
    const write = () => keepNav({ tab, expanded: [...expanded], navWidth, detailsWidth })
    const timer = setTimeout(write, 200)
    window.addEventListener('pagehide', write)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pagehide', write)
    }
  }, [tab, expanded, navWidth, detailsWidth])

  const close = () => setSide(undefined)
  const closeDetails = () => {
    setSide(undefined)
    setDetails(false)
  }
  /** Closes a tab of the navigator, if it is the one showing. */
  const leave = (t: NavTab) => setNavTab(now => (now === t ? undefined : now))
  /** Shows what a click on the canvas, a problem or a button points at, in the Details panel on the right (and, while Performance is open, in its readings too). */
  const show = (s: Side | undefined) => setSide(s)
  // The Performance and Failures panels are tabs of the same panel on the left, so the traffic and the risk marks never draw over each other.
  const openPerf = () => setTab('performance')
  const openFailures = () => setTab('failures')
  const toggleTab = (t: NavTab) => {
    if (nav === t) setTab(undefined)
    else if (t === 'performance') openPerf()
    else if (t === 'failures') openFailures()
    else setTab(t)
  }
  const closeFailures = () => leave('failures')
  const closePerf = () => leave('performance')
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
  // Flowy reads runs and writes only their `compare` field, so making one is a file: a starter for this view to fill with what a load test measured.
  const createRun = () => copyText(starterRun(model, view), 'Copied a starter run for this view. Fill in your numbers and save it as flowy/perf/<name>.yaml.')
  const copyFailures = (format: 'markdown' | 'csv') => {
    if (analysis) void copyText(table(model, analysis, format), format === 'csv' ? 'Copied this analysis as CSV.' : 'Copied this analysis as a table.')
  }
  /** Runs `leave`, but a note that isn't saved asks first. True when it asked instead: `leave` then waits for Discard, and a caller must stop. */
  const unlessDraft = (leave: () => void): boolean => {
    if (!dirtyRef.current) return false
    setAsking({ leave })
    return true
  }
  const discardNote = () => {
    const leave = asking?.leave
    dirtyRef.current = false
    if (pair !== undefined) setDrafts(d => withDraft(d, pair, undefined, '')) // the pair being left; the others keep theirs
    setAsking(undefined)
    leave?.()
  }
  const go = (id: string) => {
    if (!unlessDraft(() => goNow(id))) goNow(id)
  }
  const goNow = (id: string) => {
    // Where the reader was is where Esc takes them back to. A way back has already taken its level off the list, and a jump up (Z, the breadcrumb) forgets the list.
    const arrived = arriving.current?.id === id ? arriving.current.how : undefined
    arriving.current = undefined
    if (arrived === 'jump') levels.current = []
    else if (arrived !== 'back') levels.current = remember(levels.current, view, id)
    cancelOpen()
    zoom.cancelMotion()
    setViewId(id)
    setPlaying(undefined)
    setCompare(c => (c?.kind === 'run' ? c : undefined)) // two flows are compared on their own views, so going to a level ends it; two runs are compared on the level
    session.viewChanged()
    setSide(s => (s?.kind === 'object' ? s : undefined)) // lines, Add and recording belong to one view
  }
  /** Up to `id` on purpose (Z, Backspace, the breadcrumb): Esc has nothing to go back to from there. */
  const jumpTo = (id: string) => {
    arriving.current = { id, how: 'jump' }
    zoom.zoomOut(id)
  }
  /** Esc: back to the level the reader came from, or up a level when they did not come from one. A second press while the zoom is still leaving goes on from where it is heading. */
  const back = () => {
    const here = motion?.phase === 'leave' ? motion.to : view
    const came = cameBack(levels.current, here, id => id === ROOT || canOpen(id))
    const to = came?.to ?? parentOf(model, here)
    levels.current = came?.rest ?? []
    arriving.current = { id: to, how: came ? 'back' : 'jump' }
    zoom.zoomAbout(to, moveBetween(model, here, to))
  }
  /** Open box `id`, from where it sits on screen: zoom in when it's inside this view, slide across when it sits beside it. */
  const zoomInto = (id: string) => {
    cancelOpen() // a click on the box queued its panel; the zoom replaces it
    close()
    const c = canvas.current!.getBoundingClientRect()
    const b = canvas.current!.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
    zoom.zoomTo(id, moveBetween(model, view, id), b ? b.x + b.width / 2 - c.x : c.width / 2, b ? b.y + b.height / 2 - c.y : c.height / 2)
  }
  /** Play a flow where it plays (going to its level first), or while editing open it to edit. */
  const openFlow = (id: string) => {
    if (unlessDraft(() => openFlow(id))) return
    const f = model.flows[id]
    if (f.view !== view) go(f.view)
    setCompare(undefined)
    if (editing) show({ kind: 'flow', id, name: f.name })
    else setPlaying({ flow: id, step: 0 })
  }
  /** Two flows side by side: `id` is the one that was playing, `other` the one picked to go with it. A flow that can't play doesn't open. */
  const openCompare = (id: string, other: string) => {
    setPicking(false)
    setRowPicking(undefined)
    if (!playable(model, id) || !playable(model, other)) return setNotice("That flow can't play yet.")
    setSide(undefined)
    setCompareStart(flow && playing?.flow === id ? { flow: id, step: stopIndex } : undefined)
    if (playing?.auto) setPlaying({ ...playing, auto: false }) // it must not start up again behind the panes, or when the comparison closes
    setCompare(pairOf(model, id, other))
  }
  /** Two runs side by side: `id` is the one the Performance tab showed, `other` the one picked to go with it. The tab leaves, as the comparison has a panel of its own for each run. */
  const openRunCompare = (id: string, other: string) => {
    setPickingRun(undefined)
    if (!openable(runs, id) || !openable(runs, other)) return setNotice("That run can't open.")
    setSide(undefined)
    perfRun.stopRamp()
    leave('performance')
    setCompare(runPairOf(runs, id, other))
  }
  /** Writes the link of run `id` (the run it is the newer of, or none to unlink), in its own file. A run's note belongs to its link, so one that would go with it asks first. */
  const writeLink = (id: string, other: string | undefined) =>
    void tag('run', id, other === undefined ? undefined : { with: other }).then(message => message !== undefined && setNotice(message))
  const linkRun = (id: string, other: string | undefined) => {
    const was = Object.hasOwn(runs, id) ? compareOf(runs[id].compare) : undefined
    if (was?.with === other || (was === undefined && other === undefined)) return // nothing to change
    if (was?.note !== undefined) setDropping({ id, other })
    else writeLink(id, other)
  }
  // Close, Esc and C all come here. With a note that isn't saved they ask first (see the prompt below); one more of them while it asks is a Keep.
  const closeCompare = () => {
    if (asking) return setAsking(undefined)
    if (unlessDraft(closeCompare)) return
    setCompare(undefined)
    setSide(undefined) // what it showed was clicked in a pane
  }
  /** C: close the comparison, or open it beside the flow playing (or the run the Performance tab shows), with the first one it is linked to or else the picker. */
  const toggleCompare = () => {
    if (comparing) return closeCompare()
    const off = perfOpen ? runCompareOff(runs, editing) : compareOff(model, editing)
    if (off !== undefined) return setNotice(off)
    if (perfOpen) {
      const other = firstLinkedRun(model, runs, runKey)
      if (other === undefined) setPickingRun(open => (open === 'compare' ? undefined : 'compare'))
      else openRunCompare(runKey, other)
      return
    }
    const id = flow ? playing?.flow : undefined
    if (id === undefined) return
    const other = firstLinked(model, id)
    if (other === undefined) setPicking(open => !open)
    else openCompare(id, other)
  }
  /** The Compare button on a flow's row in the navigator: the comparison with the first flow it is linked to, or else the picker under that row. */
  const compareRow = (id: string, at: PickAt) => {
    if (compareOff(model, editing) !== undefined) return
    if (unlessDraft(() => compareRow(id, at))) return
    const other = firstLinked(model, id)
    if (other === undefined) setRowPicking(open => (open?.flow === id ? undefined : { flow: id, at }))
    else openCompare(id, other)
  }
  const rowCompare = { off: compareOff(model, editing), open: rowPicking?.flow, onCompare: compareRow }
  const rowPicker = rowPicking && Object.hasOwn(model.flows, rowPicking.flow) && (
    <ComparePicker model={model} id={rowPicking.flow} at={rowPicking.at} toggle={compareRowAttr(rowPicking.flow)} onPick={id => openCompare(rowPicking.flow, id)} onClose={() => setRowPicking(undefined)} />
  )
  useEffect(() => {
    if (!flow) setPicking(false) // the popover hangs on the player
  }, [flow])
  useEffect(() => {
    setRowPicking(undefined) // and this one on a row of the Flows tab or the Explorer, which are gone when the tab is, or when editing starts
  }, [nav, editing])
  useEffect(() => {
    if (!perfOpen) setPickingRun(undefined) // and these hang on the run header
    if (!runsOpen) setLinkingRun(undefined)
  }, [perfOpen, runsOpen])
  useEffect(() => {
    if (!compare) setCompareStart(undefined)
  }, [compare])
  useEffect(() => {
    if (!dirty) setAsking(undefined)
  }, [dirty])
  // Closing the tab or reloading with a note that isn't saved: the browser asks (it words the question itself).
  useEffect(() => {
    if (!keeping) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [keeping])
  useEffect(() => {
    const notice = fromAddress(model, runs, readHash(location.hash).compare).notice
    if (notice !== undefined) setNotice(notice) // a link to a comparison that can't open
  }, [])
  useEffect(() => {
    if (compare && !comparable(compare)) setCompare(undefined) // a live reload took one of the flows or runs away
  }, [model, runs, compare])
  /** Pick a mode in the Failures list; when its part is outside this view, the canvas goes to the view that draws it. */
  const selectMode = (id: string | undefined) => {
    setModeId(id)
    const m = modeIn(model, analysisKey, id)
    if (m && !drawnIn(model, view, m)) go(homeView(model, m))
  }
  /** A click on a shape in the list of those no mode names yet: go to it and pick it. */
  const pickShape = (id: string) => {
    if (!flowsCompared && parentOf(model, id) !== view) go(parentOf(model, id)) // a comparison of flows stays open: the Details show the shape
    setSide({ kind: 'object', id })
  }
  /** Show it: play the flow that tells a failure, at the step it names (counted from 1), or open it to edit. */
  const showFlow = (id: string, step?: number) => {
    if (unlessDraft(() => showFlow(id, step))) return
    const f = Object.hasOwn(model.flows, id) ? model.flows[id] : undefined
    if (!f || f.steps.length === 0 || !isView(model, f.view)) return setNotice("That flow can't play yet.")
    closeFailures()
    if (f.view !== view) go(f.view)
    setCompare(undefined)
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
    perfRun.stopRamp()
    perfRun.pick(name, [clampPos(runs[name], at)])
    openPerf()
  }
  // VS Code asks to show a shape (the one a file belongs to, or a pick from its list) or a flow.
  useReveal(target => {
    if ('shape' in target) {
      if (!getObject(model, target.shape)) return setNotice("That shape isn't in the model any more.")
      setSearching(false)
      if (!flowsCompared) go(parentOf(model, target.shape)) // the view the box sits in
      show({ kind: 'object', id: target.shape })
    } else if (Object.hasOwn(model.flows, target.flow)) openFlow(target.flow)
    else setNotice("That flow isn't in the model any more.")
  })
  /** A click in the Explorer: show the shape where it is drawn and select it (its Details open on the right), or play the flow. */
  const pickRow = (row: OutlineRow) => {
    if (row.kind === 'flow') return openFlow(row.id)
    if (row.id === ROOT) {
      if (!flowsCompared && view !== ROOT) go(ROOT)
      return setSide(undefined)
    }
    if (!flowsCompared && parentOf(model, row.id) !== view) go(parentOf(model, row.id)) // a comparison of flows stays open: the Details show the shape
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
    if (unlessDraft(toggleEdit)) return
    quiet.current = true // E isn't a step to go back to
    session.toggleEditMode()
    leave('performance') // editing and the Performance panel don't mix: the numbers would sit on a model that is changing
    setPlaying(undefined)
    setCompare(undefined) // nor does a comparison: it shows the flows as they are
    setSide(s => (s?.kind === 'object' || s?.kind === 'line' ? s : undefined))
  }
  // Pressing on a box that isn't one of several picked starts over with that box alone. Otherwise dragging it would carry the others along.
  const pressBox = (e: ReactPointerEvent<HTMLElement>) => {
    if (!editing || side?.kind !== 'objects') return
    const id = e.target instanceof Element ? e.target.closest<HTMLElement>('.react-flow__node-box')?.dataset.id : undefined
    if (id !== undefined && !keepsSelection(side.ids, id, addsToSelection(e))) setSide(undefined)
  }
  /** Deletes shapes or lines: at once when nothing depends on them (the notice says what went with them, and Undo is beside it), else the Used by panel opens to settle what does. */
  const askDelete: Delete = (targets, then) => {
    if (dependents(model, targets).some(needsDecision)) return setSide({ kind: 'usedby', targets, back: side })
    const text = doneText(model, planOf(model, targets, {}), {}, targets)
    void run(m => deleteWith(m, targets, [])).then(saved => {
      if (!saved) return
      announce(text)
      then?.()
    })
  }
  const remove = () => {
    // One edit for the lot, so one undo brings them all back.
    if (side?.kind === 'object' || side?.kind === 'objects') return askDelete(chosen.map(object => ({ object })), close)
    if (side?.kind !== 'line') return
    const merged = connectionsOf(model, view, side.from, side.to)
    if (merged.length > 1) return setNotice(`This line stands for ${merged.length} connections. Delete them one at a time in the panel.`)
    const c = merged[0]?.connection
    if (c) askDelete([{ line: { from: c.from, to: c.to, label: c.label ?? '' } }], close)
  }
  const jump = (p: Problem) => {
    if (unlessDraft(() => jump(p))) return
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
      if (f.view === spot.view && f.steps.length > 0) {
        setCompare(undefined)
        setPlaying({ flow: spot.flow, step: stopIndexOf(stopsOf(f), spot.step ?? 0) })
      }
      else setNotice(readOnly ? `This flow can't play yet. Fix ${p.file} first.` : 'Press E to fix this flow in edit mode.')
    }
  }
  // A drag (or an arrow key on a selected box) ends with dragging: false. Then the whole view's layout is saved.
  const onNodesChange = (changes: NodeChange<BoxNode | FrameNode>[]) => {
    // The browser measured a box: keep it, so the next render hands it back instead of hiding its lines.
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sizes.current.set(c.id, c.dimensions)
    // Drawing a box round shapes: the ones it takes in are the selection. Boxes outside this view's own (the people and systems around it) stay out.
    if (session.isBanding()) setSide(sideFor(banded(chosen, changes, new Set(graph.members))))
    const moves = changes.flatMap(c => (c.type === 'position' && c.position ? [{ ...c, position: c.position }] : []))
    if (moves.length === 0) return
    session.dragged(moves, next => {
      const boxes = Object.fromEntries(nodes.map(n => {
        const { x, y } = next.get(n.id) ?? n.position
        return [n.id, [Math.round(x), Math.round(y)] as [number, number]]
      }))
      return m => placeBoxes(m, view, boxes)
    })
  }

  // The address names the view and the flow playing, so a link opens there and Back goes back. It's checked
  // on every render. A step the reader takes pushes an entry. Anything else replaces the address: the page
  // opening (which also drops a part that named nothing), Back or a typed address, E, or a live reload that
  // falls back to another view.
  const failuresAt = failuresOpen && analysisKey !== undefined ? { analysis: analysisKey, ...(mode ? { mode: modeId } : {}) } : undefined
  const perfAt = perfOpen ? runAddress(runKey, here, multi, ramping) : undefined
  const address = toHash(view, flow ? playing?.flow : undefined, perfAt, failuresAt, comparing)
  useEffect(() => {
    const change = addressChange({ quiet: quiet.current, address, current: location.hash, view, viewId, perfOpen, runKey, failuresAt, compareAt: comparing })
    if (change) history[change === 'replace' ? 'replaceState' : 'pushState'](null, '', address || location.pathname + location.search)
    quiet.current = false
    saveState({ hash: address }) // a VS Code panel that is restored opens where the reader was
  })

  // Back, Forward, or an address typed in: show what it names. Added again on every render, like the keys below.
  useEffect(() => {
    const follow = () => {
      quiet.current = true
      const named = readHash(location.hash)
      // The browser has already moved on, and a Back or a typed address can't be held back, so unlike every other way out this one can't ask. The note stays where it is, keyed by its
      // pair, and the reader is told it is there. (Taking the address back and asking would need to know which way the reader went, which the History API doesn't say.)
      const keeps = fromAddress(model, runs, named.compare).compare
      if (dirtyRef.current && !(keeps && compare && keeps.kind === compare.kind && pairKey(keeps.a, keeps.b) === pairKey(compare.a, compare.b)))
        setNotice('The note is kept until you close this page. Compare the pair again to see it')
      goNow(named.view)
      if (named.flow !== undefined) {
        // Back arrives twice (popstate, then hashchange), and the second must not undo the first: a flow already playing stays where it is.
        if (playing?.flow === named.flow) setPlaying(playing)
        else {
          const back = followBack(playing?.trail ?? [], named.flow) // Back lands on the stop the reader left, when it is the flow they came from
          setPlaying({ flow: named.flow, step: back.step, ...(back.trail.length > 0 ? { trail: back.trail } : {}) })
        }
      }
      perfRun.stopRamp()
      if (named.perf !== undefined && Object.hasOwn(runs, named.perf.run)) {
        perfRun.pick(named.perf.run, startPositions(named.perf.run, named.perf.level, named.perf.levels))
        openPerf()
      } else leave('performance')
      if (named.failures !== undefined && Object.hasOwn(model.failures, named.failures.analysis)) {
        const m = modeIn(model, named.failures.analysis, named.failures.mode)
        setAnalysisId(named.failures.analysis)
        setModeId(m ? named.failures.mode : undefined)
        if (m) setSide(undefined) // a picked shape would narrow the list to what it carries, and the mode named here may not be in it
        openFailures()
        if (m && !drawnIn(model, named.view, m)) go(homeView(model, m)) // the mode's part is outside the view the address names
      } else leave('failures')
      const opened = fromAddress(model, runs, named.compare)
      setCompare(opened.compare)
      if (opened.notice !== undefined) setNotice(opened.notice)
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

  // Added again on every render, so the handler always sees the current state. Which key does what is in keymap.ts; this builds what it needs to know and can do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inNavigator = e.target instanceof Element && e.target.closest('.navpanel') !== null
      // A field keeps its keys, except the load slider: its arrows and Home and End are the tab's own, so they work right after it was used.
      // The navigator's filters clear themselves on Escape and stop it, so one that gets here is empty: a click in it lets Escape close the navigator.
      // A field in the Failures tab's forms keeps its Escape: a half-filled form is not thrown away by it.
      if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (!(e.key === 'Escape' && inNavigator && e.target instanceof HTMLInputElement && e.target.closest('.navfind') !== null)) return
      }
      const state: KeyState = {
        editing, justMoved: session.justMoved(), shortcuts, navigatorOpen: nav !== undefined, navigatorUsed: navUsed.current, flow: flow !== undefined, compare: comparing !== undefined, swap: comparing?.mode === 'swap', runCompare: comparing?.kind === 'run', halfStep: recording?.from !== undefined,
        panel: detailsOpen || manyPicked || perfOpen || runsOpen || failuresOpen, inside: view !== ROOT && !comparing, paneInside: comparing?.kind === 'flow' && compareRef.current?.focused()?.inside() === true, recording: recording !== undefined, perfOpen, failuresOpen, analysis: analysis !== undefined, readOnly,
        canPerf,
      }
      const act: KeyActions = {
        takeBack: () => void takeBack(),
        bringBack: () => void bringBack(),
        closeShortcuts: () => setShortcuts(false),
        toggleShortcuts: () => setShortcuts(open => !open),
        closeNavigator: () => setTab(undefined),
        stopFlow: () => setPlaying(undefined),
        compare: toggleCompare,
        closeCompare,
        swap: () => compareRef.current?.swap(),
        clearStep: () => { if (recording) setSide({ ...recording, from: undefined, to: undefined }) },
        closePanel: () => (detailsOpen || manyPicked ? closeDetails() : perfOpen || runsOpen ? closePerf() : closeFailures()),
        // A second press while a zoom out is still leaving goes up from where that one is heading.
        back: () => (comparing ? compareRef.current?.focused()?.up() : back()), // a pane of a comparison goes up from where it is zoomed to
        up: () => (comparing ? compareRef.current?.focused()?.up() : jumpTo(parentOf(model, motion?.phase === 'leave' && motion.dir === 'out' ? motion.to : view))),
        // With two runs side by side the keys of the Performance tab act on the pane that has the focus.
        stepRun: by => (comparing ? compareRef.current?.focusedRun()?.step(by) : perfRun.stepLevel(stepFrom(here[activeDial], by))),
        runEnd: end => {
          if (comparing) compareRef.current?.focusedRun()?.end(end)
          else if (end === 'first') perfRun.stepLevel(0)
          else if (loadTest) perfRun.stepLevel(multi ? dialTop(dials[activeDial]) : top(loadTest))
        },
        ramp: () => (comparing ? compareRef.current?.focusedRun()?.ramp() : perfRun.toggleRamp()),
        stepFailure: by => selectMode(neighbour([...rows.here, ...rows.elsewhere].map(r => r.id), mode ? modeId : undefined, by)),
        // With two flows side by side the keys of a flow act on the pane that has the focus.
        stepFlow: by => (comparing ? compareRef.current?.focused()?.step(by) : stepTo(stopIndex + by)),
        flowEnd: end => (comparing ? compareRef.current?.focused()?.end(end) : stepTo(end === 'first' ? 0 : stops.length - 1)),
        play: () => (comparing ? compareRef.current?.focused()?.play() : togglePlay()),
        replay: () => (comparing ? compareRef.current?.focused()?.replay() : replay()),
        enter: () => {
          // The box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel. A pane of a comparison does not open boxes.
          const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.react-flow__node-box')?.dataset.id ?? selectedBox
          if (id === undefined) return false
          if (comparing) show({ kind: 'object', id })
          else if (canOpen(id)) zoomInto(id)
          else show({ kind: 'object', id })
          return true
        },
        search: () => setSearching(true),
        fit: () => (comparing ? (comparing.kind === 'run' ? compareRef.current?.focusedRun() : compareRef.current?.focused())?.fit() : fitNow.current?.({ ...fitOptions(detailsOpen ? detailsWidth : 0, flow !== undefined, nav ? navWidth : 0), duration: 300 })),
        toggleTab,
        togglePerf: () => toggleTab('performance'),
        toggleFailures: () => toggleTab('failures'),
        toggleEdit,
        add: () => show({ kind: 'add' }),
        remove,
        selectAll: () => show(sideFor(graph.members)),
      }
      if (dispatch(contextOf(e, inNavigator, state, act))) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /** What the canvas can give one panel: all of it but a strip to look at, and what the other panel takes. */
  const spare = (other: number) => (canvas.current?.clientWidth ?? Infinity) - 160 - other
  const navTabs = <NavTabs tab={nav ?? 'explorer'} onPick={setTab} />
  const clearHistory = async () => {
    const why = historyApi && await clearOutcome(historyApi)
    if (why) setNotice(why)
    await yamlStore?.refresh() // after a failure too, so the list shows what the server really has
  }
  // The handlers of the canvas never change, and call the current ones: a new function for each would make React Flow take them in again on every render.
  const onSelectionStart = useLatest(() => {
    session.startBanding()
    cancelOpen()
  })
  const onSelectionEnd = useLatest(() => {
    session.endBanding()
  })
  const onNodesChangeStable = useLatest(onNodesChange)
  const isValidConnection = useLatest((c: { source: string; target: string }) => placeEnds(model, view, c.source, c.target) !== null)
  const onConnect = useLatest((c: { source: string; target: string }) => void run(m => connect(m, { from: c.source, to: c.target }))
    .then(saved => saved && show({ kind: 'line', from: c.source, to: c.target })))
  const onNodeClick = useLatest((e: ReactMouseEvent, node: { id: string; type?: string }) => {
    if (node.type !== 'box') return // the frame takes no pointer events, this is a guard
    didSomethingElse()
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
  })
  const onNodeDoubleClick = useLatest((e: ReactMouseEvent, node: { id: string; type?: string }) => {
    if (recording || node.type !== 'box' || !canOpen(node.id) || addsToSelection(e)) return
    zoomInto(node.id)
  })
  const onInit = useLatest((instance: ReactFlowInstance<BoxNode | FrameNode, Edge>) => {
    fitNow.current = options => void instance.fitView(options)
  })
  const onEdgeClick = useLatest((_: ReactMouseEvent, e: Edge) => {
    didSomethingElse()
    if (recording || isStepLine(e.id)) return
    if (selectedLine === e.id) closeDetails() // its panel is already open: a second click closes it
    else show({ kind: 'line', from: e.source, to: e.target })
  })
  const onEdgeMouseEnter = useLatest((_: ReactMouseEvent, e: Edge) => hover.set(e.id))
  const onEdgeMouseLeave = useLatest(() => hover.set(undefined))
  const onPaneClick = useLatest(() => {
    didSomethingElse()
    cancelOpen()
    setSide(recording ? { ...recording, from: undefined, to: undefined } : undefined)
  })
  return (
    <>
      <header className="bar">
        {models && <ModelPicker list={models} onList={setModels} />}
        <nav className="crumbs" aria-label="Zoom level">
          {chain(model, view).reverse().map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <ChevronRight size={14} />}
              <button disabled={id === view} onClick={() => jumpTo(id)}>{i === 0 && <Home size={16} />}{nameOf(model, id)}</button>
            </Fragment>
          ))}
        </nav>
        {editing && <button onClick={() => show({ kind: 'flow', id: '', name: '' })}><Route size={16} />New flow</button>}
        {editing && <button onClick={() => show({ kind: 'add' })}><Plus size={16} />Add</button>}
        {editing && <button className="icon" aria-label="Undo" title="Undo the last change (Ctrl+Z)" onClick={() => void takeBack()}><Undo size={16} /></button>}
        {editing && <button className="icon" aria-label="Redo" title="Redo what you undid (Ctrl+Y or Ctrl+Shift+Z)" onClick={() => void bringBack()}><Redo size={16} /></button>}
        {editing && (
          <button title="Lay this view out again" onClick={() => void run(m => tidyLayout(m, view)).then(saved => {
            if (!saved) return
            clearMoved()
            setTidied(n => n + 1)
          })}>
            <Grid size={16} />Tidy
          </button>
        )}
        <span className="grow" />
        {/* first of the right-hand group: its count changes its width, and what sits to its left only ever moves for words, never for an icon */}
        <Problems problems={problems} onPick={jump} />
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
        {live && <button className="toggle" aria-pressed={editing} disabled={readOnly} title="Edit mode (E)" onClick={toggleEdit}><Pencil size={16} />Edit</button>}
      </header>
      <div className="stage">
        <NavRail tab={nav} flows={totals.flows} shapes={totals.shapes}
          perf={{ runs: Object.keys(runs).length }} failures={{ count: modeCount(model) }} onPick={toggleTab} />
        <main ref={canvas} onPointerDownCapture={pressBox} className={['canvas', editing && 'editing', nav && 'nav', loadTraffic && 'loaded', failuresOpen && 'failing', ((flow && usesStates(flow)) || timeEvents) && 'states', scrubbing && 'scrubbing', motion && `${motion.phase}-${motion.dir}`].filter(Boolean).join(' ')}
          style={{ '--nav-w': `${navWidth}px`, '--panel-w': `${detailsWidth}px`, ...(motion && { '--ox': `${motion.x}px`, '--oy': `${motion.y}px`, '--dx': `${motion.dx}%`, '--dy': `${motion.dy}%` }) } as CSSProperties}>
          {comparing ? (
            <CompareView ref={compareRef} model={model} runs={runs} view={view} compare={comparing} problems={problems} colorMode={colorMode} lines={lines} still={still} shown={side} nav={nav !== undefined} details={detailsOpen && side !== undefined} start={compareStart}
              onPick={picked => {
                didSomethingElse()
                show(picked)
              }}
              onClosePanel={closeDetails} onEmpty={close} onMode={mode => setCompare(c => c && { ...c, mode })} onFlip={() => setCompare(c => c && flipped(c))} onClose={closeCompare}
              note={{
                off: noteOff(live, readOnly), draft, onDraft: text => { if (pair !== undefined) setDrafts(d => withDraft(d, pair, text, savedNote)) },
                onSave: (id, value) => tag(comparing.kind, id, value), onNotice: setNotice,
              }} />
          ) : (
            <LineStyleContext value={lines}>
              <LineWidthsContext value={widths}>
              <LineMarksContext value={lineMarks}>
              <LineHover value={hover}>
              <LabelSpots spots={spots}>
              <ReactFlow
                key={view} // a fresh canvas per view
                className="main-flow"
                nodes={keptFlowNodes.current.list as (BoxNode | FrameNode)[]}
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
                onSelectionStart={onSelectionStart}
                onSelectionEnd={onSelectionEnd}
                onNodesChange={onNodesChangeStable}
                isValidConnection={isValidConnection} // only lines this view can show
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onInit={onInit}
                onEdgeClick={onEdgeClick}
                onEdgeMouseEnter={onEdgeMouseEnter}
                onEdgeMouseLeave={onEdgeMouseLeave}
                onPaneClick={onPaneClick}
              >
                <Camera count={nodes.length + frame.length} fitKey={`${view} ${flow ? playing?.flow : ''} ${tidied}`} player={flow !== undefined} reveal={selectedBox} panel={detailsWidth} nav={nav ? navWidth : 0} />
                {/* The fit button reads its own options, not ReactFlow's fitViewOptions. Camera does the automatic fits. */}
                <ZoomControls fit={fitOptions(detailsOpen ? detailsWidth : 0, flow !== undefined, nav ? navWidth : 0)} nav={nav ? navWidth : undefined} />
                {loadTraffic && !still && <TrafficLayer lines={loadTraffic.lines} style={lines} />}
                {flow && stop && animated.map(m => (
                  <StepMotion key={`${stepKey}:${m.i}`} ends={m.placed} animation={m.animation} by={m.by} afterLanding={stop.before.some(j => followsLanding(shown?.ends[j], m.placed))} repeat={repeat} onDone={() => finished(m.i)} />
                ))}
                {flow && <GroupMarks marks={marks} />}
              </ReactFlow>
              </LabelSpots>
              </LineHover>
              </LineMarksContext>
              </LineWidthsContext>
            </LineStyleContext>
          )}
          {!comparing && nodes.length === 0 && (
            <p className="empty">{editing
              ? 'Nothing here yet. Press Add to put the first shape here.'
              : live
                ? 'Nothing here yet. Ask an AI to map this repo into Flowy, press E to draw it yourself, or add YAML to the flowy/ folder.'
                : 'Nothing here yet.'}</p>
          )}
          {searching && (
            <Search model={model} onClose={() => setSearching(false)} onPick={id => {
              setSearching(false)
              if (!flowsCompared) go(parentOf(model, id)) // the view the box sits in; a comparison of flows stays open
              show({ kind: 'object', id })
            }} />
          )}
          {shortcuts && <Shortcuts editable={live && !readOnly} performance={canPerf} failures onClose={() => setShortcuts(false)} />}
          {asking && (
            <div className="draft-ask" role="alertdialog" aria-label="Discard the note?">
              <span>Discard the note?</span>
              <button title="Throw the note away" onClick={discardNote}>Discard</button>
              <button className="primary" autoFocus title="Keep the note (Esc)" onClick={() => setAsking(undefined)}>Keep</button>
            </div>
          )}
          {dropping && (
            <div className="draft-ask" role="alertdialog" aria-label="Remove the link and its note?">
              <span>Remove the link and its note?</span>
              <button title="Take away the link and the note it holds" onClick={() => {
                writeLink(dropping.id, dropping.other)
                setDropping(undefined)
              }}>Remove</button>
              <button className="primary" autoFocus title="Keep the link (Esc)" onClick={() => setDropping(undefined)}>Keep</button>
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              {undoable && <button className="undo" onClick={() => void takeBack()}><Undo size={16} />Undo</button>}
              <button aria-label="Dismiss" onClick={() => setNotice(undefined)}><Close size={16} /></button>
            </div>
          )}
          {detailsOpen && (side?.kind === 'object' || (side === undefined && view !== ROOT && !comparing)) && (
            <ObjectPanel model={model} id={side?.kind === 'object' ? side.id : view} editing={editing} problems={problems} codeBase={codeBase} run={run} onClose={closeDetails} onDelete={askDelete} state={side?.kind === 'object' && Object.hasOwn(stateMarks, side.id) ? stateMarks[side.id] : undefined}
              onPick={id => setSide({ kind: 'object', id })} onHover={hover.set} />
          )}
          {detailsOpen && side === undefined && view === ROOT && !comparing && <OverviewPanel model={model} totals={totals} editing={editing} run={run} onClose={closeDetails} />}
          {detailsOpen && side?.kind === 'line' && (
            <LinePanel model={model} view={side.view ?? view} from={side.from} to={side.to} editing={editing} problems={problems} run={run} onClose={closeDetails} onDelete={askDelete} />
          )}
          {editing && side?.kind === 'usedby' && (
            <UsedBy model={model} targets={side.targets} run={run} onFlag={setFlagged}
              onDone={text => {
                announce(text)
                close()
              }}
              onCancel={() => setSide(side.back)} />
          )}
          {editing && side?.kind === 'objects' && <PickedBar count={side.ids.length} onDelete={remove} onClear={closeDetails} />}
          {detailsOpen && editing && side?.kind === 'add' && (
            <AddPanel model={model} view={view} run={run} onAdded={id => setSide({ kind: 'object', id })} onClose={closeDetails} />
          )}
          {detailsOpen && recording && (
            <Recorder model={model} view={view} rec={recording} onChange={rec => setSide({ kind: 'flow', ...rec })} onOpenFlow={openFlow} run={run} onClose={closeDetails} />
          )}
          {runsOpen && (
            <NavPanel tabs={<NavTitle title="Performance" />} onClose={() => setTab(undefined)}>
              <RunLinks model={model} runs={runs} linkOff={noteOff(live, readOnly)} picking={linkingRun} onPicking={setLinkingRun} onLink={linkRun} />
            </NavPanel>
          )}
          {nav === 'performance' && !editing && (
            <NavPanel tabs={<NavTitle title="Performance" />} onClose={() => setTab(undefined)}>
              <PerfBody model={model} view={view} runs={runs} runProblems={runProblems} runId={runKey} positions={here} active={activeDial} lines={drawnLines} ramping={ramping} still={still} states={marksHere} measure={perfRun.measure} dataOff={perfRun.dataOff} onMeasure={perfRun.setMeasure}
                selection={side?.kind === 'object' || side?.kind === 'line' ? side : undefined}
                onRun={id => {
                  perfRun.stopRamp()
                  perfRun.pick(id)
                }}
                onActive={perfRun.setActive} onSlide={(dial, to) => perfRun.slide(to, dial)} onJump={perfRun.jumpTo} onPlace={perfRun.placeAll} onRamp={perfRun.toggleRamp} onCreate={live ? createRun : undefined}
                compare={{
                  off: runCompareOff(runs, editing), open: pickingRun === 'compare', onToggle: () => setPickingRun(open => (open === 'compare' ? undefined : 'compare')),
                  picker: pickingRun && (
                    <ComparePicker model={model} runs={runs} kind="run" id={runKey} label="Compare with" toggle="data-compare-toggle"
                      onPick={other => {
                        setPickingRun(undefined)
                        openRunCompare(runKey, other)
                      }}
                      onClose={() => setPickingRun(undefined)} />
                  ),
                }} />
            </NavPanel>
          )}
          {nav === 'flows' && (
            <NavPanel tabs={navTabs} onClose={() => setTab(undefined)}>
              <FlowsTab model={model} editing={editing} canEdit={live && !readOnly} current={recording?.id || (flow ? playing?.flow : undefined)} compare={rowCompare} onOpen={f => openFlow(f.id)} onMove={editing && live && !readOnly ? (id, folder) => void run(m => moveFlow(m, id, folder)) : undefined} />
              {rowPicker}
            </NavPanel>
          )}
          {nav === 'explorer' && (
            <NavPanel tabs={navTabs} onClose={() => setTab(undefined)}>
              <Explorer model={model} problems={problems} editing={editing} expanded={expanded} onToggle={toggleOpen} here={view} selected={selectedBox}
                playing={flow ? playing?.flow : undefined} onPick={pickRow} onOpen={openRow} compare={rowCompare} />
              {rowPicker}
            </NavPanel>
          )}
          {nav === 'failures' && (
            <NavPanel tabs={<NavTitle title="Failures" />} onClose={() => setTab(undefined)}>
              <FailuresBody model={model} view={view} runs={runs} problems={problems} failureProblems={failureProblems} analysisId={analysisKey} modeId={mode ? modeId : undefined}
                rows={rows} filter={filter} part={part}
                onAnalysis={id => {
                  setAnalysisId(id)
                  setModeId(undefined)
                  setFilter({})
                }}
                onMode={selectMode} onFilter={setFilter} onClearPart={() => setSide(undefined)} onPickShape={pickShape}
                onShowFlow={showFlow} onSeenInRun={seenInRun} onCopy={copyFailures} editing={editing} run={run} onCreate={live && !readOnly ? toggleEdit : undefined} />
            </NavPanel>
          )}
          {nav === 'yaml' && (
            <NavPanel tabs={navTabs} onClose={() => setTab(undefined)}>
              {yamlStore && yamlWhy === undefined
                ? <Yaml store={yamlStore} editing={editing} broken={broken} flow={recording?.id || (flow ? playing?.flow : undefined) || undefined} selected={selectedBox}
                    onRestore={restoreVersion} onClear={clearHistory} />
                : <p className="muted navnote">{yamlWhy}</p>}
            </NavPanel>
          )}
          {nav && <Sash side="nav" width={navWidth} onResize={w => setNavWidth(clampWidth(w, spare(detailsOpen ? detailsWidth : 0)))} onReset={() => setNavWidth(NAV)} />}
          {detailsOpen && <Sash side="details" width={detailsWidth} onResize={w => setDetailsWidth(clampWidth(w, spare(nav ? navWidth : 0)))} onReset={() => setDetailsWidth(PANEL)} />}
          {flow && stop && caption && progress && (
            <Player model={model} flow={flow} stops={stops} stop={stopIndex} ends={shown?.ends ?? []} caption={caption} progress={progress} marks={marksHere} auto={playing?.auto === true} moving={moving}
              trail={trail} onStep={stepTo} onAuto={togglePlay} onReplay={replay} repeat={repeat} onRepeat={toggleRepeat} onStop={() => setPlaying(undefined)} onOpenFlow={openLinked} onBack={goBack}
              compare={{ off: compareOff(model, editing), open: picking, onToggle: () => setPicking(open => !open),
                picker: playing ? <ComparePicker model={model} id={playing.flow} onPick={id => openCompare(playing.flow, id)} onClose={() => setPicking(false)} /> : null }} />
          )}
        </main>
        <DetailsRail open={detailsOpen} onToggle={() => { if (detailsOpen) closeDetails(); else setDetails(true) }} />
      </div>
    </>
  )
}
