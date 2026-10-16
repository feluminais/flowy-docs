import { useEffect, useState } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import { check } from '../../src/core/check.ts'
import type { Problem } from '../../src/core/check.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { chain, hasChildren, parentOf, placeEnds } from '../../src/core/views.ts'
import { Box } from './Box.tsx'
import { locate, nameOf } from './edit.ts'
import { lineId, toGraph } from './graph.ts'
import { LinePanel, ObjectPanel } from './Panel.tsx'
import { useModel } from './useModel.ts'

const nodeTypes = { box: Box }

/** What the side panel shows. One thing at a time. */
type Side = { kind: 'object'; id: string } | { kind: 'line'; from: string; to: string }

export function App() {
  const { model, banner } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {model && <Reader model={model} />}
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

function Reader({ model }: { model: Model }) {
  const [viewId, setViewId] = useState(ROOT)
  const [side, setSide] = useState<Side>()
  const [playing, setPlaying] = useState<{ flow: string; step: number }>()

  // After a live reload the view's object may be gone or empty: show the nearest view that still exists.
  const view = chain(model, viewId).find(v => v === ROOT || hasChildren(model, v)) ?? ROOT
  const problems = check(model)
  const flowsHere = Object.entries(model.flows).filter(([, f]) => f.view === view && f.steps.length > 0)
  const flow = flowsHere.find(([id]) => id === playing?.flow)?.[1]
  const stepIndex = flow && playing ? Math.min(playing.step, flow.steps.length - 1) : 0
  const step = flow?.steps[stepIndex]
  const allEnds = flow?.steps.map(s => placeEnds(model, view, s.from, s.to))
  const ends = allEnds?.[stepIndex]
  const graph = toGraph(model, view, allEnds && { ends: allEnds, step: stepIndex }, problems)
  // Nodes and edges are controlled: selection only shows through these props.
  const nodes = graph.nodes.map(n => (side?.kind === 'object' && n.id === side.id ? { ...n, selected: true } : n))
  const selectedLine = side?.kind === 'line' ? lineId(side.from, side.to) : undefined
  const edges = graph.edges.map(e => (e.id === selectedLine ? { ...e, selected: true } : e))

  const close = () => setSide(undefined)
  const go = (id: string) => {
    setViewId(id)
    setPlaying(undefined)
    setSide(s => (s?.kind === 'object' ? s : undefined)) // a line belongs to one view
  }
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, flow.steps.length - 1)) })
  const jump = (p: Problem) => {
    const spot = locate(model, p)
    go(spot.view)
    if (spot.object) setSide({ kind: 'object', id: spot.object })
    else if (spot.line) setSide({ kind: 'line', from: spot.line[0], to: spot.line[1] })
    else if (spot.flow !== undefined) setPlaying({ flow: spot.flow, step: spot.step ?? 0 })
  }

  // Added again on every render, so the handler always sees the current view and step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (flow && e.key === 'ArrowRight') stepTo(stepIndex + 1)
      else if (flow && e.key === 'ArrowLeft') stepTo(stepIndex - 1)
      else if (flow && e.key === 'Escape') setPlaying(undefined)
      else if (e.key === 'Escape') setSide(undefined)
      else if (e.key === 'Backspace' && view !== ROOT) go(parentOf(model, view))
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
          <select value="" aria-label="Play a flow" onChange={e => {
            setPlaying({ flow: e.target.value, step: 0 })
            e.target.blur() // so ← and → step through the flow instead of changing this list
          }}>
            <option value="" disabled>▶ Play a flow</option>
            {flowsHere.map(([id, f]) => <option key={id} value={id}>{f.name || id}</option>)}
          </select>
        )}
        <span className="grow" />
        <Problems problems={problems} onPick={jump} />
      </header>
      <main className="canvas">
        <ReactFlow
          key={view} // a fresh canvas per view, so each one opens fitted to the screen
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: { x: '40px', top: '40px', bottom: '200px' } }} // room for the flow player
          colorMode="system"
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          onNodeClick={(_, node) => setSide({ kind: 'object', id: node.id })}
          onNodeDoubleClick={(_, node) => hasChildren(model, node.id) && go(node.id)}
          onEdgeClick={(_, e) => e.id !== 'step' && setSide({ kind: 'line', from: e.source, to: e.target })}
          onPaneClick={close}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
        {nodes.length === 0 && (
          <p className="empty">Nothing here yet. Ask Claude to map this repo into Flowy, or add YAML to the flowy/ folder.</p>
        )}
        {side?.kind === 'object' && <ObjectPanel model={model} id={side.id} problems={problems} onClose={close} />}
        {side?.kind === 'line' && <LinePanel model={model} view={view} from={side.from} to={side.to} problems={problems} onClose={close} />}
        {flow && step && (
          <section className="player" aria-live="polite">
            <p className="muted">{flow.name} · Step {stepIndex + 1} of {flow.steps.length}</p>
            <p className="player-ends">{(ends ?? [step.from, step.to]).map(id => nameOf(model, id)).join(' → ')}</p>
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
