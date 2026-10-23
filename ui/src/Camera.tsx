import { useEffect, useLayoutEffect, useRef } from 'react'
import { useReactFlow, useStore, useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import { fitOptions, panIntoView, sizeOf } from './graph.ts'

/**
 * Moves the view, inside the canvas. It fits the whole diagram once all `count` boxes are measured,
 * and again when `fitKey` changes (a flow starting or stopping, Tidy) or the canvas is resized. When `reveal`
 * changes it pans just far enough that this box isn't hidden under the details panel, `panel` wide (it opens for the box), or under the
 * navigator, `nav` wide (0 while it is closed). With `refitOnResize` false (a pane of a comparison, which a panel opening beside it narrows) a resize leaves the view where the
 * reader put it: it fits once the boxes are measured and again only when `fitKey` changes.
 */
export function Camera({ fitKey, count, player, reveal, panel, nav, refitOnResize = true }: { fitKey: string; count: number; player: boolean; reveal?: string; panel: number; nav: number; refitOnResize?: boolean }) {
  const { fitView, getInternalNode, getViewport, setViewport } = useReactFlow()
  const store = useStoreApi()
  // Not useNodesInitialized: it stays false when the nodes are controlled and nobody stores their measurements.
  const measured = useStore(s => {
    if (s.nodeLookup.size !== count) return false
    for (const n of s.nodeLookup.values()) if (n.measured.width === undefined) return false // no list made: this is asked on every pan and zoom
    return true
  })
  const zoomable = useStore(s => s.panZoom !== null) // the canvas can't move before this
  const size = useStore(s => `${s.width}x${s.height}`)
  const ready = measured && zoomable
  const fitted = useRef('')
  const updateNodeInternals = useUpdateNodeInternals()

  // React Flow measures a box when it first draws it, and now and then (about one load in fifty, in a pane of a comparison that mounts beside another) a box is drawn but its
  // measurement never arrives: it stays hidden and the view never fits. Asked again, React Flow measures what is on screen, so while the boxes are not all measured it is asked
  // every quarter of a second, a few times.
  useEffect(() => {
    if (measured) return
    let tries = 0
    const timer = setInterval(() => {
      const ids = [...store.getState().nodeLookup.keys()]
      if (ids.length > 0) updateNodeInternals(ids)
      if (++tries >= 12) clearInterval(timer)
    }, 250)
    return () => clearInterval(timer)
  }, [measured])

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
    const key = refitOnResize ? `${fitKey} ${size}` : fitKey
    if (!ready || fitted.current === key) return
    fitted.current = key
    void fitView({ ...fitOptions(0, player), duration: 0 }).then(() => show(reveal, false))
  }, [ready, fitKey, refitOnResize ? size : ''])

  useEffect(() => show(ready ? reveal : undefined, true), [reveal])

  return null
}
