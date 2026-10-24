import { useRef } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { Edge, FitViewOptions, NodeChange, ReactFlowInstance } from '@xyflow/react'
import type { Model } from '../../src/core/model.ts'
import { connect, placeBoxes } from '../../src/core/ops.ts'
import { placeEnds } from '../../src/core/views.ts'
import { DOUBLE_CLICK, isStepLine } from './graph.ts'
import type { BoxNode, FrameNode } from './graph.ts'
import type { SaveEdit } from './forms.tsx'
import type { HoverStore } from './Line.tsx'
import type { Recording } from './Recorder.tsx'
import { addsToSelection, banded, toggled } from './selection.ts'
import { sideFor } from './side.ts'
import type { FlowSide, Side } from './side.ts'
import { useLatest } from './stable.ts'
import type { useCanvasGraph } from './useCanvasGraph.ts'
import type { useEditSession } from './useEditSession.ts'

/** A click on a box that opens waits out the double-click window before its panel opens. A double-click zooms into the box instead, so the panel must not have opened. */
export function useClickWait() {
  const opening = useRef<ReturnType<typeof setTimeout>>(undefined) // a click on a box that opens, waiting out the double-click window
  const openingBox = useRef<string>(undefined) // that box: a Ctrl+click in the meantime still counts it as picked
  const cancelOpen = () => {
    clearTimeout(opening.current)
    openingBox.current = undefined
  }
  return { opening, openingBox, cancelOpen }
}

/** A box clicked while recording: the first one starts the step, the second ends it (the same box again: a step it does on its own), a third starts over. */
function pick(rec: Recording, id: string): Recording {
  if (!rec.id) return rec
  if (!rec.from || rec.to) return { ...rec, from: id, to: undefined }
  return { ...rec, to: id }
}

/**
 * What a click, a drag or a connection on the canvas does. The handlers of the canvas never change, and call the current ones: a new function for each would make React Flow take
 * them in again on every render.
 */
export function useCanvasEvents({ model, view, editing, recording, side, chosen, selectedLine, nodes, members, sizes, session, run, show, setSide, closeDetails, canOpen, zoomInto, hover, wait }: {
  model: Model; view: string; editing: boolean; recording: FlowSide | undefined; side: Side | undefined; chosen: string[]; selectedLine: string | undefined
  nodes: BoxNode[]; members: string[]; sizes: ReturnType<typeof useCanvasGraph>['sizes']; session: ReturnType<typeof useEditSession>; run: SaveEdit
  show: (s: Side | undefined) => void; setSide: (s: Side | undefined) => void; closeDetails: () => void; canOpen: (id: string) => boolean; zoomInto: (id: string) => void
  hover: HoverStore; wait: ReturnType<typeof useClickWait>
}) {
  const { opening, openingBox, cancelOpen } = wait
  const { didSomethingElse } = session
  const fitNow = useRef<(options: Omit<FitViewOptions, 'nodes'>) => void>(undefined) // for F; set once each canvas is ready
  const onSelectionStart = useLatest(() => {
    session.startBanding()
    cancelOpen()
  })
  const onSelectionEnd = useLatest(() => {
    session.endBanding()
  })
  // A drag (or an arrow key on a selected box) ends with dragging: false. Then the whole view's layout is saved.
  const onNodesChange = useLatest((changes: NodeChange<BoxNode | FrameNode>[]) => {
    // The browser measured a box: keep it, so the next render hands it back instead of hiding its lines.
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sizes.current.set(c.id, c.dimensions)
    // Drawing a box round shapes: the ones it takes in are the selection. Boxes outside this view's own (the people and systems around it) stay out.
    if (session.isBanding()) setSide(sideFor(banded(chosen, changes, new Set(members))))
    const moves = changes.flatMap(c => (c.type === 'position' && c.position ? [{ ...c, position: c.position }] : []))
    if (moves.length === 0) return
    session.dragged(moves, next => {
      const boxes = Object.fromEntries(nodes.map(n => {
        const { x, y } = next.get(n.id) ?? n.position
        return [n.id, [Math.round(x), Math.round(y)] as [number, number]]
      }))
      return m => placeBoxes(m, view, boxes)
    })
  })
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
  return { fitNow, onSelectionStart, onSelectionEnd, onNodesChange, isValidConnection, onConnect, onNodeClick, onNodeDoubleClick, onInit, onEdgeClick, onEdgeMouseEnter, onEdgeMouseLeave, onPaneClick }
}
