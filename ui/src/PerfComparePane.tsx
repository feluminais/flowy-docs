import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import { ReactFlow } from '@xyflow/react'
import type { ColorMode, FitViewOptions, NodeChange } from '@xyflow/react'
import type { LineStyle, Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import type { LineTraffic, Run } from '../../src/core/perf/types.ts'
import { nameOf } from '../../src/core/views.ts'
import { Box, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { ZoomControls } from './ZoomControls.tsx'
import type { Picked } from './compare.ts'
import { fitOptions, focusEdges, frameNode, lineId, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode } from './graph.ts'
import { LabelSpots, Line, LineStyleContext, LineWidthsContext, labelSpots } from './Line.tsx'
import { PerfBody } from './Performance.tsx'
import type { PerfProps } from './Performance.tsx'
import { stepFrom, dialTop, top } from './perfview.ts'
import { crossfadeDuration, FADE_MS } from './swap.ts'
import { TrafficLayer } from './TrafficLayer.tsx'
import { usePerfRun } from './usePerfRun.ts'
import { useRunDrawing } from './useRunDrawing.ts'

const nodeTypes = { box: Box, frame: Frame }
const edgeTypes = { line: Line }
const NO_LINES: LineTraffic[] = [] // and no traffic, so the panel's key is not rebuilt for it
const NO_PROBLEMS: Problem[] = []

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches

/** What the keys of the Performance tab reach in a pane: the same steps its slider and buttons take, on this pane's run alone. */
export type RunPaneHandle = {
  step(by: 1 | -1): void
  end(which: 'first' | 'last'): void
  ramp(): void
  fit(): void
}

/**
 * Everything one run of a comparison needs to be drawn: its own place along the run (usePerfRun: the position of each dial, the dial the keys act on, the ramp, the drag of a
 * slider), what the run puts on the canvas at that place (useRunDrawing, as the single canvas draws it), and the boxes, frame and lines of the view. Two of these never touch each
 * other, and none writes the address: the comparison's address names the runs, not where along them each one is.
 */
export function usePaneRun({ model, runs, runId, view, problems, selectedBox, selectedLine, lines, still }: {
  model: Model
  runs: Record<string, Run>
  runId: string
  /** The level both panes of the comparison draw. */
  view: string
  problems: Problem[]
  /** The shape and the line the shared panel shows. */
  selectedBox?: string
  selectedLine?: string
  lines: LineStyle
  still: boolean
}) {
  const perf = usePerfRun({ runs, named: () => ({ run: runId }), still })
  const drawing = useRunDrawing({ model, runs, perf, view, shown: true })
  const { loadTraffic, runMarks } = drawing
  const graph = useMemo(() => toGraph(model, view, undefined, problems, runMarks), [model, view, problems, runMarks])
  // The states on the canvas now, for the panel's key: a shape on another view that is in one is not drawn here.
  const marksHere = useMemo(() => Object.fromEntries(graph.nodes.flatMap(n => (n.data.state ? [[n.id, n.data.state] as const] : []))), [graph])
  const sizes = useRef(new Map<string, { width: number; height: number }>()) // what each box measured (see Reader: React Flow forgets it on every new node object)
  const [hovered, setHovered] = useState<string>()
  const { scrubbing } = perf
  const nodes = graph.nodes.map(n => ({
    ...n,
    data: loadTraffic || scrubbing ? { ...n.data, ...(loadTraffic ? { perf: loadTraffic.boxes[n.id] } : {}), ...(scrubbing ? { snap: true } : {}) } : n.data,
    selected: n.id === selectedBox,
    measured: sizes.current.get(n.id),
  }))
  const inner = view === ROOT ? [] : nodes.filter(n => graph.members.includes(n.id))
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })))]
  const edges = useMemo(() => focusEdges(graph.edges, { box: selectedBox, line: selectedLine, hover: hovered }), [graph, selectedBox, selectedLine, hovered])
  const placedAt = nodes.map(n => `${n.position.x},${n.position.y},${n.measured?.width},${n.measured?.height}`).join(' ')
  const spots = useMemo(() => labelSpots(lines, edges, nodes), [lines, edges, placedAt])
  const onNodesChange = (changes: NodeChange<BoxNode | FrameNode>[]) => {
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sizes.current.set(c.id, c.dimensions)
  }
  /** What the lines carry now, for the panel's key and its readout of a line: none with reduced motion, where the canvas draws no traffic. */
  const drawnLines = still ? NO_LINES : loadTraffic?.lines ?? NO_LINES
  /** What the keys reach: the same steps the Performance tab's keys take. */
  const keys = {
    step: (by: 1 | -1) => perf.stepLevel(stepFrom(perf.here[perf.activeDial], by)),
    end: (which: 'first' | 'last') => {
      if (which === 'first') perf.stepLevel(0)
      else if (perf.loadTest) perf.stepLevel(perf.multi ? dialTop(perf.dials[perf.activeDial]) : top(perf.loadTest))
    },
    ramp: () => perf.toggleRamp(),
  }
  return { perf, drawing, view, graph, marksHere, nodes, frame, edges, spots, drawnLines, setHovered, onNodesChange, keys }
}

