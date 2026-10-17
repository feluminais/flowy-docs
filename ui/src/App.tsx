import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import type { NodeChange, XYPosition } from '@xyflow/react'
import { typesIn } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { LINE_STYLES, lineStyle, ROOT } from '../../src/core/model.ts'
import type { LineStyle, Model, Step } from '../../src/core/model.ts'
import { connect, deleteObject, forgetLayout, placeBoxes, removeConnection, setLines } from '../../src/core/ops.ts'
import { flowToMermaid, viewToMermaid } from '../../src/core/mermaid.ts'
import { chain, hasChildren, parentOf, placeEnds, placeStep } from '../../src/core/views.ts'
import { Box, Description, Frame } from './Box.tsx'
import { Camera } from './Camera.tsx'
import { connectionsOf, locate, nameOf } from './edit.ts'
import { fitOptions, focusEdges, frameNode, lineId, sizeOf, toGraph } from './graph.ts'
import type { BoxNode, FrameNode, Playing } from './graph.ts'
import { readHash, toHash } from './hash.ts'
import { letter } from './keys.ts'
import { Line, LineStyleContext } from './Line.tsx'
import { keepOwnLines, LINE_NAMES, ownLines } from './lines.ts'
import { AddPanel, LinePanel, ObjectPanel, Recorder } from './Panel.tsx'
import { Search } from './Search.tsx'
import type { Recording, Run } from './Panel.tsx'
import { useModel } from './useModel.ts'
import type { Edit, Loaded } from './useModel.ts'

const nodeTypes = { box: Box, frame: Frame }
const edgeTypes = { line: Line }
const DOUBLE_CLICK = 250 // ms a click on a box that opens waits, in case it is the first half of a double-click
const LEAVE = 220 // ms the old view takes to fly off; keep in sync with the leave-* keyframes in style.css
const ARRIVE = 320 // ms the new view takes to settle; keep in sync with the arrive-* keyframes

/** A zoom between views, heading `to` a view: the old view leaves about (x, y) on the canvas, then the new one arrives there. */
type Motion = { dir: 'in' | 'out'; phase: 'leave' | 'arrive'; x: number; y: number; to: string }

/** What the side panel shows. One thing at a time. */
type Side =
  | { kind: 'object'; id: string }
  | { kind: 'line'; from: string; to: string }
  | { kind: 'add' }
  | ({ kind: 'flow' } & Recording)

/** A box clicked while recording: the first one starts the step, the second ends it (the same box again: a step it does on its own), a third starts over. */
function pick(rec: Recording, id: string): Recording {
  if (!rec.id) return rec
  if (!rec.from || rec.to) return { ...rec, from: id, to: undefined }
  return { ...rec, to: id }
}

