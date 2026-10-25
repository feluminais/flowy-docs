import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { ReactFlow } from '@xyflow/react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/problem.ts'
import { getObject, ROOT } from '../../src/core/model.ts'
import { moveFlow } from '../../src/core/ops.ts'
import { followsLanding } from '../../src/core/animation.ts'
import { usesStates } from '../../src/core/states.ts'
import { stopIndexOf, stopsOf } from '../../src/core/structure.ts'
import type { LineTraffic } from '../../src/core/perf/types.ts'
import { drawnIn, homeView } from '../../src/core/failures.ts'
import type { Part } from '../../src/core/failures.ts'
import { outline } from '../../src/core/outline.ts'
import type { OutlineRow } from '../../src/core/outline.ts'
import { chain, hasChildren, parentOf } from '../../src/core/views.ts'
import { Box, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { ZoomControls } from './ZoomControls.tsx'
import { Close, Undo } from './icons.tsx'
import { locate } from './edit.ts'
import { fitOptions, lineId, NAV, PANEL } from './graph.ts'
import { readHash } from './hash.ts'
import { compareOff, flipped, noteOff, runCompareOff } from './compare.ts'
import { CompareView } from './CompareView.tsx'
import { ComparePicker } from './ComparePicker.tsx'
import { firstErrorAt, modeCount, modeIn } from './failuresview.ts'
import { FailuresBody } from './Failures.tsx'
import { createHoverStore, LabelSpots, Line, LineHover, LineMarksContext, LineStyleContext, LineWidthsContext } from './Line.tsx'
import { TrafficLayer } from './TrafficLayer.tsx'
import { clampWidth } from './navstate.ts'
import { compareRowAttr, DetailsRail, Explorer, FlowsTab, NavPanel, NavRail, NavTabs, NavTitle, Sash } from './Navigator.tsx'
import { PerfBody } from './Performance.tsx'
import { RunLinks } from './RunLinks.tsx'
import { clampPos } from './perfview.ts'
import { addsToSelection, keepsSelection } from './selection.ts'
import { Search } from './Search.tsx'
import { Shortcuts } from './Shortcuts.tsx'
import { useLatest } from './stable.ts'
import { ChannelMarks } from './Channels.tsx'
import { StepMotion } from './StepMotion.tsx'
import { GroupMarks } from './GroupMarks.tsx'
import { Player } from './Player.tsx'
import { cameFrom } from './trail.ts'
import { vscode } from './host.ts'
import { fetchModels } from './models.ts'
import type { ModelList } from './models.ts'
import { useReveal } from './reveal.ts'
import { useColorMode } from './hosttheme.ts'
import type { HistoryClient } from './historyclient.ts'
import { useModel } from './useModel.ts'
import type { Edit, Loaded, Restore, Tag } from './useModel.ts'
import { useEditSession } from './useEditSession.ts'
import { usePerfRun } from './usePerfRun.ts'
import { useRunDrawing } from './useRunDrawing.ts'
import { usePlayback, usePlayer } from './usePlayer.ts'
import { useFlowStage } from './useFlowStage.ts'
import { Yaml } from './Yaml.tsx'
import { DetailsPanels } from './DetailsPanels.tsx'
import type { Side } from './side.ts'
import { TopBar } from './TopBar.tsx'
import { useAddress } from './useAddress.ts'
import { useCanvasEvents, useClickWait } from './useCanvasEvents.ts'
import { useCanvasGraph } from './useCanvasGraph.ts'
import { useCompare } from './useCompare.ts'
import { useCompareActions } from './useCompareActions.ts'
import { useCopyOut } from './useCopyOut.ts'
import { useDelete } from './useDelete.ts'
import { useFailuresView } from './useFailuresView.ts'
import { useLineStyle } from './useLineStyle.ts'
import { useNavigation } from './useNavigation.ts'
import { usePanels } from './usePanels.ts'
import { useReaderKeys } from './useReaderKeys.ts'
import { useYamlTab } from './useYamlTab.ts'

const nodeTypes = { box: Box, frame: Frame }
const NO_LINES: LineTraffic[] = [] // and no traffic, so the Performance panel's key is not rebuilt for it
const edgeTypes = { line: Line }

export function App() {
  const { loaded, banner, edit, undo, redo, restore, tag, history, changes, live } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {loaded && <Reader {...loaded} edit={edit} undo={undo} redo={redo} restore={restore} tag={tag} historyApi={history} changes={changes} live={live} readOnly={!live || banner !== undefined} broken={banner !== undefined} />}
    </div>
  )
}

