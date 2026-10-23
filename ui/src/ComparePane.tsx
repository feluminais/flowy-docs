import { Fragment, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import { ReactFlow } from '@xyflow/react'
import type { ColorMode, FitViewOptions } from '@xyflow/react'
import { followsLanding } from '../../src/core/animation.ts'
import type { Model } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import type { SideMarks } from '../../src/core/flowdiff.ts'
import { usesStates } from '../../src/core/states.ts'
import { ROOT } from '../../src/core/model.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { chain, hasChildren, nameOf } from '../../src/core/views.ts'
import { Box, ChangeMarksContext, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { ZoomControls } from './ZoomControls.tsx'
import { paneInside, paneLevel, paneUp } from './compare.ts'
import type { Picked } from './compare.ts'
import { DOUBLE_CLICK, fitOptions, isStepLine } from './graph.ts'
import { GroupMarks } from './GroupMarks.tsx'
import { ChevronRight, Home } from './icons.tsx'
import { LabelSpots, Line, LineStyleContext } from './Line.tsx'
import { Player } from './Player.tsx'
import { StepMotion } from './StepMotion.tsx'
import { usePaneFlow } from './usePaneFlow.ts'
import type { PaneFlow } from './usePaneFlow.ts'

const nodeTypes = { box: Box, frame: Frame }
const edgeTypes = { line: Line }

/** What the keys reach in a pane: the same steps the player's buttons take, on this pane's flow alone. */
export type PaneHandle = {
  step(by: 1 | -1): void
  end(which: 'first' | 'last'): void
  play(): void
  replay(): void
  fit(): void
  /** Whether Esc, Backspace and Z take the pane up a level: it is zoomed into a shape, and not at the top. */
  inside(): boolean
  /** Up a level from the one the pane is zoomed to. */
  up(): void
}

type Props = {
  model: Model
  /** An id of its own for this pane (React Flow wants one for each canvas on a page, and it ends up in `url(#...)` references, so it holds only letters, numbers, `_` and `-`). It stays with the pane when the sides swap. */
  paneId: string
  /** What a screen reader calls the pane, when that is not the title. */
  label?: string
  /** The stop to start at (the flow was playing there when the comparison opened). */
  startAt?: number
  /** A click on the pane's empty area, which also gives it the focus. */
  onEmpty: () => void
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
  /** What differs from the other flow, to draw on this one. Without it (the switch is off) the pane draws nothing for it. */
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
 * never moves another. It is the single canvas of the reader (App) cut down to what a flow needs: nothing is dragged, recorded or edited. A double-click on a shape that opens zooms
 * this pane into it, as on the single canvas, and the other pane stays where it is; a breadcrumb under the title and Esc, Backspace and Z go back up.
 */
export function ComparePane({ model, paneId, label, startAt, onEmpty, flowId, title, focused, onFocus, onPick, selectedBox, selectedLine, marks, fitKey, colorMode, problems, lines, still, ref }: Props) {
  const flowView = Object.hasOwn(model.flows, flowId) ? (model.flows[flowId].view ?? ROOT) : ROOT
  const [zoomed, setZoomed] = useState<string>() // the level the reader zoomed this pane to; none, and it draws its flow's own view
  const level = paneLevel(model, flowView, zoomed)
  const p = usePaneFlow({ model, flowId, level, startAt, problems, selectedBox, selectedLine, lines, still })
  const { flow, view, nodes, frame, edges, spots } = p
  const opening = useRef<ReturnType<typeof setTimeout>>(undefined) // a click on a shape that opens, waiting out the double-click window
  const cancelOpen = () => clearTimeout(opening.current)
  useEffect(() => cancelOpen, [])
  const fitNow = useRef<(options: Omit<FitViewOptions, 'nodes'>) => void>(undefined)
  const fit = () => fitNow.current?.({ ...fitOptions(0, true), duration: 300 })
  useImperativeHandle(ref, () => ({ ...p.keys, fit, inside: () => paneInside(level, flowView), up: () => setZoomed(paneUp(model, level)) }))

  return (
    <section className={['pane', focused && 'focused', flow && usesStates(flow) && 'states'].filter(Boolean).join(' ')} tabIndex={0} aria-label={label ?? title} onFocus={onFocus} onPointerDownCapture={onFocus}>
      <h2 className="pane-title" title={title}>{title}</h2>
      {level !== flowView && (
        <nav className="crumbs pane-crumbs" aria-label={`Zoom level of ${title}`}>
          {chain(model, level).reverse().map((id, i) => (
            <Fragment key={id}>
              {i > 0 && <ChevronRight size={14} />}
              <button disabled={id === level} onClick={() => setZoomed(id)}>{i === 0 && <Home size={16} />}{nameOf(model, id)}</button>
            </Fragment>
          ))}
        </nav>
      )}
      <div className="pane-canvas">
        <LineStyleContext value={lines}>
          <LabelSpots spots={spots}>
            <ChangeMarksContext value={marks}>
              <ReactFlow
                id={`pane-${paneId}`}
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
                  if (node.type !== 'box') return
                  cancelOpen()
                  // A click on a shape that opens waits out the double-click window, so the first half of a double-click neither opens its panel nor closes it (that moves the pane under the second click).
                  if (hasChildren(model, node.id)) opening.current = setTimeout(() => onPick({ kind: 'object', id: node.id }), DOUBLE_CLICK)
                  else onPick({ kind: 'object', id: node.id })
                }}
                onNodeDoubleClick={(_, node) => {
                  if (node.type !== 'box' || !hasChildren(model, node.id)) return
                  cancelOpen()
                  if (selectedBox !== undefined || selectedLine !== undefined) onEmpty() // the zoom replaces the panel this pane had open
                  setZoomed(node.id)
                }}
                onEdgeClick={(_, e) => {
                  if (!isStepLine(e.id)) onPick({ kind: 'line', from: e.source, to: e.target, view })
                }}
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
                <Camera count={nodes.length + frame.length} fitKey={`${view} ${flowId} ${fitKey}`} player panel={0} nav={0} refitOnResize={false} />
                <ZoomControls fit={fitOptions(0, true)} />
                <PaneMotions p={p} />
              </ReactFlow>
            </ChangeMarksContext>
          </LabelSpots>
        </LineStyleContext>
      </div>
      <PanePlayer model={model} p={p} marks={marks} />
    </section>
  )
}

/** The motion of the step on show, on the canvas it is drawn in (inside the ReactFlow), and the marks of the stop's group. */
export function PaneMotions({ p }: { p: PaneFlow }) {
  const { flow, stop, animated, stepKey, shown, repeat, finished } = p
  return (
    <>
      {flow && stop && animated.map(m => (
        <StepMotion key={`${stepKey}:${m.i}`} ends={m.placed} animation={m.animation} by={m.by} afterLanding={stop.before.some(j => followsLanding(shown?.ends[j], m.placed))} repeat={repeat} onDone={() => finished(m.i)} />
      ))}
      <GroupMarks marks={p.marks} />
    </>
  )
}

/** The card at the foot of a pane: the caption of the step on show and the buttons that move through the flow. With marks, its progress bar marks the steps that differ. */
export function PanePlayer({ model, p, marks }: { model: Model; p: PaneFlow; marks?: SideMarks }) {
  const { flow, stop, caption, progress, stops, stopIndex, shown, marksHere, playing, moving, repeat, stepTo, togglePlay, replay, toggleRepeat } = p
  if (!(flow && stop && caption && progress)) return null
  return (
    <Player model={model} flow={flow} stops={stops} stop={stopIndex} ends={shown?.ends ?? []} caption={caption} progress={progress} marks={marksHere} auto={playing?.auto === true} moving={moving}
      changes={marks?.steps} repeat={repeat} onStep={stepTo} onAuto={togglePlay} onReplay={replay} onRepeat={toggleRepeat} />
  )
}
