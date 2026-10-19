import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import type { FitViewOptions, NodeChange, XYPosition } from '@xyflow/react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { getObject, LINE_STYLES, lineStyle, ROOT } from '../../src/core/model.ts'
import type { LineStyle, Model, Step } from '../../src/core/model.ts'
import { connect, deleteObjects, forgetLayout, placeBoxes, removeConnection, setLines } from '../../src/core/ops.ts'
import { flowToMermaid, viewToMermaid } from '../../src/core/mermaid.ts'
import { animationOf, followsLanding } from '../../src/core/animation.ts'
import { captionOf, progressOf } from '../../src/core/captions.ts'
import { otherLaneSteps, stopIndexOf, stopsOf } from '../../src/core/structure.ts'
import { knee, traffic as trafficOf } from '../../src/core/perf.ts'
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
import { readHash, toHash } from './hash.ts'
import { escapeStep, letter, takesEnter, undoesMove } from './keys.ts'
import { Line, LineStyleContext, LineWidthsContext } from './Line.tsx'
import { TrafficLayer } from './TrafficLayer.tsx'
import { keepOwnLines, LINE_NAMES, ownLines } from './lines.ts'
import { DWELL, GAP } from './motion.ts'
import { clampWidth } from './navstate.ts'
import type { NavTab } from './navstate.ts'
import { keepNav, loadNav } from './navstore.ts'
import { DetailsRail, Explorer, FlowsTab, NavPanel, NavRail, NavTabs, Sash } from './Navigator.tsx'
import { PerfBody } from './Performance.tsx'
import { activeRun, clampPos, loadAt, rampFrom, rampPos, RAMP_STEP_MS, snap, top } from './perfview.ts'
import { AddPanel, LinePanel, ManyPanel, ObjectPanel, OverviewPanel, Recorder } from './Panel.tsx'
import { addsToSelection, banded, keepsSelection, toggled } from './selection.ts'
import { Search } from './Search.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import { StepMotion } from './StepMotion.tsx'
import { GroupMarks } from './GroupMarks.tsx'
import { Player } from './Player.tsx'
import { closeFlow, followBack, openFlow as leaveFlow } from './trail.ts'
import type { Spot } from './trail.ts'
import type { Recording, Run } from './Panel.tsx'
import { copyMessage } from '../../src/core/host.ts'
import { saveState, vscode } from './host.ts'
import { useReveal } from './reveal.ts'
import { useColorMode } from './hosttheme.ts'
import { useModel } from './useModel.ts'
import type { Edit, Loaded } from './useModel.ts'

const nodeTypes = { box: Box, frame: Frame }
const edgeTypes = { line: Line }
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
  const { loaded, banner, edit, undo, redo, live } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {loaded && <Reader {...loaded} edit={edit} undo={undo} redo={redo} live={live} readOnly={!live || banner !== undefined} />}
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

