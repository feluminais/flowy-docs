import { useEffect, useState } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import { getObject, ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { chain, hasChildren, parentOf, placeEnds } from '../../src/core/views.ts'
import { Box, Description } from './Box.tsx'
import { toGraph } from './graph.ts'
import { useModel } from './useModel.ts'

const nodeTypes = { box: Box }

const nameOf = (model: Model, id: string) => (id === ROOT ? 'Overview' : getObject(model, id)?.name || id)

export function App() {
  const { model, banner } = useModel()
  return (
    <div className="app">
      {banner && <div className="banner" role="alert">{banner}</div>}
      {model && <Reader model={model} />}
    </div>
  )
}

function Reader({ model }: { model: Model }) {
  const [viewId, setViewId] = useState(ROOT)
  const [selected, setSelected] = useState<string>()
  const [playing, setPlaying] = useState<{ flow: string; step: number }>()

  // After a live reload the view's object may be gone or empty: show the nearest view that still exists.
  const view = chain(model, viewId).find(v => v === ROOT || hasChildren(model, v)) ?? ROOT
  const flowsHere = Object.entries(model.flows).filter(([, f]) => f.view === view && f.steps.length > 0)
  const flow = flowsHere.find(([id]) => id === playing?.flow)?.[1]
  const stepIndex = flow && playing ? Math.min(playing.step, flow.steps.length - 1) : 0
  const step = flow?.steps[stepIndex]
  const allEnds = flow?.steps.map(s => placeEnds(model, view, s.from, s.to))
  const ends = allEnds?.[stepIndex]
  const { nodes, edges } = toGraph(model, view, allEnds && { ends: allEnds, step: stepIndex })
  const object = selected === undefined ? undefined : getObject(model, selected)

  const go = (id: string) => {
    setViewId(id)
    setPlaying(undefined)
  }
  const stepTo = (i: number) => playing && flow && setPlaying({ ...playing, step: Math.max(0, Math.min(i, flow.steps.length - 1)) })

  // Added again on every render, so the handler always sees the current view and step.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (flow && e.key === 'ArrowRight') stepTo(stepIndex + 1)
      else if (flow && e.key === 'ArrowLeft') stepTo(stepIndex - 1)
      else if (flow && e.key === 'Escape') setPlaying(undefined)
      else if (e.key === 'Escape') setSelected(undefined)
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
      </header>
      <main className="canvas">
        <ReactFlow
          key={view} // a fresh canvas per view, so each one opens fitted to the screen
          nodes={nodes.map(n => (n.id === selected ? { ...n, selected: true } : n))} // nodes are controlled, so selection shows only through them
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: { x: '40px', top: '40px', bottom: '200px' } }} // room for the flow player
          colorMode="system"
          nodesDraggable={false}
          nodesConnectable={false}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          onNodeClick={(_, node) => setSelected(node.id)}
          onNodeDoubleClick={(_, node) => hasChildren(model, node.id) && go(node.id)}
          onPaneClick={() => setSelected(undefined)}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
        {nodes.length === 0 && (
          <p className="empty">Nothing here yet. Ask Claude to map this repo into Flowy, or add YAML to the flowy/ folder.</p>
        )}
        {object && selected && (
          <aside className="panel">
            <button className="close" aria-label="Close" onClick={() => setSelected(undefined)}>×</button>
            <h2>{object.name || selected}</h2>
            <p className="muted">{object.type}{object.tech ? ` · ${object.tech}` : ''}</p>
            {object.description ? <Description text={object.description} /> : <p className="muted">No description yet.</p>}
          </aside>
        )}
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
