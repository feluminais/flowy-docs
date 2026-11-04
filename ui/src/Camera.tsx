import { useEffect, useLayoutEffect, useRef } from 'react'
import { useReactFlow, useStore, useStoreApi, useUpdateNodeInternals } from '@xyflow/react'
import type { Viewport } from '@xyflow/react'
import { fitOptions, panIntoView, sizeOf } from './graph.ts'

/**
 * Moves the view, inside the canvas. It fits the whole diagram into the room beside the open panels (the navigator `nav` wide, 0 while it is closed, and the
 * details panel `fitPanel` wide, 0 while it is closed) once all `count` boxes are measured, and again when `fitKey` changes (a flow starting or stopping, Tidy) or the canvas is
 * resized. `player` says there is a flow player's card to leave room for, as a number its height in pixels (see roomForCard). When the navigator or the details panel opens, closes or is dragged to another width, it fits again to the room that is left, but only while the view is still where the
 * last fit put it: a view the reader has zoomed or panned is theirs, and `reveal` keeps a picked box clear of the details panel there. When `reveal`
 * changes it pans just far enough that this box isn't hidden under the details panel, `panel` wide (it opens for the box), or under the
 * navigator, `nav` wide (0 while it is closed). With `refitOnResize` false (a pane of a comparison, which a panel opening beside it narrows) a resize leaves the view where the
 * reader put it: it fits once the boxes are measured and again only when `fitKey` changes.
 * When `labels` changes (the line or pair picked) it pans just far enough that the labels of the lines of a pair side by side, which run out to each side of the pair past its shapes, are clear of the
 * details panel too: a fit counts the shapes only.
 */
export function Camera({ fitKey, count, player, reveal, labels, panel, nav, fitPanel = 0, refitOnResize = true }: { fitKey: string; count: number; player: boolean | number; reveal?: string; labels?: string; panel: number; nav: number; fitPanel?: number; refitOnResize?: boolean }) {
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
  const roomAtFit = useRef(`${nav} ${fitPanel} ${player}`) // the panels' widths, and the card's height, the view was last fitted beside
  const viewAtFit = useRef<Viewport>(undefined) // where the last fit left the view, to tell whether the reader has moved it since
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

  // The labels of a pair side by side (their pills are on the page while the pair is spread) come into the room beside the panels, as a box does in `show`.
  const showLabels = () => {
    const dom = store.getState().domNode
    const pills = dom ? [...dom.querySelectorAll('.lane-pill:not(.revealed)')].map(p => p.getBoundingClientRect()) : []
    if (!dom || pills.length === 0) return
    const [canvas, view, { width, height }] = [dom.getBoundingClientRect(), getViewport(), store.getState()]
    const [left, top] = [Math.min(...pills.map(p => p.left)), Math.min(...pills.map(p => p.top))]
    const rect = { x: (left - canvas.left - view.x) / view.zoom, y: (top - canvas.top - view.y) / view.zoom, width: (Math.max(...pills.map(p => p.right)) - left) / view.zoom, height: (Math.max(...pills.map(p => p.bottom)) - top) / view.zoom }
    const to = panIntoView(rect, view, { width, height }, panel, 24, Math.min(nav, width))
    if (to) void setViewport(to, { duration: 200 })
  }

  const room = `${nav} ${fitPanel} ${player}` // `player` is the pixels the player's card takes, when it is known: a card that grows or shrinks fits again
  const fitting = useRef(false) // a fit is under way, so the view is still the one it makes
  const fit = (duration = 0) => {
    roomAtFit.current = room
    fitting.current = true
    return fitView({ ...fitOptions(fitPanel, player, nav), duration }).then(() => {
      show(reveal, false)
      viewAtFit.current = getViewport()
      fitting.current = false
    })
  }
  const stillFitted = () => {
    const [was, now] = [viewAtFit.current, getViewport()]
    return fitting.current || (was !== undefined && Math.abs(was.x - now.x) < 1 && Math.abs(was.y - now.y) < 1 && Math.abs(was.zoom - now.zoom) < 0.001)
  }

  // Before the browser paints, so a view never shows unfitted for a frame. A panel moving fits again only a view that is still as it was fitted:
  // opening it must not undo your own zooming and panning, and `show` keeps the selected box out from under it.
  useLayoutEffect(() => {
    const key = refitOnResize ? `${fitKey} ${size}` : fitKey
    if (!ready) return
    if (fitted.current !== key) {
      fitted.current = key
      void fit()
    } else if (roomAtFit.current !== room && stillFitted()) {
      void fit() // a panel moved, and nobody has moved the view since it was fitted
    } else {
      roomAtFit.current = room
    }
  }, [ready, fitKey, refitOnResize ? size : '', room])

  useEffect(() => show(ready ? reveal : undefined, true), [reveal])
  // After the panel has opened and the pair has spread, so the pills are where they will stay.
  useEffect(() => {
    if (!ready || labels === undefined) return
    const timer = setTimeout(showLabels, 80)
    return () => clearTimeout(timer)
  }, [labels, ready])

  return null
}