function Reader({ model, problems, codeBase, runs, runProblems, edit, undo, redo, live, readOnly }: Loaded & { edit: Edit; undo: Back; redo: Back; live: boolean; readOnly: boolean }) {
  const colorMode = useColorMode()
  // A link opens where its address says (see hash.ts). The effects below keep the address up to date.
  const [viewId, setViewId] = useState(() => readHash(location.hash).view)
  const [side, setSide] = useState<Side>()
  // The left-hand panel's tab (the navigator: Flows or Explorer), and whether the right-hand Details panel was opened from its rail. Details shows
  // `side`, or the level you are in, so a `side` opens it too.
  const [remembered] = useState(loadNav)
  const [tab, setNavTab] = useState<NavTab | undefined>(remembered.tab)
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
  const [perf, setPerf] = useState(() => readHash(location.hash).perf !== undefined)
  const startPos = (id: string, level?: number) => (Object.hasOwn(runs, id) ? clampPos(runs[id], level ?? knee(runs[id])?.index ?? top(runs[id])) : 0)
  const [runId, setRunId] = useState(() => {
    const named = readHash(location.hash).perf?.run
    return named !== undefined && Object.hasOwn(runs, named) ? named : Object.keys(runs)[0] ?? ''
  })
  const [pos, setPos] = useState(() => startPos(runId, readHash(location.hash).perf?.level))
  const [ramping, setRamping] = useState(false)
  const posNow = useRef(pos) // the ramp reads where it is from here, so a render in between never makes it start over
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set([ROOT, ...remembered.expanded])) // the project's own row starts open
  const [playing, setPlaying] = useState<{ flow: string; step: number; auto?: boolean; trail?: Spot[] } | undefined>(() => {
    const { flow } = readHash(location.hash)
    return flow === undefined ? undefined : { flow, step: 0 }
  })
  const [replays, setReplays] = useState(0) // R counts up, and a new count plays the step again
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
  const here = loadTest ? clampPos(loadTest, pos) : 0
  if (!ramping) posNow.current = here // while it ramps, the ramp is ahead of what the screen shows
  const showPerf = !editing && (Object.keys(runs).length > 0 || runProblems.length > 0) // the tab is there whenever there is a run, or a run file to complain about
  const perfOpen = perf && showPerf && loadTest !== undefined
  // A flow that was playing waits behind the Performance tab, so a step's motion and the traffic never draw at once.
  const flow = editing || perfOpen ? undefined : flowsHere.find(([id]) => id === playing?.flow)?.[1]
  // The player moves through stops, not steps: a stop is what is on screen at once (see structure.ts). `playing.step` is a stop.
  const stops = useMemo(() => (flow ? stopsOf(flow) : []), [flow])
  const stopIndex = flow && playing ? Math.max(0, Math.min(playing.step, stops.length - 1)) : 0
  const stop = flow ? stops[stopIndex] : undefined
  const totals = useMemo(() => outline(model, { expanded: new Set(), editing }).totals, [model, editing])
  const showFlows = totals.flows > 0 || editing // the Flows tab is there whenever there is a flow to find
  const nav: NavTab | undefined = tab === 'flows' && !showFlows ? undefined : tab
  const detailsOpen = (details || side !== undefined) && !perfOpen // the Performance panel is in its place while it is open
  const rightOpen = detailsOpen || perfOpen // a panel on the right, whichever it is

  // A drag re-renders on every mouse move, and dagre takes tens of ms on a big view, so the graph is
  // rebuilt only when what it is built from changes. `flow`, `recording` and `model` keep their identity between renders.
  const shown = useMemo<Playing | undefined>(() => {
    const placeSteps = (steps: Step[]) => steps.map(s => placeStep(model, view, s))
    if (flow && stops[stopIndex]) return { ends: placeSteps(flow.steps), steps: stops[stopIndex].steps, faint: otherLaneSteps(stops, stopIndex) }
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
    return a && p ? [{ i, animation: a, placed: p }] : []
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
  const graph = useMemo(() => toGraph(model, view, shown, problems), [model, view, shown, problems])
  const load = loadTest ? loadAt(loadTest, here) : 0
  const loadTraffic = useMemo(() => (perfOpen && loadTest ? trafficOf(model, loadTest, load, view) : undefined), [perfOpen, model, loadTest, load, view])
  const widths = useMemo(() => new Map(loadTraffic?.lines.map(l => [lineId(l.from, l.to), l.width])), [loadTraffic])
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches // no ramp and no traffic: the colours, thickness, badges and numbers say it all
  const chosen = side?.kind === 'objects' ? side.ids : side?.kind === 'object' ? [side.id] : [] // the shapes picked for editing, one or several
  const picked = recording ? [recording.from, recording.to] : chosen
  // Nodes are controlled: selection and drag positions only show through these props, applied on every render after the memoized graph.
  const nodes = graph.nodes.map(n => ({ ...n, data: loadTraffic ? { ...n.data, perf: loadTraffic.boxes[n.id] } : n.data, position: moved.get(n.id) ?? n.position, selected: picked.includes(n.id), measured: sizes.current.get(n.id) }))
  // Inside a box, a frame named after it wraps its own boxes and follows them while they're dragged.
  const inner = view === ROOT ? [] : nodes.filter(n => graph.members.includes(n.id))
  // A click on its outline is a click on that shape: its Details open, as the rail's button opens them. While a flow is recorded or a load shows,
  // the panel has its own work, so the outline takes no click.
  const openLevel = recording || perfOpen ? undefined : () => {
    justMoved.current = false
    clearTimeout(opening.current)
    setSide(undefined)
    setDetails(true)
  }
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })), openLevel)]
  const selectedLine = side?.kind === 'line' ? lineId(side.from, side.to) : undefined
  const selectedBox = side?.kind === 'object' ? side.id : undefined
  const edges = useMemo(() => focusEdges(graph.edges, { box: selectedBox, line: selectedLine, hover: hovered }), [graph, selectedBox, selectedLine, hovered])
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
  const toggleTab = (t: NavTab) => setTab(nav === t ? undefined : t)
  const openPerf = () => {
    setDetails(false) // so that closing it again doesn't leave Details open in its place
    setPerf(true)
  }
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
  const copyMermaid = async () => {
    const diagram = flow && playing ? flowToMermaid(model, playing.flow) : viewToMermaid(model, view)
    const text = '```mermaid\n' + diagram + '```\n'
    try {
      // In VS Code the editor writes it: a webview can't count on the clipboard API, which wants the page focused.
      if (vscode) vscode.postMessage(copyMessage(text))
      else await navigator.clipboard.writeText(text)
      setNotice(`Copied ${flow ? 'this flow' : 'this view'} as Mermaid. Paste it into a README or a PR: GitHub draws it.`)
    } catch {
      setNotice("Couldn't copy: the browser didn't allow it.")
    }
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
      const next = rampPos(loadTest, posNow.current, Math.min(100, t - last)) // a tab that was asleep doesn't jump
      last = t
      posNow.current = next
      const done = next >= top(loadTest)
      if (done || t - shown >= RAMP_STEP_MS) {
        shown = t
        setPos(next)
      }
      if (done) setRamping(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ramping, loadTest])
  useEffect(() => {
    if (!perfOpen) setRamping(false)
  }, [perfOpen])
  const toggleRamp = () => {
    if (!loadTest || still) return
    if (ramping) {
      setPos(posNow.current) // where it has got to, not where the screen last was
      return setRamping(false)
    }
    const from = rampFrom(loadTest, posNow.current) // at the top, a ramp starts again from the bottom
    posNow.current = from // the ramp reads it before the next render
    setPos(from)
    setRamping(true)
  }
  const stepLevel = (to: number) => {
    if (!loadTest) return
    setRamping(false)
    setPos(snap(loadTest, to))
  }
  const pickLines = (value: string) => {
    const style = LINE_STYLES.find(s => s === value) // "" is the project's default
    const own = (s: LineStyle | undefined) => {
      keepOwnLines(s)
      setMine(s)
    }
    // In edit mode the project's style is what you see, so once it's saved your own choice goes.
    if (editing) void run(m => setLines(m, style)).then(saved => saved && own(undefined))
    else own(style)
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
  const address = toHash(view, flow ? playing?.flow : undefined, perfOpen ? { run: runKey, level: Math.round(here) } : undefined)
  useEffect(() => {
    if (quiet.current || address !== location.hash) {
      const was = readHash(location.hash)
      const alongRun = perfOpen && was.perf?.run === runKey && was.view === view // moving along a run is not a step to go back to
      history[quiet.current || view !== viewId || alongRun ? 'replaceState' : 'pushState'](null, '', address || location.pathname + location.search)
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
        setPos(startPos(named.perf.run, named.perf.level))
        openPerf()
      } else setPerf(false)
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
      if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
        if (!(e.key === 'Escape' && inNavigator && e.target instanceof HTMLInputElement)) return
      }
      // A second press while a zoom out is still leaving goes up from where that one is heading.
      const up = () => zoomOut(parentOf(model, motion?.phase === 'leave' && motion.dir === 'out' ? motion.to : view))
      if (undoesMove(e, { editing, justMoved: justMoved.current, shortcuts, plain })) {
        void takeBack()
      }
      else if (e.key === 'Escape') {
        const navigator = nav !== undefined && (navUsed.current || inNavigator)
        const layer = escapeStep({ shortcuts, navigator, flow: flow !== undefined, halfStep: recording?.from !== undefined, panel: rightOpen, inside: view !== ROOT })
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
      else if (perfOpen && e.key === 'ArrowRight') stepLevel(Math.floor(here + 1e-6) + 1)
      else if (perfOpen && e.key === 'ArrowLeft') stepLevel(Math.ceil(here - 1e-6) - 1)
      else if (perfOpen && e.key === 'Home') stepLevel(0)
      else if (perfOpen && loadTest && e.key === 'End') stepLevel(top(loadTest))
      else if (perfOpen && key === 'p' && plain && !e.repeat) toggleRamp()
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
      else if (key === 't' && plain && !e.repeat && showPerf) (perfOpen ? closePerf() : openPerf())
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
  const navTabs = <NavTabs tab={nav ?? 'explorer'} showFlows={showFlows} onPick={setTab} />
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
        <select aria-label="Line style" value={editing ? projectLines : mine ?? ''}
          title={editing ? 'How lines look for everyone (saved in model.yaml)' : 'How lines look on this screen'}
          onChange={e => {
            pickLines(e.target.value)
            e.target.blur()
          }}>
          {!editing && <option value="">Lines: project default ({LINE_NAMES[projectLines]})</option>}
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
        <NavRail tab={nav} flows={totals.flows} shapes={totals.shapes} showFlows={showFlows} onPick={toggleTab} />
        <main ref={canvas} onPointerDownCapture={pressBox} className={['canvas', editing && 'editing', nav && 'nav', loadTraffic && 'loaded', motion && `${motion.phase}-${motion.dir}`].filter(Boolean).join(' ')}
          style={{ '--nav-w': `${navWidth}px`, '--panel-w': `${detailsWidth}px`, ...(motion && { '--ox': `${motion.x}px`, '--oy': `${motion.y}px`, '--dx': `${motion.dx}%`, '--dy': `${motion.dy}%` }) } as CSSProperties}>
          <LineStyleContext value={lines}>
            <LineWidthsContext value={widths}>
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
                if (!recording && !isStepLine(e.id)) show({ kind: 'line', from: e.source, to: e.target })
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
                <StepMotion key={`${stepKey}:${m.i}`} ends={m.placed} animation={m.animation} afterLanding={stop.before.some(j => followsLanding(shown?.ends[j], m.placed))} onDone={() => finished(m.i)} />
              ))}
              {flow && <GroupMarks marks={marks} />}
            </ReactFlow>
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
          {shortcuts && <Shortcuts editable={live && !readOnly} performance={showPerf} onClose={() => setShortcuts(false)} />}
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button aria-label="Dismiss" onClick={() => setNotice(undefined)}><Close size={16} /></button>
            </div>
          )}
          {detailsOpen && (side?.kind === 'object' || (side === undefined && view !== ROOT)) && (
            <ObjectPanel model={model} id={side?.kind === 'object' ? side.id : view} editing={editing} problems={problems} codeBase={codeBase} run={run} onClose={closeDetails}
              onPick={id => setSide({ kind: 'object', id })} onHover={setHovered} />
          )}
          {detailsOpen && side === undefined && view === ROOT && <OverviewPanel totals={totals} onClose={closeDetails} />}
          {detailsOpen && side?.kind === 'line' && (
            <LinePanel model={model} view={view} from={side.from} to={side.to} editing={editing} problems={problems} run={run} onClose={closeDetails} />
          )}
          {detailsOpen && editing && side?.kind === 'objects' && (
            <ManyPanel model={model} ids={side.ids} onPick={id => show({ kind: 'object', id })} onDelete={remove} onClose={closeDetails} />
          )}
          {detailsOpen && editing && side?.kind === 'add' && (
            <AddPanel model={model} view={view} run={run} onAdded={id => setSide({ kind: 'object', id })} onClose={closeDetails} />
          )}
          {detailsOpen && recording && (
            <Recorder model={model} view={view} rec={recording} onChange={rec => setSide({ kind: 'flow', ...rec })} run={run} onClose={closeDetails} />
          )}
          {perfOpen && (
            <aside className="panel perfpanel">
              <button className="close" aria-label="Close" onClick={closePerf}><Close size={16} /></button>
              <PerfBody model={model} view={view} runs={runs} runProblems={runProblems} runId={runKey} pos={here} ramping={ramping} still={still}
                selection={side?.kind === 'object' || side?.kind === 'line' ? side : undefined}
                onRun={id => {
                  setRamping(false)
                  setRunId(id)
                  setPos(startPos(id))
                }}
                onPos={stepLevel} onRamp={toggleRamp} />
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
          {nav && <Sash side="nav" width={navWidth} onResize={w => setNavWidth(clampWidth(w, spare(rightOpen ? detailsWidth : 0)))} onReset={() => setNavWidth(NAV)} />}
          {rightOpen && <Sash side="details" width={detailsWidth} onResize={w => setDetailsWidth(clampWidth(w, spare(nav ? navWidth : 0)))} onReset={() => setDetailsWidth(PANEL)} />}
          {flow && stop && caption && progress && (
            <Player model={model} flow={flow} stops={stops} stop={stopIndex} ends={shown?.ends ?? []} caption={caption} progress={progress} auto={playing?.auto === true} moving={moving}
              trail={trail} onStep={stepTo} onAuto={togglePlay} onReplay={() => setReplays(n => n + 1)} onStop={() => setPlaying(undefined)} onOpenFlow={openLinked} onBack={goBack} />
          )}
        </main>
        <DetailsRail open={detailsOpen} onToggle={() => { if (detailsOpen) closeDetails(); else { setPerf(false); setDetails(true) } }}
          perf={showPerf ? { open: perfOpen, runs: Object.keys(runs).length, onToggle: () => (perfOpen ? closePerf() : openPerf()) } : undefined} />
      </div>
    </>
  )
}
