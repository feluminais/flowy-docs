import { useMemo, useRef, useState } from 'react'
import type { NodeChange } from '@xyflow/react'
import { leavesMarks } from '../../src/core/animation.ts'
import type { LineStyle, Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import { nameOf } from '../../src/core/views.ts'
import { focusEdges, frameNode, lineId, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode } from './graph.ts'
import { labelSpots } from './Line.tsx'
import { usePlayback, usePlayer } from './usePlayer.ts'
import { useFlowStage } from './useFlowStage.ts'

/**
 * Everything one flow of a comparison needs to be drawn and played on a canvas: its own player (the step it is at, Play), the stage that step puts on screen, and the boxes, frame
 * and lines of its view. A pane of a side-by-side comparison draws one of these; the canvas of Swap keeps two alive and draws the one on show, so each flow keeps its place
 * while the other is on.
 */
export function usePaneFlow({ model, flowId, startAt, problems, selectedBox, selectedLine, lines, still }: {
  model: Model
  flowId: string
  /** The stop to start at (the flow was playing there when the comparison opened). */
  startAt?: number
  problems: Problem[]
  /** The shape and the line the shared panel shows, when it was this flow's canvas that showed them. */
  selectedBox?: string
  selectedLine?: string
  lines: LineStyle
  still: boolean
}) {
  const flow = Object.hasOwn(model.flows, flowId) ? model.flows[flowId] : undefined
  const view = flow?.view ?? ROOT
  const player = usePlayer({ initialFlow: () => flowId, initialStep: startAt })
  const { playing, setPlaying, replays, replay, repeat, toggleRepeat, settledKey, setSettledKey } = player
  const stage = useFlowStage({ model, view, flow, playing, replays })
  const { stops, stopIndex, flowMarks, shown, animated, moving, stepKey } = stage
  const { finished, stepTo, togglePlay } = usePlayback({ playing, setPlaying, flow, stops, stopIndex, stepKey, moving, motions: animated.length, settledKey, setSettledKey })
  const graph = useMemo(() => toGraph(model, view, shown, problems, flowMarks), [model, view, shown, problems, flowMarks])
  const marksHere = useMemo(() => Object.fromEntries(graph.nodes.flatMap(n => (n.data.state ? [[n.id, n.data.state] as const] : []))), [graph])
  const sizes = useRef(new Map<string, { width: number; height: number }>()) // what each box measured (see Reader: React Flow forgets it on every new node object)
  const [hovered, setHovered] = useState<string>()

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
  /** What the keys reach: the same steps the player's buttons take. */
  const keys = {
    step: (by: 1 | -1) => stepTo(stopIndex + by),
    end: (which: 'first' | 'last') => stepTo(which === 'first' ? 0 : stops.length - 1),
    play: togglePlay,
    replay,
  }
  return { ...stage, flow, view, playing, setPlaying, replay, repeat, toggleRepeat, finished, stepTo, togglePlay, graph, marksHere, nodes, frame, edges, spots, setHovered, onNodesChange, keys }
}

export type PaneFlow = ReturnType<typeof usePaneFlow>
