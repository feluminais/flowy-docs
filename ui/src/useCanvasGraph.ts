import { useMemo, useRef } from 'react'
import type { Edge, XYPosition } from '@xyflow/react'
import type { LineStyle, Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import type { StateMark } from '../../src/core/states.ts'
import { leavesMarks } from '../../src/core/animation.ts'
import { nameOf } from '../../src/core/views.ts'
import { focusEdges, frameNode, lineId, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode, Playing } from './graph.ts'
import { labelSpots } from './Line.tsx'
import { keepSame, nothingKept } from './stable.ts'
import type { Kept } from './stable.ts'
import type { useFailuresView } from './useFailuresView.ts'
import type { useFlowStage } from './useFlowStage.ts'
import type { useRunDrawing } from './useRunDrawing.ts'

/**
 * The graph the canvas draws: the shapes and lines of the view, dressed for what is on show (the states, the traffic of a run, the failure marks, the picked shapes), and handed to React
 * Flow as the same objects as last time wherever they say the same.
 */
export function useCanvasGraph({ model, view, shown, problems, stateMarks, loadTraffic, failMarks, scrubbing, moved, pickedSet, litClass, usedClass, lit, openLevel, animated, still, selectedBox, selectedLine, lines }: {
  model: Model; view: string; shown: Playing | undefined; problems: Problem[]; stateMarks: Record<string, StateMark>; loadTraffic: ReturnType<typeof useRunDrawing>['loadTraffic']
  failMarks: ReturnType<typeof useFailuresView>['failMarks']; scrubbing: boolean; moved: ReadonlyMap<string, XYPosition>; pickedSet: ReadonlySet<string | undefined>
  litClass: (id: string) => string | undefined; usedClass: (id: string) => string | undefined; lit: ReturnType<typeof useFailuresView>['lit']
  openLevel: (() => void) | undefined; animated: ReturnType<typeof useFlowStage>['animated']; still: boolean; selectedBox: string | undefined; selectedLine: string | undefined
  lines: LineStyle
}) {
  // What each box measured. React Flow throws a box's measurements away when it gets a node object
  // it hasn't seen, which every render here is, and its lines have nowhere to land until the browser
  // has measured it again: they'd blink away for a frame on every drag, click and hover.
  const sizes = useRef(new Map<string, { width: number; height: number }>())
  const graph = useMemo(() => toGraph(model, view, shown, problems, stateMarks), [model, view, shown, problems, stateMarks])
  // The states on the canvas now, for the key: a shape on another view that is in one is not drawn here.
  const marksHere = useMemo(() => Object.fromEntries(graph.nodes.flatMap(n => (n.data.state ? [[n.id, n.data.state] as const] : []))), [graph])
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
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })), openLevel)]
  const keptFlowNodes = useRef<Kept<BoxNode | FrameNode>>(nothingKept)
  keptFlowNodes.current = keepSame(keptFlowNodes.current, [...frame, ...nodes])
  // The lines a pipe plays along move their labels aside (see Line), unless motion is reduced and there is no pipe. A step that leaves marks (a cross, a bar) keeps its label clear of them.
  const pipes = animated.filter(m => !still || leavesMarks(m.animation)).map(m => lineId(m.placed[0], m.placed[1])).join('\n')
  const keptEdges = useRef<Kept<Edge>>(nothingKept)
  const edgesNow = useMemo(() => {
    const lifted = new Set(pipes === '' ? [] : pipes.split('\n'))
    const drawn = focusEdges(graph.edges, { box: selectedBox, line: selectedLine }).map(e => (lifted.has(e.id) ? { ...e, data: { ...e.data, lift: true } } : e))
    // A picked failure mode outlines its line and fades every other.
    return lit === undefined ? drawn : drawn.map(e => ({ ...e, className: [e.className, e.id === lit.failsLine ? `fails band-${lit.band}` : 'dim'].filter(Boolean).join(' ') }))
  }, [graph, selectedBox, selectedLine, pipes, lit])
  keptEdges.current = keepSame(keptEdges.current, edgesNow)
  const edges = keptEdges.current.list as Edge[] // a hover changes one or two lines, and only those draw again
  // Labels that would overlap (the lines of a selected shape) are spread along their lines. They follow the boxes, so a drag moves them.
  const placedAt = nodes.map(n => `${n.position.x},${n.position.y},${n.measured?.width},${n.measured?.height}`).join(' ')
  const spots = useMemo(() => labelSpots(lines, edges, nodes), [lines, edges, placedAt])
  return { graph, marksHere, nodes, flowNodes: keptFlowNodes.current.list as (BoxNode | FrameNode)[], shapes: nodes.length + frame.length, edges, spots, sizes }
}
