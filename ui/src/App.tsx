import { useEffect, useMemo, useRef, useState } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import type { NodeChange, XYPosition } from '@xyflow/react'
import { check, typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Model, Step } from '../../src/core/model.ts'
import { connect, deleteObject, placeBoxes, removeConnection } from '../../src/core/ops.ts'
import { chain, hasChildren, parentOf, placeEnds } from '../../src/core/views.ts'
import { Box } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { connectionsOf, locate, nameOf } from './edit.ts'
import { fitOptions, focusEdges, lineId, toGraph } from './graph.ts'
import type { BoxNode, Playing } from './graph.ts'
import { Line } from './Line.tsx'
import { AddPanel, LinePanel, ObjectPanel, Recorder } from './Panel.tsx'
import type { Recording, Run } from './Panel.tsx'
import { useModel } from './useModel.ts'
import type { Edit } from './useModel.ts'

const nodeTypes = { box: Box }
const edgeTypes = { line: Line }
const DOUBLE_CLICK = 250 // ms a click on a box that opens waits, in case it is the first half of a double-click

/** What the side panel shows. One thing at a time. */
type Side =
  | { kind: 'object'; id: string }
  | { kind: 'line'; from: string; to: string }
  | { kind: 'add' }
  | ({ kind: 'flow' } & Recording)

/** A box clicked while recording: the first one starts the step, the second ends it, a third starts over. */
function pick(rec: Recording, id: string): Recording {
  if (!rec.id) return rec
  if (!rec.from || rec.to) return { ...rec, from: id, to: undefined }
  return id === rec.from ? rec : { ...rec, to: id }
}

export function App() {
  const { model, banner, edit } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {model && <Reader model={model} edit={edit} readOnly={banner !== undefined} />}
    </div>
  )
}

