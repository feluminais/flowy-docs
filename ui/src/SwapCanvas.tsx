import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import { ReactFlow, useReactFlow } from '@xyflow/react'
import type { ColorMode, FitViewOptions } from '@xyflow/react'
import type { LineStyle, Model } from '../../src/core/model.ts'
import type { SideMarks } from '../../src/core/flowdiff.ts'
import type { Problem } from '../../src/core/problem.ts'
import { usesStates } from '../../src/core/states.ts'
import { Box, ChangeMarksContext, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { ZoomControls } from './ZoomControls.tsx'
import type { Picked } from './compare.ts'
import { BOX, FRAME, fitOptions, isStepLine, lineId } from './graph.ts'
import type { BoxNode, FrameNode } from './graph.ts'
import { LabelSpots, Line, LineStyleContext } from './Line.tsx'
import { PaneMotions, PanePlayer } from './ComparePane.tsx'
import type { PaneHandle } from './ComparePane.tsx'
import { FADE_MS, planSwap, SWAP_MS, swapDuration } from './swap.ts'
import { usePaneFlow } from './usePaneFlow.ts'

const nodeTypes = { box: Box, frame: Frame }
const edgeTypes = { line: Line }

type Shown = { kind: string; id?: string; from?: string; to?: string; view?: string }

/** Where a swap is: `out` while the lines fade (the boxes wait), `glide` while the boxes move, fade and the camera fits the incoming flow, `settled` once it is over. */
type Phase = 'out' | 'glide' | 'settled'
type Swapping = { index: 0 | 1; prev?: 0 | 1; phase: Phase; run: number; cuts: number }

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

/** Fits the camera to the incoming flow's shapes while they glide, taking as long as they do. A press during a swap fits again from where the view is. */
function SwapCamera({ go, ids }: { go: number; ids: string[] }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (go !== 0) void fitView({ ...fitOptions(0, true), nodes: ids.map(id => ({ id })), duration: SWAP_MS })
  }, [go])
  return null
}

type Props = {
  model: Model
  /** An id for the canvas (see ComparePane's `paneId`). */
  paneId: string
  /** The two flows, in an order that does not change when the sides swap: each keeps its own player while the other is on show. */
  flows: [string, string]
  /** Which of them is on show. Changing it runs the swap. */
  index: 0 | 1
  /** The stop the flow that was playing was at when the comparison opened. */
  start?: { flow: string; step: number }
  /** What the shared Details panel shows. */
  shown: Shown | undefined
  /** What differs from the other flow, for each of `flows` in the same order. Without it (the switch is off) nothing is marked. */
  marks?: [SideMarks, SideMarks]
  onPick: (picked: Picked) => void
  onClosePanel: () => void
  onEmpty: () => void
  fitKey: string
  colorMode: ColorMode
  problems: Problem[]
  lines: LineStyle
  still: boolean
  ref?: Ref<PaneHandle>
}

/**
 * Swap: one canvas at full width for the two flows of a comparison, flipping between them. Both flows are alive (each keeps its step and its Play across swaps) but only the one
 * on show is drawn at rest. A swap runs between the two diagrams: boxes both flows draw glide to their new place, boxes only the new flow draws fade in, boxes only the old one
 * drew fade out, and the lines fade out first and back in once the boxes have settled. The glide is a CSS transition on the boxes' transform, so a big flow costs React two renders,
 * not one for every frame. A swap during a swap goes back from where it is: the transitions retarget and nothing is left half faded. Under reduced motion it cuts.
 */