type Back = () => Promise<string | undefined>

function Reader({ model, problems, codeBase, runs, runProblems, failureProblems, edit, undo, redo, restore, tag, historyApi, changes, live, readOnly, broken }: Loaded & {
  edit: Edit; undo: Back; redo: Back; restore: Restore; tag: Tag; historyApi?: HistoryClient; changes: number; live: boolean; readOnly: boolean; broken: boolean
}) {
  const colorMode = useColorMode()
  // A link opens where its address says (see hash.ts). The effects in useAddress keep the address up to date.
  const [viewId, setViewId] = useState(() => {
    // An address that names a mode whose part is outside the view it names opens on the view that draws the part.
    const named = readHash(location.hash)
    const m = modeIn(model, named.failures?.analysis, named.failures?.mode)
    return m !== undefined && !drawnIn(model, named.view, m) ? homeView(model, m) : named.view
  })
  const [side, setSide] = useState<Side>()
  const [flagged, setFlagged] = useState<string[]>([]) // the shapes the row of the Used by panel in focus names
  const [models, setModels] = useState<ModelList>() // the models the server lists and how its search went; none from an exported page or VS Code
  useEffect(() => {
    if (live && !vscode) void fetchModels().then(setModels)
  }, [live])
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches // no ramp and no traffic: the colours, thickness, badges and numbers say it all
  // The run the Performance panel (a tab on the left) shows and where along it (see usePerfRun.ts).
  const perfRun = usePerfRun({ runs, named: () => readHash(location.hash).perf, still })
  const { runKey, loadTest, activeDial, here, ramping, scrubbing } = perfRun
  // The flow playing, and the player's small settings (see usePlayer.ts).
  const { playing, setPlaying, replays, replay, repeat, toggleRepeat, settledKey, setSettledKey } = usePlayer({ initialFlow: () => readHash(location.hash).flow })
  // Edit mode, the notice, the boxes being dragged and the runner every edit goes through (see useEditSession.ts).
  const session = useEditSession({ edit, undo, redo, restore, readOnly })
  const { editing, notice, setNotice, announce, undoable, moved, run, takeBack, bringBack, restoreVersion, clearMoved, didSomethingElse } = session
  const [hover] = useState(createHoverStore) // the line the pointer is on: not state of this page (see HoverStore)
  const [searching, setSearching] = useState(false)
  const [shortcuts, setShortcuts] = useState(false) // the list ? opens
  const [tidied, setTidied] = useState(0) // Tidy counts up, so the camera fits the new layout
  const wait = useClickWait()
  const canvas = useRef<HTMLElement>(null)
  const { lines, pickLines } = useLineStyle({ model, editing, run })
  // A box with children opens. In edit mode an empty system, app or store opens too, so its first child can be added.
  const canOpen = (id: string) => hasChildren(model, id) || (editing && typesIn(model, id).length > 0)
  // After a live reload the view's object may be gone or empty: show the nearest view that still exists.
  const view = chain(model, viewId).find(v => v === ROOT || canOpen(v)) ?? ROOT
  const recording = editing && side?.kind === 'flow' ? side : undefined
  const flowsHere = Object.entries(model.flows).filter(([, f]) => f.view === view && (editing || f.steps.length > 0))
  // The Performance and Failures tabs are always there: with nothing to show, their panels say how to make a run or an analysis.
  const canPerf = !editing // while editing the tab lists the runs to link and shows no numbers: they would sit on a model that is changing
  const selectedLine = side?.kind === 'line' ? lineId(side.from, side.to) : undefined
  const selectedBox = side?.kind === 'object' ? side.id : undefined
  const manyPicked = side?.kind === 'objects' // several shapes picked: a bar at the foot of the canvas, no panel over them
  const chosen = side?.kind === 'objects' ? side.ids : side?.kind === 'object' ? [side.id] : [] // the shapes picked for editing, one or several
  const picked = recording ? [recording.from, recording.to] : chosen
  const pickedSet = new Set(picked)
  const part: Part | undefined = side?.kind === 'object' ? { box: side.id } : side?.kind === 'line' ? { line: [side.from, side.to] } : undefined
  const drawing = side?.kind === 'add' || side?.kind === 'flow' // Add and a flow being recorded are drawn on the canvas: a faded one would hide what they make
  const panels = usePanels({ model, view, selectedBox })
  const { nav, setTab, leave, openPerf, openFailures, toggleTab, closeFailures, details, setDetails, navWidth, setNavWidth, detailsWidth, setDetailsWidth, expanded, toggleOpen } = panels
  const failuresOpen = nav === 'failures' // a tab of the navigator on the left, with Explorer, Flows and YAML
  const { setAnalysisId, setModeId, setFilter, filter, analysisKey, analysis, mode, modeId, failMarks, lineMarks, lit, rows, litClass, selectMode } = useFailuresView({ model, view, open: failuresOpen, part, drawing, go: id => go(id) })
  const totals = useMemo(() => outline(model, { expanded: new Set(), editing }).totals, [model, editing])
  const yaml = useYamlTab({ historyApi, live, changes, open: nav === 'yaml', setNotice })
  const runsOpen = editing && nav === 'performance' // while editing the tab lists the runs to link, and draws none
  const perfOpen = nav === 'performance' && !editing && loadTest !== undefined // a run is drawn on the canvas
  useEffect(() => {
    if (!perfOpen) perfRun.stopRamp()
  }, [perfOpen])
  const { compare, setCompare, setCompareStart, compareRef, compareStart, draft, onDraft, dirtyRef, asking, setAsking, comparing, flowsCompared, unlessDraft, discardNote } = useCompare({ model, runs, editing, perfOpen, failuresOpen, setNotice })
  // A flow that was playing waits behind the Performance and Failures tabs and a comparison, so a step's motion, the traffic and the risk marks never draw at once.
  const flow = editing || perfOpen || failuresOpen || comparing ? undefined : flowsHere.find(([id]) => id === playing?.flow)?.[1]
  const { stops, stopIndex, stop, flowMarks, shown, animated, moving, stepKey, caption, progress, marks, open, channelKinds } = useFlowStage({ model, view, flow, playing, replays, recording })
  // While the Performance tab is open, a run over time sets the states instead: the latest event at or before the time on show. A pane of a comparison of runs draws its run the same way (see useRunDrawing).
  const { timeEvents, runMarks, loadTraffic, widths } = useRunDrawing({ model, runs, perf: perfRun, view, shown: perfOpen })
  const stateMarks = flow ? flowMarks : runMarks
  const detailsOpen = details || (side !== undefined && !manyPicked) // the right-hand side holds Details and nothing else
  const { finished, stepTo, togglePlay } = usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions: animated.length, settledKey, setSettledKey })
  const left = cameFrom(model.flows, playing?.trail ?? [])
  const trail = flow ? left : undefined
  const { picking, setPicking, rowPicking, setRowPicking, pickingRun, setPickingRun, linkingRun, setLinkingRun, dropping, setDropping, openCompare, openRunCompare, writeLink, linkRun, closeCompare, toggleCompare, compareRow } =
    useCompareActions({ model, runs, editing, tag, setNotice, setSide, setCompare, setCompareStart, comparing, asking, setAsking, unlessDraft, flow, playing, setPlaying, stopIndex, perfRun, perfOpen, runsOpen, nav, leave })
  const drawnLines = useMemo(() => (still ? NO_LINES : loadTraffic?.lines ?? NO_LINES), [still, loadTraffic]) // what the panel's key is told, so the tab makes no traffic of its own
  // While the Used by panel is open, the shapes about to go are outlined in red and the ones its focused row names in the accent colour.
  const going = new Set(side?.kind === 'usedby' ? side.targets.flatMap(t => ('object' in t ? [t.object] : [])) : [])
  const usedClass = (id: string) => (going.has(id) ? 'going' : flagged.includes(id) ? 'flagged' : undefined)
  const close = () => setSide(undefined)
  const closeDetails = () => {
    setSide(undefined)
    setDetails(false)
  }
  /** Shows what a click on the canvas, a problem or a button points at, in the Details panel on the right (and, while Performance is open, in its readings too). */
  const show = (s: Side | undefined) => setSide(s)
  // A click on its outline is a click on that shape: its Details open, as the rail's button opens them. While a flow is recorded or a load shows,
  // the panel has its own work, so the outline takes no click.
  const openLevelNow = recording || perfOpen ? undefined : () => {
    didSomethingElse()
    clearTimeout(wait.opening.current)
    if (details && side === undefined) return closeDetails() // its Details are already showing: a second click closes them
    setSide(undefined)
    setDetails(true)
  }
  const openLevelStable = useLatest(() => openLevelNow?.())
  const openLevel = openLevelNow && openLevelStable
  const { graph, marksHere, nodes, flowNodes, shapes, edges, spots, sizes } = useCanvasGraph({ model, view, shown, problems, stateMarks, loadTraffic, failMarks, scrubbing, moved, pickedSet, litClass, usedClass, lit, openLevel, animated, still, selectedBox, selectedLine, lines })
  const { motion, go, goNow, jumpTo, back, zoomInto, openFlow, openLinked, goBack, showFlow } = useNavigation({ model, view, canvas, canOpen, editing, setViewId, playing, setPlaying, stopIndex, setCompare, setSide, show, session, cancelOpen: wait.cancelOpen, unlessDraft, setNotice, closeFailures })
  const events = useCanvasEvents({ model, view, editing, recording, side, chosen, selectedLine, nodes, members: graph.members, sizes, session, run, show, setSide, closeDetails, canOpen, zoomInto, hover, wait })
  const { copyMermaid, createRun, copyFailures } = useCopyOut({ model, view, flow, playing, analysis, setNotice })
  const { askDelete, remove } = useDelete({ model, view, side, chosen, run, setSide, setNotice, announce, close })
  const rowCompare = { off: compareOff(model, editing), open: rowPicking?.flow, onCompare: compareRow }
  const rowPicker = rowPicking && Object.hasOwn(model.flows, rowPicking.flow) && (
    <ComparePicker model={model} id={rowPicking.flow} at={rowPicking.at} toggle={compareRowAttr(rowPicking.flow)} onPick={id => openCompare(rowPicking.flow, id)} onClose={() => setRowPicking(undefined)} />
  )
  /** A click in the list of shapes no mode names yet: go to it and pick it. */
  const pickShape = (id: string) => {
    if (!flowsCompared && parentOf(model, id) !== view) go(parentOf(model, id)) // a comparison of flows stays open: the Details show the shape
    setSide({ kind: 'object', id })
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
  const { quiet } = useAddress({ model, runs, view, viewId, flow, playing, setPlaying, perfRun, perfOpen, failuresOpen, analysisKey, mode, modeId, setAnalysisId, setModeId, compare, setCompare, comparing, dirtyRef, setNotice, setSide, goNow, go, openPerf, openFailures, leave })
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
  useReaderKeys({ model, view, editing, readOnly, canPerf, session, panels, perfRun, perfOpen, runsOpen, failuresOpen, shortcuts, setShortcuts, setSearching, flow, stops, stopIndex, stepTo, togglePlay, replay, setPlaying, comparing, compareRef, toggleCompare, closeCompare, recording, setSide, show, detailsOpen, manyPicked, closeDetails, failures: { analysis, rows, mode, modeId, selectMode }, navigation: { motion, back, jumpTo, zoomInto }, selectedBox, canOpen, fitNow: events.fitNow, toggleEdit, remove, members: graph.members })

  /** What the canvas can give one panel: all of it but a strip to look at, and what the other panel takes. */
  const spare = (other: number) => (canvas.current?.clientWidth ?? Infinity) - 160 - other
  const navTabs = <NavTabs tab={nav ?? 'explorer'} onPick={setTab} />
  return (
    <>
      <TopBar model={model} view={view} editing={editing} live={live} readOnly={readOnly} problems={problems} models={models} onModels={setModels} lines={lines} searching={searching} shortcuts={shortcuts} run={run}
        onJump={jumpTo} onProblem={jump} onShow={show} onUndo={() => void takeBack()} onRedo={() => void bringBack()}
        onTidy={() => {
          clearMoved()
          setTidied(n => n + 1)
        }}
        onLines={pickLines} onSearching={setSearching} onMermaid={() => void copyMermaid()} onShortcuts={setShortcuts} onEdit={toggleEdit} />
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
                off: noteOff(live, readOnly), draft, onDraft,
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
                nodes={flowNodes}
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
                onSelectionStart={events.onSelectionStart}
                onSelectionEnd={events.onSelectionEnd}
                onNodesChange={events.onNodesChange}
                isValidConnection={events.isValidConnection} // only lines this view can show
                onConnect={events.onConnect}
                onNodeClick={events.onNodeClick}
                onNodeDoubleClick={events.onNodeDoubleClick}
                onInit={events.onInit}
                onEdgeClick={events.onEdgeClick}
                onEdgeMouseEnter={events.onEdgeMouseEnter}
                onEdgeMouseLeave={events.onEdgeMouseLeave}
                onPaneClick={events.onPaneClick}
              >
                <Camera count={shapes} fitKey={`${view} ${flow ? playing?.flow : ''} ${tidied}`} player={flow !== undefined} reveal={selectedBox} panel={detailsWidth} fitPanel={detailsOpen ? detailsWidth : 0} nav={nav ? navWidth : 0} />
                {/* The fit button reads its own options, not ReactFlow's fitViewOptions. Camera does the automatic fits. */}
                <ZoomControls fit={fitOptions(detailsOpen ? detailsWidth : 0, flow !== undefined, nav ? navWidth : 0)} nav={nav ? navWidth : undefined} />
                {loadTraffic && !still && <TrafficLayer lines={loadTraffic.lines} style={lines} />}
                {flow && stop && <ChannelMarks open={open} stepKey={stepKey} />}
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
          <DetailsPanels model={model} view={view} side={side} open={detailsOpen} comparing={comparing !== undefined} editing={editing} recording={recording} problems={problems} codeBase={codeBase} run={run} stateMarks={stateMarks} totals={totals}
            setSide={setSide} onClose={closeDetails} onDelete={askDelete} onRemove={remove} onFlag={setFlagged} announce={announce} onHover={hover.set} onOpenFlow={openFlow} />
          {runsOpen && (
            <NavPanel tabs={<NavTitle title="Performance" />} onClose={() => setTab(undefined)}>
              <RunLinks model={model} runs={runs} linkOff={noteOff(live, readOnly)} picking={linkingRun} onPicking={setLinkingRun} onLink={linkRun} />
            </NavPanel>
          )}
          {nav === 'performance' && !editing && (
            <NavPanel tabs={<NavTitle title="Performance" />} onClose={() => setTab(undefined)}>
              <PerfBody model={model} view={view} runs={runs} runProblems={runProblems} runId={runKey} positions={here} active={activeDial} boxes={loadTraffic?.boxes} lines={drawnLines} ramping={ramping} still={still} states={marksHere} measure={perfRun.measure} dataOff={perfRun.dataOff} onMeasure={perfRun.setMeasure}
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
              {yaml.store && yaml.why === undefined
                ? <Yaml store={yaml.store} readOnly={!live} editing={editing} broken={broken} flow={recording?.id || (flow ? playing?.flow : undefined) || undefined} selected={selectedBox}
                    onRestore={restoreVersion} onClear={yaml.clear} />
                : <p className="muted navnote">{yaml.why}</p>}
            </NavPanel>
          )}
          {nav && <Sash side="nav" width={navWidth} onResize={w => setNavWidth(clampWidth(w, spare(detailsOpen ? detailsWidth : 0)))} onReset={() => setNavWidth(NAV)} />}
          {detailsOpen && <Sash side="details" width={detailsWidth} onResize={w => setDetailsWidth(clampWidth(w, spare(nav ? navWidth : 0)))} onReset={() => setDetailsWidth(PANEL)} />}
          {flow && stop && caption && progress && (
            <Player model={model} flow={flow} stops={stops} stop={stopIndex} ends={shown?.ends ?? []} caption={caption} progress={progress} marks={marksHere} channels={channelKinds} auto={playing?.auto === true} moving={moving}
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