export function App() {
  const { loaded, banner, edit, undo, live } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {loaded && <Reader {...loaded} edit={edit} undo={undo} live={live} readOnly={!live || banner !== undefined} />}
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

function Reader({ model, problems, codeBase, edit, undo, live, readOnly }: Loaded & { edit: Edit; undo: () => Promise<string | undefined>; live: boolean; readOnly: boolean }) {
  // A link opens where its address says (see hash.ts). The effects below keep the address up to date.
  const [viewId, setViewId] = useState(() => readHash(location.hash).view)
  const [side, setSide] = useState<Side>()
  const [playing, setPlaying] = useState<{ flow: string; step: number } | undefined>(() => {
    const { flow } = readHash(location.hash)
    return flow === undefined ? undefined : { flow, step: 0 }
  })
  const [editMode, setEditMode] = useState(false)
  const [notice, setNotice] = useState<string>()
  // Where boxes are being dragged to. Nodes are controlled, so a box only moves through this.
  const [moved, setMoved] = useState(new Map<string, XYPosition>())
  // What each box measured. React Flow throws a box's measurements away when it gets a node object
  // it hasn't seen, which every render here is, and its lines have nowhere to land until the browser
  // has measured it again: they'd blink away for a frame on every drag, click and hover.
  const sizes = useRef(new Map<string, { width: number; height: number }>())
  const layoutSaves = useRef(0) // layout saves still queued; `moved` is cleared once the last one is back
  const [hovered, setHovered] = useState<string>() // the line the pointer is on
  const [searching, setSearching] = useState(false)
  const [tidied, setTidied] = useState(0) // Tidy counts up, so the camera fits the new layout
  const opening = useRef<ReturnType<typeof setTimeout>>(undefined) // a click on a box that opens, waiting out the double-click window
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
  const flow = editing ? undefined : flowsHere.find(([id]) => id === playing?.flow)?.[1]
  const stepIndex = flow && playing ? Math.min(playing.step, flow.steps.length - 1) : 0
  const step = flow?.steps[stepIndex]
  const chosen = flow ? playing?.flow : recording?.id // what the flow list shows

  // A drag re-renders on every mouse move, and dagre takes tens of ms on a big view, so the graph is
  // rebuilt only when what it is built from changes. `flow`, `recording` and `model` keep their identity between renders.
  const shown = useMemo<Playing | undefined>(() => {
    const placeSteps = (steps: Step[]) => steps.map(s => placeStep(model, view, s))
    if (flow) return { ends: placeSteps(flow.steps), step: stepIndex }
    if (!recording) return undefined
    const done = placeSteps(Object.hasOwn(model.flows, recording.id) ? model.flows[recording.id].steps : [])
    return recording.from && recording.to
      ? { ends: [...done, placeStep(model, view, { from: recording.from, to: recording.to === recording.from ? undefined : recording.to })], step: done.length }
      : { ends: done }
  }, [model, view, flow, stepIndex, recording])
  const graph = useMemo(() => toGraph(model, view, shown, problems), [model, view, shown, problems])
  const picked = side?.kind === 'object' ? [side.id] : recording ? [recording.from, recording.to] : []
  // Nodes are controlled: selection and drag positions only show through these props, applied on every render after the memoized graph.
  const nodes = graph.nodes.map(n => ({ ...n, position: moved.get(n.id) ?? n.position, selected: picked.includes(n.id), measured: sizes.current.get(n.id) }))
  // Inside a box, a frame named after it wraps its own boxes and follows them while they're dragged.
  const inner = view === ROOT ? [] : nodes.filter(n => graph.members.includes(n.id))
  const frame = inner.length === 0 ? [] : [frameNode(nameOf(model, view), inner.map(n => ({ ...n.position, ...sizeOf(n) })))]
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
  const takeBack = async () => {
    setNotice(undefined)
    setNotice((await undo()) ?? 'Undone.')
    setMoved(new Map()) // a box dragged back shows where the file says
  }
  // Fenced, so it pastes straight into a README or a PR, where GitHub draws it.
  const copyMermaid = async () => {
    const diagram = flow && playing ? flowToMermaid(model, playing.flow) : viewToMermaid(model, view)
    try {
      await navigator.clipboard.writeText('```mermaid\n' + diagram + '```\n')
      setNotice(`Copied ${flow ? 'this flow' : 'this view'} as Mermaid. Paste it into a README or a PR: GitHub draws it.`)
    } catch {
      setNotice("Couldn't copy: the browser didn't allow it.")
    }
  }
  const go = (id: string) => {
    clearTimeout(opening.current)
    clearTimeout(motionTimer.current)
    setMotion(undefined)
    setViewId(id)
    setPlaying(undefined)
    setMoved(new Map())
    setSide(s => (s?.kind === 'object' ? s : undefined)) // lines, Add and recording belong to one view
  }
  /** Open `id` with a zoom. A second zoom on the way, or reduced motion, opens it straight away. */
  const zoomTo = (id: string, dir: Motion['dir'], x: number, y: number) => {
    if (motion || matchMedia('(prefers-reduced-motion: reduce)').matches) return go(id)
    setMotion({ dir, phase: 'leave', x, y, to: id })
    motionTimer.current = setTimeout(() => {
      go(id)
      setMotion({ dir, phase: 'arrive', x, y, to: id })
      motionTimer.current = setTimeout(() => setMotion(undefined), ARRIVE)
    }, LEAVE)
  }
  /** Zoom out to `id`, about the middle of the canvas: the box's place in the outer view isn't known until it's drawn. */
  const zoomOut = (id: string) => {
    const r = canvas.current?.getBoundingClientRect()
    zoomTo(id, 'out', (r?.width ?? 0) / 2, (r?.height ?? 0) / 2)
  }
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, flow.steps.length - 1)) })
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
    quiet.current = true // E isn't a step to go back to
    setEditMode(!editing)
    setNotice(undefined) // "Press E to fix this flow" is stale the moment E is pressed
    setPlaying(undefined)
    setSide(s => (s?.kind === 'object' || s?.kind === 'line' ? s : undefined))
  }
  const remove = () => {
    if (side?.kind === 'object') void run(m => deleteObject(m, side.id)).then(saved => saved && close())
    if (side?.kind !== 'line') return
    const merged = connectionsOf(model, view, side.from, side.to)
    if (merged.length > 1) return setNotice(`This line stands for ${merged.length} connections. Delete them one at a time in the panel.`)
    const c = merged[0]?.connection
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
  const onNodesChange = (changes: NodeChange<BoxNode | FrameNode>[]) => {
    // The browser measured a box: keep it, so the next render hands it back instead of hiding its lines.
    for (const c of changes) if (c.type === 'dimensions' && c.dimensions) sizes.current.set(c.id, c.dimensions)
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

  // The address names the view and the flow playing, so a link opens there and Back goes back. It's checked
  // on every render. A step the reader takes pushes an entry. Anything else replaces the address: the page
  // opening (which also drops a part that named nothing), Back or a typed address, E, or a live reload that
  // falls back to another view.
  const address = toHash(view, flow ? playing?.flow : undefined)
  useEffect(() => {
    if (quiet.current || address !== location.hash)
      history[quiet.current || view !== viewId ? 'replaceState' : 'pushState'](null, '', address || location.pathname + location.search)
    quiet.current = false
  })

  // Back, Forward, or an address typed in: show what it names. Added again on every render, like the keys below.
  useEffect(() => {
    const follow = () => {
      quiet.current = true
      const named = readHash(location.hash)
      go(named.view)
      if (named.flow !== undefined) setPlaying({ flow: named.flow, step: 0 })
    }
    window.addEventListener('popstate', follow)
    window.addEventListener('hashchange', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      window.removeEventListener('hashchange', follow)
    }
  })

  // Added again on every render, so the handler always sees the current state.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const key = letter(e)
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (flow && e.key === 'ArrowRight') stepTo(stepIndex + 1)
      else if (flow && e.key === 'ArrowLeft') stepTo(stepIndex - 1)
      else if (flow && e.key === 'Escape') setPlaying(undefined)
      else if (recording?.from && e.key === 'Escape') setSide({ ...recording, from: undefined, to: undefined })
      else if (e.key === 'Escape') setSide(undefined)
      else if ((key === 'k' && (e.ctrlKey || e.metaKey)) || e.key === '/' || (e.code === 'Slash' && !e.shiftKey)) setSearching(true)
      else if (key === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat && !readOnly) toggleEdit()
      else if (editing && e.key === 'Delete') remove()
      else if (editing && (e.ctrlKey || e.metaKey) && !e.shiftKey && key === 'z' && !e.repeat) void takeBack() // held down, it would empty the whole stack
      // A second Backspace while a zoom out is still leaving goes up from where that one is heading.
      else if (e.key === 'Backspace' && view !== ROOT && !recording)
        zoomOut(parentOf(model, motion?.phase === 'leave' && motion.dir === 'out' ? motion.to : view))
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
            <button key={id} disabled={id === view} onClick={() => zoomOut(id)}>{nameOf(model, id)}</button>
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
        {editing && <button title="Undo the last change (Ctrl+Z)" onClick={() => void takeBack()}>Undo</button>}
        {editing && (
          <button title="Forget where boxes here were dragged, and lay this view out again" onClick={() => void run(m => forgetLayout(m, view)).then(saved => {
            if (!saved) return
            setMoved(new Map())
            setTidied(n => n + 1)
          })}>
            Tidy
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
        <button title="Find a box (Ctrl+K or /)" aria-pressed={searching} onMouseDown={e => searching && e.preventDefault()} onClick={() => setSearching(!searching)}>Search</button>
        <button title="Copy this view, or the flow playing, as a Mermaid diagram" onClick={() => void copyMermaid()}>Mermaid</button>
        <Problems problems={problems} onPick={jump} />
        {live && <button className="toggle" aria-pressed={editing} disabled={readOnly} title="Edit mode (E)" onClick={toggleEdit}>Edit</button>}
      </header>
      <main ref={canvas} className={['canvas', editing && 'editing', motion && `${motion.phase}-${motion.dir}`].filter(Boolean).join(' ')}
        style={motion && ({ '--ox': `${motion.x}px`, '--oy': `${motion.y}px` } as CSSProperties)}>
        <LineStyleContext value={lines}>
          <ReactFlow
            key={view} // a fresh canvas per view
            nodes={[...frame, ...nodes]}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            minZoom={0.2} // the default 0.5 stops the fit short, so a wide diagram in a small window is cut off
            colorMode="system"
            defaultMarkerColor="var(--edge)"
            nodesDraggable={editing && !recording}
            nodesConnectable={editing && !recording}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            onNodesChange={onNodesChange}
            isValidConnection={c => placeEnds(model, view, c.source, c.target) !== null} // only lines this view can show
            onConnect={c => void run(m => connect(m, { from: c.source, to: c.target }))
              .then(saved => saved && setSide({ kind: 'line', from: c.source, to: c.target }))}
            onNodeClick={(_, node) => {
              if (node.type !== 'box') return // the frame takes no pointer events, this is a guard
              clearTimeout(opening.current)
              if (recording) return setSide({ kind: 'flow', ...pick(recording, node.id) })
              const open = () => setSide({ kind: 'object', id: node.id })
              // Zooming into a box is a double-click, and its first click must not open the panel.
              if (canOpen(node.id)) opening.current = setTimeout(open, DOUBLE_CLICK)
              else open()
            }}
            onNodeDoubleClick={(e, node) => {
              if (recording || node.type !== 'box' || !canOpen(node.id)) return
              clearTimeout(opening.current) // the second click queued the panel; the zoom replaces it
              close()
              const c = canvas.current!.getBoundingClientRect()
              const b = (e.target as Element).closest('.react-flow__node')!.getBoundingClientRect()
              zoomTo(node.id, 'in', b.x + b.width / 2 - c.x, b.y + b.height / 2 - c.y)
            }}
            onEdgeClick={(_, e) => !recording && e.id !== 'step' && setSide({ kind: 'line', from: e.source, to: e.target })}
            onEdgeMouseEnter={(_, e) => setHovered(e.id)}
            onEdgeMouseLeave={() => setHovered(undefined)}
            onPaneClick={() => {
              clearTimeout(opening.current)
              setSide(recording ? { ...recording, from: undefined, to: undefined } : undefined)
            }}
          >
            <Camera count={nodes.length + frame.length} fitKey={`${view} ${flow ? playing?.flow : ''} ${tidied}`} player={flow !== undefined} reveal={selectedBox} />
            {/* The fit button reads its own options, not ReactFlow's fitViewOptions. Camera does the automatic fits. */}
            <Controls showInteractive={false} fitViewOptions={fitOptions(side !== undefined, flow !== undefined)} />
          </ReactFlow>
        </LineStyleContext>
        {nodes.length === 0 && (
          <p className="empty">{editing
            ? 'Nothing here yet. Press Add to put the first box here.'
            : live
              ? 'Nothing here yet. Ask Claude to map this repo into Flowy, press E to draw it yourself, or add YAML to the flowy/ folder.'
              : 'Nothing here yet.'}</p>
        )}
        {searching && (
          <Search model={model} onClose={() => setSearching(false)} onPick={id => {
            setSearching(false)
            go(parentOf(model, id)) // the view the box sits in
            setSide({ kind: 'object', id })
          }} />
        )}
        {notice && (
          <div className="notice" role="status">
            <span>{notice}</span>
            <button aria-label="Dismiss" onClick={() => setNotice(undefined)}>×</button>
          </div>
        )}
        {side?.kind === 'object' && <ObjectPanel model={model} id={side.id} editing={editing} problems={problems} codeBase={codeBase} run={run} onClose={close} />}
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
            <p className="player-ends">{[...new Set(shown?.ends[stepIndex] ?? [step.from, step.to ?? step.from])].map(id => nameOf(model, id)).join(' → ')}</p>
            <p>{step.text}</p>
            {step.description && (
              <details key={stepIndex} className="more">
                <summary>More</summary>
                <Description text={String(step.description)} />
              </details>
            )}
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
