import { useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import type { ColorMode, FitViewOptions, NodeChange } from '@xyflow/react'
import { followsLanding, leavesMarks } from '../../src/core/animation.ts'
import type { Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import type { SideMarks } from '../../src/core/flowdiff.ts'
import { usesStates } from '../../src/core/states.ts'
import { nameOf } from '../../src/core/views.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { Box, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import type { Picked } from './compare.ts'
import { fitOptions, focusEdges, frameNode, isStepLine, lineId, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode } from './graph.ts'
import { GroupMarks } from './GroupMarks.tsx'
import { LabelSpotsContext, Line, LineStyleContext, labelSpots } from './Line.tsx'
import { Player } from './Player.tsx'
import { StepMotion } from './StepMotion.tsx'
import { usePlayback, usePlayer } from './usePlayer.ts'
import { useFlowStage } from './useFlowStage.ts'

const nodeTypes = { box: Box, frame: Frame }
const edgeTypes = { line: Line }

/** What the keys reach in a pane: the same steps the player's buttons take, on this pane's flow alone. */
export type PaneHandle = {
  step(by: 1 | -1): void
  end(which: 'first' | 'last'): void
  play(): void
  replay(): void
  fit(): void
}

type Props = {
  model: Model
  /** An id of its own for this pane (React Flow wants one for each canvas on a page). It stays with the pane when the sides swap. */
  paneId: string
  /** The flow this pane draws, on that flow's own view. It must be one that plays (see `playable`). */
  flowId: string
  /** The flow's own name: the pane has no other caption. */
  title: string
  focused: boolean
  /** The pane was clicked, or took keyboard focus. */
  onFocus: () => void
  onPick: (picked: Picked) => void
  /** The shape and the line the shared panel shows, when it was this pane that showed them. */
  selectedBox?: string
  selectedLine?: string
  /** What differs from the other flow, to draw on this one. The marks task fills it; the pane draws nothing for it yet. */
  marks?: SideMarks
  /** Changes when the pane should fit its diagram again. A resize (a panel opening beside it) does not: a pane keeps its own zoom and pan. */
  fitKey: string
  colorMode: ColorMode
  problems: Problem[]
  /** How lines look on this screen (the reader's own choice, or the project's). */
  lines: LineStyle
  /** Reduced motion: a pipe moves no labels aside. */
  still: boolean
  ref?: Ref<PaneHandle>
}

/**
 * One flow of a comparison, drawn on its own view with a canvas of its own: its own zoom and pan, and its own player (a card at the foot of the pane), so acting in one pane
 * never moves another. It is the single canvas of the reader (App) cut down to what a flow needs: nothing is dragged, recorded or edited, and a double-click goes nowhere.
 */
export function ComparePane({ model, paneId, flowId, title, focused, onFocus, onPick, selectedBox, selectedLine, fitKey, colorMode, problems, lines, still, ref }: Props) {
  const flow = Object.hasOwn(model.flows, flowId) ? model.flows[flowId] : undefined
  const view = flow?.view ?? ROOT
  const { playing, setPlaying, replays, replay, repeat, toggleRepeat, settledKey, setSettledKey } = usePlayer({ initialFlow: () => flowId })
  const { stops, stopIndex, stop, flowMarks, shown, animated, moving, stepKey, caption, progress, marks: groupMarks } = useFlowStage({ model, view, flow, playing, replays })
  const { finished, stepTo, togglePlay } = usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions: animated.length, settledKey, setSettledKey })
  const graph = useMemo(() => toGraph(model, view, shown, problems, flowMarks), [model, view, shown, problems, flowMarks])
  const marksHere = useMemo(() => Object.fromEntries(graph.nodes.flatMap(n => (n.data.state ? [[n.id, n.data.state] as const] : []))), [graph])
  const sizes = useRef(new Map<string, { width: number; height: number }>()) // what each box measured (see Reader: React Flow forgets it on every new node object)
  const [hovered, setHovered] = useState<string>()
  const fitNow = useRef<(options: Omit<FitViewOptions, 'nodes'>) => void>(undefined)
  const fit = () => fitNow.current?.({ ...fitOptions(0, true), duration: 300 })
  useImperativeHandle(ref, () => ({
    step: by => stepTo(stopIndex + by),
    end: which => stepTo(which === 'first' ? 0 : stops.length - 1),
    play: togglePlay,
    replay,
    fit,
  }))

  const nodes = graph.nodes.map(n => ({ ...n, selected: n.id === selectedBox, measured: sizes.current.get(n.id) }))
  const inner = view === ROOT ? [] : nodes.filter(n => graph.members.includes(n.id))
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })))]
  // The lines a pipe plays along move their labels aside, as on the single canvas.
  const pipes = animated.filter(m => !still || leavesMarks(m.animation)).map(m => lineId(m.placed[0], m.placed[1])).join('\n')
  const edges = useMemo(() => {
    const lifted = new Set(pipes === '' ? [] : pipes.split('\n'))
    return focusEdges(graph.edges, { box: selectedBox, line: selectedLine, hover: hovered }).map(e => (lifted.has(e.id) ? { ...e, data: { lift: true } } : e))
  }, [graph, selectedBox, selectedLine, hovered, pipes])
  const placedAt = nodes.map(n => `${n.position.x},${n.position.y},${n.measured?.width},${n.measured?.height}`).join(' ')
  const spots = useMemo(() => labelSpots(lines, edges, nodes), [lines, edges, placedAt])
  const onNodesChange = (changes: NodeChange<BoxNode | FrameNode>[]) => {
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sizes.current.set(c.id, c.dimensions)
  }

  return (
    <section className={['pane', focused && 'focused', flow && usesStates(flow) && 'states'].filter(Boolean).join(' ')} tabIndex={0} aria-label={title} onFocus={onFocus} onPointerDownCapture={onFocus}>
      <h2 className="pane-title" title={title}>{title}</h2>
      <div className="pane-canvas">
        <LineStyleContext value={lines}>
          <LabelSpotsContext value={spots}>
            <ReactFlow
              id={`pane-${paneId.replace('#', '-again-')}`} // the id ends up in url(#...) references
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
              onNodesChange={onNodesChange}
              onNodeClick={(_, node) => {
                if (node.type === 'box') onPick({ kind: 'object', id: node.id })
              }}
              onEdgeClick={(_, e) => {
                if (!isStepLine(e.id)) onPick({ kind: 'line', from: e.source, to: e.target, view })
              }}
              onEdgeMouseEnter={(_, e) => setHovered(e.id)}
              onEdgeMouseLeave={() => setHovered(undefined)}
              onPaneClick={onFocus}
              onInit={instance => {
                fitNow.current = options => void instance.fitView(options)
              }}
            >
              <Camera count={nodes.length + frame.length} fitKey={`${view} ${flowId} ${fitKey}`} player panel={0} nav={0} refitOnResize={false} />
              <Controls showInteractive={false} fitViewOptions={fitOptions(0, true)} />
              {flow && stop && animated.map(m => (
                <StepMotion key={`${stepKey}:${m.i}`} ends={m.placed} animation={m.animation} by={m.by} afterLanding={stop.before.some(j => followsLanding(shown?.ends[j], m.placed))} repeat={repeat} onDone={() => finished(m.i)} />
              ))}
              <GroupMarks marks={groupMarks} />
            </ReactFlow>
          </LabelSpotsContext>
        </LineStyleContext>
      </div>
      {flow && stop && caption && progress && (
        <Player model={model} flow={flow} stops={stops} stop={stopIndex} ends={shown?.ends ?? []} caption={caption} progress={progress} marks={marksHere} auto={playing?.auto === true} moving={moving}
          repeat={repeat} onStep={stepTo} onAuto={togglePlay} onReplay={replay} onRepeat={toggleRepeat} />
      )}
    </section>
  )
}
