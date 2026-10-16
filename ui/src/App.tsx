import { useEffect, useState } from 'react'
import { Controls, ReactFlow } from '@xyflow/react'
import { getObject, ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { chain, hasChildren, parentOf } from '../../src/core/views.ts'
import { Box } from './Box.tsx'
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

  // After a live reload the view's object may be gone or empty: show the nearest view that still exists.
  const view = chain(model, viewId).find(v => v === ROOT || hasChildren(model, v)) ?? ROOT
  const { nodes, edges } = toGraph(model, view)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (e.key === 'Backspace' && view !== ROOT) setViewId(parentOf(model, view))
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
            <button key={id} disabled={id === view} onClick={() => setViewId(id)}>{nameOf(model, id)}</button>
          ))}
        </nav>
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
          onNodeDoubleClick={(_, node) => hasChildren(model, node.id) && setViewId(node.id)}
        >
          <Controls showInteractive={false} />
        </ReactFlow>
        {nodes.length === 0 && (
          <p className="empty">Nothing here yet. Ask Claude to map this repo into Flowy, or add YAML to the flowy/ folder.</p>
        )}
      </main>
    </>
  )
}
