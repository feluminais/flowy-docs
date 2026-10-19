import { useEffect, useLayoutEffect, useRef } from 'react'
import { useReactFlow, useStore, useStoreApi } from '@xyflow/react'
import { fitOptions, panIntoView, sizeOf } from './graph.ts'

/**
 * Moves the view, inside the canvas. It fits the whole diagram once all `count` boxes are measured,
 * and again when `fitKey` changes (a flow starting or stopping, Tidy) or the canvas is resized. When `reveal`
 * changes it pans just far enough that this box isn't hidden under the details panel, `panel` wide (it opens for the box), or under the
 * navigator, `nav` wide (0 while it is closed).
 */
export function Camera({ fitKey, count, player, reveal, panel, nav }: { fitKey: string; count: number; player: boolean; reveal?: string; panel: number; nav: number }) {
  const { fitView, getInternalNode, getViewport, setViewport } = useReactFlow()
  const store = useStoreApi()
  // Not useNodesInitialized: it stays false when the nodes are controlled and nobody stores their measurements.
  const measured = useStore(s => s.nodeLookup.size === count && [...s.nodeLookup.values()].every(n => n.measured.width !== undefined))
  const zoomable = useStore(s => s.panZoom !== null) // the canvas can't move before this
  const size = useStore(s => `${s.width}x${s.height}`)
  const ready = measured && zoomable
  const fitted = useRef('')

  const show = (id: string | undefined, animate: boolean) => {
    const box = id ? getInternalNode(id) : undefined
    if (!box) return
    const { width, height } = store.getState()
    const rect = { ...box.internals.positionAbsolute, ...sizeOf(box) }
    const to = panIntoView(rect, getViewport(), { width, height }, panel, 24, Math.min(nav, width))
    if (to) void setViewport(to, { duration: animate ? 200 : 0 })
  }

  // Before the browser paints, so a view never shows unfitted for a frame. The side panel does not count here:
  // opening it must not undo your own zooming and panning, and `show` keeps the selected box out from under it.
  useLayoutEffect(() => {
    const key = `${fitKey} ${size}`
    if (!ready || fitted.current === key) return
    fitted.current = key
    void fitView({ ...fitOptions(0, player), duration: 0 }).then(() => show(reveal, false))
  }, [ready, fitKey, size])

  useEffect(() => show(ready ? reveal : undefined, true), [reveal])

  return null
}