/** "N problems": a list that opens from the top bar. Picking one shows where it is. */
function Problems({ problems, onPick }: { problems: Problem[]; onPick: (p: Problem) => void }) {
  if (problems.length === 0) return null
  return (
    <details className="problems">
      <summary>{problems.length} problem{problems.length === 1 ? '' : 's'}</summary>
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

function Reader({ model, edit, readOnly }: { model: Model; edit: Edit; readOnly: boolean }) {
  const [viewId, setViewId] = useState(ROOT)
  const [side, setSide] = useState<Side>()
  const [playing, setPlaying] = useState<{ flow: string; step: number }>()
  const [editMode, setEditMode] = useState(false)
  const [notice, setNotice] = useState<string>()
  // Where boxes are being dragged to. Nodes are controlled, so a box only moves through this.
  const [moved, setMoved] = useState(new Map<string, XYPosition>())
  const layoutSaves = useRef(0) // layout saves still queued; `moved` is cleared once the last one is back
  const [hovered, setHovered] = useState<string>() // the line the pointer is on
  const opening = useRef<ReturnType<typeof setTimeout>>(undefined) // a click on a box that opens, waiting out the double-click window

  const editing = editMode && !readOnly // a file that can't be read, or a lost server, makes the canvas read-only
  // A box with children opens. In edit mode an empty system, app or store opens too, so its first child can be added.
  const canOpen = (id: string) => hasChildren(model, id) || (editing && typesIn(model, id).length > 0)
  // After a live reload the view's object may be gone or empty: show the nearest view that still exists.
  const view = chain(model, viewId).find(v => v === ROOT || canOpen(v)) ?? ROOT
  const problems = useMemo(() => check(model), [model])
  const recording = editing && side?.kind === 'flow' ? side : undefined
  const flowsHere = Object.entries(model.flows).filter(([, f]) => f.view === view && (editing || f.steps.length > 0))
  const flow = editing ? undefined : flowsHere.find(([id]) => id === playing?.flow)?.[1]
  const stepIndex = flow && playing ? Math.min(playing.step, flow.steps.length - 1) : 0
  const step = flow?.steps[stepIndex]
  const chosen = flow ? playing?.flow : recording?.id // what the flow list shows

  // A drag re-renders on every mouse move, and dagre takes tens of ms on a big view, so the graph is
  // rebuilt only when what it is built from changes. `flow`, `recording` and `model` keep their identity between renders.
  const shown = useMemo<Playing | undefined>(() => {
    const placeSteps = (steps: Step[]) => steps.map(s => placeEnds(model, view, s.from, s.to))
    if (flow) return { ends: placeSteps(flow.steps), step: stepIndex }
    if (!recording) return undefined
    const done = placeSteps(Object.hasOwn(model.flows, recording.id) ? model.flows[recording.id].steps : [])
    return recording.from && recording.to
      ? { ends: [...done, placeEnds(model, view, recording.from, recording.to)], step: done.length }
      : { ends: done }
  }, [model, view, flow, stepIndex, recording])
  const graph = useMemo(() => toGraph(model, view, shown, problems), [model, view, shown, problems])
  const picked = side?.kind === 'object' ? [side.id] : recording ? [recording.from, recording.to] : []
  // Nodes are controlled: selection and drag positions only show through these props, applied on every render after the memoized graph.
  const nodes = graph.nodes.map(n => ({ ...n, position: moved.get(n.id) ?? n.position, selected: picked.includes(n.id) }))
  const selectedLine = side?.kind === 'line' ? lineId(side.from, side.to) : undefined
  const selectedBox = side?.kind === 'object' ? side.id : undefined
  const edges = useMemo(() => focusEdges(graph.edges, { box: selectedBox, line: selectedLine, hover: hovered }), [graph, selectedBox, selectedLine, hovered])

  const run: Run = async op => {
    setNotice(undefined)
    const message = await edit(op)
    setNotice(message)
    return message === undefined
  }
  const close = () => setSide(undefined)
  const go = (id: string) => {
    clearTimeout(opening.current)
    setViewId(id)
    setPlaying(undefined)
    setMoved(new Map())
    setSide(s => (s?.kind === 'object' ? s : undefined)) // lines, Add and recording belong to one view
  }
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, flow.steps.length - 1)) })
  const toggleEdit = () => {
    setEditMode(!editing)
    setNotice(undefined) // "Press E to fix this flow" is stale the moment E is pressed
    setPlaying(undefined)
    setSide(s => (s?.kind === 'object' || s?.kind === 'line' ? s : undefined))
  }
  const remove = () => {
    if (side?.kind === 'object') void run(m => deleteObject(m, side.id)).then(saved => saved && close())
    if (side?.kind !== 'line') return
    const lines = connectionsOf(model, view, side.from, side.to)
    if (lines.length > 1) return setNotice(`This line stands for ${lines.length} connections. Delete them one at a time in the panel.`)
    const c = lines[0]?.connection
    if (c) void run(m => removeConnection(m, { from: c.from, to: c.to, label: c.label ?? '' })).then(saved => saved && close())
  }
  const jump = (p: Problem) => {
    const spot = locate(model, p)
    go(spot.view)
    if (spot.object) setSide({ kind: 'object', id: spot.object })
    else if (spot.line) setSide({ kind: 'line', from: spot.line[0], to: spot.line[1] })
    else if (spot.flow !== undefined && editing) setSide({ kind: 'flow', id: spot.flow, name: model.flows[spot.flow].name })
    else if (spot.flow !== undefined) {
      // The player only lists flows with steps in a view that opens (flowsHere); locate() falls back to ROOT for a bad view.
      const f = model.flows[spot.flow]
      if (f.view === spot.view && f.steps.length > 0) setPlaying({ flow: spot.flow, step: spot.step ?? 0 })
      else setNotice(readOnly ? `This flow can't play yet. Fix ${p.file} first.` : 'Press E to fix this flow in edit mode.')
    }
  }
  // A drag (or an arrow key on a selected box) ends with dragging: false. Then the whole view's layout is saved.
  const onNodesChange = (changes: NodeChange<BoxNode>[]) => {
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
    void run(m => placeBoxes(m, view, boxes)).then(() => {
      layoutSaves.current--
      if (layoutSaves.current === 0) setMoved(new Map())
    })
  }

  // Added again on every render, so the handler always sees the current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (flow && e.key === 'ArrowRight') stepTo(stepIndex + 1)
      else if (flow && e.key === 'ArrowLeft') stepTo(stepIndex - 1)
      else if (flow && e.key === 'Escape') setPlaying(undefined)
      else if (recording?.from && e.key === 'Escape') setSide({ ...recording, from: undefined, to: undefined })
      else if (e.key === 'Escape') setSide(undefined)
      else if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey && !readOnly) toggleEdit()
      else if (editing && e.key === 'Delete') remove()
      else if (e.key === 'Backspace' && view !== ROOT && !recording) go(parentOf(model, view))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <>
      <header className="bar">
        <nav className="crumbs" aria-label="Zoom level">
          {chain(model, view).reverse().map(id => (
            <button key={id} disabled={id === view} onClick={() => go(id)}>{nameOf(model, id)}</button>
          ))}
        </nav>
        {flowsHere.length > 0 && (
          <select value={flowsHere.some(([id]) => id === chosen) ? chosen : ''} aria-label={editing ? 'Edit a flow' : 'Play a flow'} onChange={e => {
            const id = e.target.value
            if (editing) setSide({ kind: 'flow', id, name: model.flows[id].name })
            else setPlaying({ flow: id, step: 0 })
            e.target.blur() // so ← and → step through the flow instead of changing this list
          }}>
            <option value="" disabled>{editing ? '✎ Edit a flow' : '▶ Play a flow'}</option>
            {flowsHere.map(([id, f]) => <option key={id} value={id}>{f.name || id}</option>)}
          </select>
        )}
        {editing && <button onClick={() => setSide({ kind: 'flow', id: '', name: '' })}>New flow</button>}
        {editing && <button onClick={() => setSide({ kind: 'add' })}>Add</button>}
        <span className="grow" />
        <Problems problems={problems} onPick={jump} />
        <button className="toggle" aria-pressed={editing} disabled={readOnly} title="Edit mode (E)" onClick={toggleEdit}>Edit</button>
      </header>
      <main className={editing ? 'canvas editing' : 'canvas'}>
        <ReactFlow
          key={view} // a fresh canvas per view
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          minZoom={0.2} // the default 0.5 stops the fit short, so a wide diagram in a small window is cut off
          fitViewOptions={fitOptions(side !== undefined, flow !== undefined)} // the fit button; Camera does the automatic fits
          colorMode="system"
          nodesDraggable={editing && !recording}
          nodesConnectable={editing && !recording}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          onNodesChange={onNodesChange}
          isValidConnection={c => placeEnds(model, view, c.source, c.target) !== null} // only lines this view can show
          onConnect={c => void run(m => connect(m, { from: c.source, to: c.target }))
            .then(saved => saved && setSide({ kind: 'line', from: c.source, to: c.target }))}
          onNodeClick={(_, node) => {
            clearTimeout(opening.current)
            if (recording) return setSide({ kind: 'flow', ...pick(recording, node.id) })
            const open = () => setSide({ kind: 'object', id: node.id })
            // Zooming into a box is a double-click, and its first click must not open the panel.
            if (canOpen(node.id)) opening.current = setTimeout(open, DOUBLE_CLICK)
            else open()
          }}
          onNodeDoubleClick={(_, node) => {
            if (recording || !canOpen(node.id)) return
            go(node.id)
            close()
          }}
          onEdgeClick={(_, e) => !recording && e.id !== 'step' && setSide({ kind: 'line', from: e.source, to: e.target })}
          onEdgeMouseEnter={(_, e) => setHovered(e.id)}
          onEdgeMouseLeave={() => setHovered(undefined)}
          onPaneClick={() => {
            clearTimeout(opening.current)
            setSide(recording ? { ...recording, from: undefined, to: undefined } : undefined)
          }}
        >
          <Camera count={nodes.length} fitKey={`${view} ${flow ? playing?.flow : ''}`} player={flow !== undefined} reveal={selectedBox} />
          <Controls showInteractive={false} />
        </ReactFlow>
        {nodes.length === 0 && (
          <p className="empty">{editing
            ? 'Nothing here yet. Press Add to put the first box here.'
            : 'Nothing here yet. Ask Claude to map this repo into Flowy, press E to draw it yourself, or add YAML to the flowy/ folder.'}</p>
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss" onClick={() => setNotice(undefined)}>×</button>
          </div>
        )}
        {side?.kind === 'object' && <ObjectPanel model={model} id={side.id} editing={editing} problems={problems} run={run} onClose={close} />}
        {side?.kind === 'line' && (
          <LinePanel model={model} view={view} from={side.from} to={side.to} editing={editing} problems={problems} run={run} onClose={close} />
        )}
        {editing && side?.kind === 'add' && (
          <AddPanel model={model} view={view} run={run} onAdded={id => setSide({ kind: 'object', id })} onClose={close} />
        )}
        {recording && (
          <Recorder model={model} view={view} rec={recording} onChange={rec => setSide({ kind: 'flow', ...rec })} run={run} onClose={close} />
        )}
        {flow && step && (
          <section className="player" aria-live="polite">
            <p className="muted">{flow.name} · Step {stepIndex + 1} of {flow.steps.length}</p>
            <p className="player-ends">{(shown?.ends[stepIndex] ?? [step.from, step.to]).map(id => nameOf(model, id)).join(' → ')}</p>
            <p>{step.text}</p>
            <div className="player-buttons">
              <button disabled={stepIndex === 0} onClick={() => stepTo(stepIndex - 1)}>← Back</button>
              <button disabled={stepIndex === flow.steps.length - 1} onClick={() => stepTo(stepIndex + 1)}>Next →</button>
              <button onClick={() => setPlaying(undefined)}>Stop</button>
            </div>
          </section>
        )}
      </main>
    </>
  )
}