export type PaneRun = ReturnType<typeof usePaneRun>

type Shown = NonNullable<PerfProps['selection']>

type PaneProps = {
  model: Model
  runs: Record<string, Run>
  /** The run on show in this pane, and (during the fade of a swap) the one that is going off. */
  p: PaneRun
  leaving?: PaneRun
  /** An id of its own for this canvas (React Flow wants one for each canvas on a page, and it ends up in `url(#...)` references, so it holds only letters, numbers, `_` and `-`). */
  paneId: string
  title: string
  label?: string
  focused: boolean
  /** The pane was clicked, or took keyboard focus. */
  onFocus: () => void
  onPick: (picked: Picked) => void
  /** A click on the pane's empty area, which also gives it the focus. */
  onEmpty: () => void
  /** What the shared Details panel shows, for this run's readout of it. */
  selection: Shown | undefined
  fitKey: string
  colorMode: ColorMode
  lines: LineStyle
  still: boolean
  /** A pane that fills the view alone (Swap) rather than half of it. */
  alone?: boolean
  ref?: Ref<RunPaneHandle>
}

/**
 * One run's pane: its name over the model canvas with that run's traffic, and the run's Performance panel (slider, readout, key) under the canvas, or beside it when the pane
 * is wide. It is the single canvas of the reader (App) cut down to what a run needs: nothing is dragged or edited, and a double-click goes nowhere.
 */