export function SwapCanvas({ model, paneId, flows, index, start, shown, marks, onPick, onClosePanel, onEmpty, fitKey, colorMode, problems, lines, still, ref }: Props) {
  const own = (i: 0 | 1) => index === i
  const selectedBox = shown?.kind === 'object' ? shown.id : undefined
  const selectedLine = shown?.kind === 'line' && shown.from !== undefined && shown.to !== undefined ? lineId(shown.from, shown.to) : undefined
  const startAt = (i: 0 | 1) => (start?.flow === flows[i] && !(i === 1 && flows[0] === flows[1]) ? start.step : undefined)
  const a = usePaneFlow({ model, flowId: flows[0], startAt: startAt(0), problems, selectedBox: own(0) ? selectedBox : undefined, selectedLine: own(0) ? selectedLine : undefined, lines, still })
  const b = usePaneFlow({ model, flowId: flows[1], startAt: startAt(1), problems, selectedBox: own(1) ? selectedBox : undefined, selectedLine: own(1) ? selectedLine : undefined, lines, still })
  const both = [a, b]
  const target = both[index]

  // The swap in progress, worked out while rendering so the first frame already has the swap in it. A press that comes while one runs starts the glide at once (the lines are
  // gone already) and goes back from where the boxes are.
  const [swapping, setSwapping] = useState<Swapping>({ index, phase: 'settled', run: 0, cuts: 0 })
  let now = swapping
  if (swapping.index !== index) {
    const animate = swapDuration(reducedMotion()) > 0
    now = animate
      ? { index, prev: swapping.index, phase: swapping.phase === 'settled' ? 'out' : 'glide', run: swapping.run + 1, cuts: swapping.cuts }
      : { index, phase: 'settled', run: swapping.run + 1, cuts: swapping.cuts + 1 }
    setSwapping(now)
  }
  useEffect(() => {
    if (now.phase === 'settled') return
    const run = now.run
    const wait = setTimeout(() => setSwapping(s => (s.run !== run ? s : s.phase === 'out' ? { ...s, phase: 'glide' } : { ...s, phase: 'settled', prev: undefined })), now.phase === 'out' ? FADE_MS : SWAP_MS + 30)
    return () => clearTimeout(wait)
  }, [now.phase, now.run])

  // The flow that goes off stops where it is, and the panel closes if its shape is not in the flow that comes on.
  const was = useRef(index)
  useEffect(() => {
    if (was.current === index) return
    const left = both[was.current]
    was.current = index
    left.setPlaying(p => p && { ...p, auto: false })
    const there = (id: string) => target.graph.nodes.some(n => n.id === id)
    if (shown?.kind === 'object' && shown.id !== undefined && !there(shown.id)) onClosePanel()
    if (shown?.kind === 'line' && (shown.view !== target.view || !target.graph.edges.some(e => e.id === selectedLine))) onClosePanel()
  }, [index])

  const prev = now.prev === undefined ? undefined : both[now.prev]
  const out = now.phase === 'out'
  let boxes: BoxNode[] = target.nodes
  // The frame has an id for each flow, so the one of the flow that goes off fades out as the other fades in.
  let frames: FrameNode[] = target.frame.map(f => ({ ...f, id: `${FRAME}${index}` }))
  if (prev) {
    const plan = planSwap(prev.nodes, target.nodes)
    const entering = new Set(plan.entering)
    const gone = new Set(plan.leaving)
    const before = new Map(prev.nodes.map(n => [n.id, n.position]))
    // Boxes both flows draw wait where the old flow had them until the lines are gone, then move; new ones wait unseen; old ones stay seen until the boxes move. A box not
    // measured yet is taken for the usual size, so the camera can fit the incoming flow while its boxes are still being measured.
    const sized = (n: BoxNode) => (n.measured ? {} : { initialWidth: BOX.width, initialHeight: BOX.height })
    boxes = [
      ...target.nodes.map(n => ({ ...n, ...sized(n), ...(entering.has(n.id) ? { className: classes(n.className, out && 'swap-hide') } : out ? { position: before.get(n.id)! } : {}) })),
      ...prev.nodes.filter(n => gone.has(n.id)).map(n => ({ ...n, ...sized(n), selected: false, className: classes(n.className, !out && 'swap-hide') })),
    ]
    frames = [
      ...frames.map(f => ({ ...f, className: classes(out && 'swap-hide') })),
      ...prev.frame.map(f => ({ ...f, id: `${FRAME}${now.prev}`, className: classes(!out && 'swap-hide') })),
    ]
  }
  const edges = (prev && out ? prev : target).edges
  const spots = (prev && out ? prev : target).spots
  const fitNow = useRef<(options: Omit<FitViewOptions, 'nodes'>) => void>(undefined)
  const fit = () => fitNow.current?.({ ...fitOptions(0, true), duration: 300 })
  useImperativeHandle(ref, () => ({ ...target.keys, fit, inside: () => false, up: () => undefined }))
  const name = target.flow?.name || flows[index]
  const settled = now.phase === 'settled'

  return (
    <section className={classes('pane', 'swap-canvas', !settled && 'swapping', target.flow && usesStates(target.flow) && 'states')} aria-label={name}
      style={{ '--swap-ms': `${SWAP_MS}ms`, '--fade-ms': `${FADE_MS}ms` } as CSSProperties}>
      <h2 className="pane-title" title={name}>{name}</h2>
      <div className="pane-canvas">
        <LineStyleContext value={lines}>
          <LabelSpots spots={spots}>
            <ChangeMarksContext value={marks?.[index]}>
              <ReactFlow
                id={`swap-${paneId}`}
                nodes={[...frames, ...boxes]}
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
                onNodesChange={changes => {
                  a.onNodesChange(changes)
                  b.onNodesChange(changes)
                }}
                onNodeClick={(_, node) => {
                  if (node.type === 'box') onPick({ kind: 'object', id: node.id })
                }}
                onEdgeClick={(_, e) => {
                  if (!isStepLine(e.id)) onPick({ kind: 'line', from: e.source, to: e.target, view: target.view })
                }}
                onEdgeMouseEnter={(_, e) => target.setHovered(e.id)}
                onEdgeMouseLeave={() => target.setHovered(undefined)}
                onPaneClick={onEmpty}
                onInit={instance => {
                  fitNow.current = options => void instance.fitView(options)
                }}
              >
                <Camera count={boxes.length + frames.length} fitKey={`${paneId} ${now.cuts} ${fitKey}`} player panel={0} nav={0} refitOnResize={false} />
                <SwapCamera go={now.phase === 'glide' ? now.run : 0} ids={[...target.frame.map(() => `${FRAME}${index}`), ...target.nodes.map(n => n.id)]} />
                <ZoomControls fit={fitOptions(0, true)} />
                {settled && <PaneMotions p={target} />}
              </ReactFlow>
            </ChangeMarksContext>
          </LabelSpots>
        </LineStyleContext>
      </div>
      <PanePlayer model={model} p={target} marks={marks?.[index]} />
    </section>
  )
}
