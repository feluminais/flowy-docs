import { ControlButton, Controls, useReactFlow, useStore } from '@xyflow/react'
import type { FitViewOptions } from '@xyflow/react'
import { Fit, Minus, Plus } from './icons.tsx'

/** The zoom buttons at the foot of a canvas, named as the desktop app names them. `fit` is how the fit button frames the view; Camera does the automatic fits. */
export function ZoomControls({ fit }: { fit: FitViewOptions }) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const atMax = useStore(s => s.transform[2] >= s.maxZoom)
  const atMin = useStore(s => s.transform[2] <= s.minZoom)
  return (
    <Controls showZoom={false} showFitView={false} showInteractive={false}>
      <ControlButton title="Zoom in" aria-label="Zoom in" disabled={atMax} onClick={() => void zoomIn()}><Plus size={16} /></ControlButton>
      <ControlButton title="Zoom out" aria-label="Zoom out" disabled={atMin} onClick={() => void zoomOut()}><Minus size={16} /></ControlButton>
      <ControlButton title="Fit the view" aria-label="Fit the view" onClick={() => void fitView(fit)}><Fit size={16} /></ControlButton>
    </Controls>
  )
}