function RunPane({ model, runs, p, leaving, paneId, title, label, focused, onFocus, onPick, onEmpty, selection, fitKey, colorMode, lines, still, alone, ref }: PaneProps) {
  const { perf, drawing, view, nodes, frame, edges, spots } = p
  const fitNow = useRef<(options: Omit<FitViewOptions, 'nodes'>) => void>(undefined)
  const fit = () => fitNow.current?.({ ...fitOptions(0, false), duration: 300 })
  useImperativeHandle(ref, () => ({ ...p.keys, fit }))
  const classes = ['pane', 'run-pane', alone && 'alone', focused && 'focused', drawing.loadTraffic && 'loaded', drawing.timeEvents && 'states', perf.scrubbing && 'scrubbing'].filter(Boolean).join(' ')
  return (
    <section className={classes} tabIndex={0} aria-label={label ?? title} onFocus={onFocus} onPointerDownCapture={onFocus}
      style={{ '--fade-ms': `${FADE_MS}ms` } as CSSProperties}>
      <h2 className="pane-title" title={title}>{title}</h2>
      <div className="run-body">
        <div className="pane-canvas">
          <LineStyleContext value={lines}>
            <LineWidthsContext value={drawing.widths}>
              <LabelSpots spots={spots}>
                <ReactFlow
                  id={`run-${paneId}`}
                  nodes={[...frame, ...nodes]}
                  edges={edges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  minZoom={0.2}
                  colorMode={colorMode}
                  defaultMarkerColor="var(--edge)"
                  nodesDraggable={false}
                  nodesConnectable={false}
                  zoomOnDoubleClick={false}
                  deleteKeyCode={null}
                  onNodesChange={p.onNodesChange}
                  onNodeClick={(_, node) => {
                    if (node.type === 'box') onPick({ kind: 'object', id: node.id })
                  }}
                  onEdgeClick={(_, e) => onPick({ kind: 'line', from: e.source, to: e.target, view })}
                  onEdgeMouseEnter={(_, e) => p.setHovered(e.id)}
                  onEdgeMouseLeave={() => p.setHovered(undefined)}
                  onPaneClick={() => {
                    onFocus()
                    onEmpty() // as on the single canvas, a click on nothing closes the panel
                  }}
                  onInit={instance => {
                    fitNow.current = options => void instance.fitView(options)
                  }}
                >
                  <Camera count={nodes.length + frame.length} fitKey={`${view} ${fitKey}`} player={false} panel={0} nav={0} refitOnResize={false} />
                  <ZoomControls fit={fitOptions(0, false)} />
                  {/* Stable keys: a run compared with itself has two panes of the same id. In a swap the layer for the run coming on fades in over the one going off. */}
                  {!still && drawing.loadTraffic && <TrafficLayer key="on" lines={drawing.loadTraffic.lines} style={lines} fade={leaving ? 'in' : undefined} />}
                  {!still && leaving?.drawing.loadTraffic && <TrafficLayer key="off" lines={leaving.drawing.loadTraffic.lines} style={lines} fade="out" />}
                </ReactFlow>
              </LabelSpots>
            </LineWidthsContext>
          </LineStyleContext>
        </div>
        <div className="run-panel">
          <PerfBody pane model={model} view={view} runs={runs} runProblems={NO_PROBLEMS} runId={perf.runKey} positions={perf.here} active={perf.activeDial} lines={p.drawnLines}
            ramping={perf.ramping} still={still} states={p.marksHere} selection={selection}
            onRun={() => undefined /* the pane's run is the pane's own */} onActive={perf.setActive} onSlide={(dial, to) => perf.slide(to, dial)} onJump={perf.jumpTo} onPlace={perf.placeAll} onRamp={perf.toggleRamp} />
        </div>
      </div>
    </section>
  )
}

type CommonProps = Pick<PaneProps, 'paneId' | 'focused' | 'onFocus' | 'onPick' | 'onEmpty' | 'fitKey' | 'colorMode' | 'lines' | 'still' | 'ref'> & {
  model: Model
  runs: Record<string, Run>
  view: string
  problems: Problem[]
  /** What the shared Details panel shows, as `{ kind, id }` or `{ kind, from, to }`. */
  shown: { kind: string; id?: string; from?: string; to?: string } | undefined
}

/** The Details panel's pick as the shape or line a run's canvas outlines and its panel reads out. */
function pickedBy(shown: CommonProps['shown']): { box?: string; line?: string; selection?: Shown } {
  if (shown?.kind === 'object' && shown.id !== undefined) return { box: shown.id, selection: { kind: 'object', id: shown.id } }
  if (shown?.kind === 'line' && shown.from !== undefined && shown.to !== undefined) return { line: lineId(shown.from, shown.to), selection: { kind: 'line', from: shown.from, to: shown.to } }
  return {}
}

/**
 * One run of a comparison side by side, with a canvas and a panel of its own: its own zoom, pan, place along the run and ramp, so acting in one pane never moves the other. Both
 * panes draw the same level. What is clicked in either is outlined in both, as it is the same shape, and each panel reads out that shape for its own run.
 */
export function PerfComparePane({ runId, title, label, ...rest }: CommonProps & { runId: string; title: string; label?: string }) {
  const { box, line, selection } = pickedBy(rest.shown)
  const p = usePaneRun({ model: rest.model, runs: rest.runs, runId, view: rest.view, problems: rest.problems, selectedBox: box, selectedLine: line, lines: rest.lines, still: rest.still })
  return <RunPane {...rest} p={p} title={title} label={label} selection={selection} />
}

/**
 * Swap for runs: one canvas at full width showing one of the two runs. Both runs are alive (each keeps its own place along it, its dial and its ramp across swaps) but only the one on
 * show is drawn. Both draw the same view, so the boxes stay where they are: a swap changes what the run measured (the boxes' colours and the lines' thickness move on their own
 * transitions) and the traffic fades from one run's to the other's. Under reduced motion it cuts. The run that goes off stops ramping.
 */
export function PerfSwapPane({ ids, titles, index, ...rest }: CommonProps & { ids: [string, string]; titles: [string, string]; index: 0 | 1 }) {
  const { box, line, selection } = pickedBy(rest.shown)
  const shared = { model: rest.model, runs: rest.runs, view: rest.view, problems: rest.problems, selectedBox: box, selectedLine: line, lines: rest.lines, still: rest.still }
  const both: [PaneRun, PaneRun] = [usePaneRun({ ...shared, runId: ids[0] }), usePaneRun({ ...shared, runId: ids[1] })]
  // Worked out while rendering, so the first frame after the swap already has both layers. A swap during a fade fades again from the run on show.
  const [fading, setFading] = useState<{ index: 0 | 1; prev?: 0 | 1; run: number }>({ index, run: 0 })
  let now = fading
  if (fading.index !== index) {
    now = { index, prev: crossfadeDuration(reducedMotion()) > 0 ? fading.index : undefined, run: fading.run + 1 }
    setFading(now)
  }
  useEffect(() => {
    if (now.prev === undefined) return
    const run = now.run
    const wait = setTimeout(() => setFading(f => (f.run !== run ? f : { ...f, prev: undefined })), crossfadeDuration(false))
    return () => clearTimeout(wait)
  }, [now.run, now.prev])
  const was = useRef(index)
  useEffect(() => {
    if (was.current === index) return
    both[was.current].perf.stopRamp() // the run that goes off stops where it is
    was.current = index
  }, [index])
  return <RunPane {...rest} p={both[index]} leaving={now.prev === undefined ? undefined : both[now.prev]} title={titles[index]} selection={selection} alone />
}
