import { useRef } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import { stopIndexOf, stopsOf } from '../../src/core/structure.ts'
import { isView, parentOf } from '../../src/core/views.ts'
import type { Compare } from './compare.ts'
import { moveBetween } from './edit.ts'
import { cameBack, remember } from './levels.ts'
import type { Levels } from './levels.ts'
import type { Side } from './side.ts'
import { closeFlow, openFlow as leaveFlow } from './trail.ts'
import type { useEditSession } from './useEditSession.ts'
import type { Play } from './usePlayer.ts'
import { useZoom } from './useZoom.ts'

/**
 * Where the reader is going: into a level and back out of it (with the zoom between, see useZoom), and into a flow, out of it to the one it was opened from, or to the one a
 * failure tells. `go` asks first when a note on a comparison isn't saved (`unlessDraft`); `goNow` does not.
 */
export function useNavigation({ model, view, canvas, canOpen, editing, setViewId, playing, setPlaying, stopIndex, setCompare, setSide, show, session, cancelOpen, unlessDraft, setNotice, closeFailures }: {
  model: Model; view: string; canvas: RefObject<HTMLElement | null>; canOpen: (id: string) => boolean; editing: boolean; setViewId: (id: string) => void
  playing: Play | undefined; setPlaying: Dispatch<SetStateAction<Play | undefined>>; stopIndex: number
  setCompare: Dispatch<SetStateAction<Compare | undefined>>; setSide: Dispatch<SetStateAction<Side | undefined>>; show: (s: Side | undefined) => void
  session: ReturnType<typeof useEditSession>; cancelOpen: () => void; unlessDraft: (leave: () => void) => boolean; setNotice: (notice: string | undefined) => void; closeFailures: () => void
}) {
  const levels = useRef<Levels>([]) // the levels the reader has left, for Esc to go back through
  const arriving = useRef<{ id: string; how: 'back' | 'jump' }>(undefined) // the level a way back or a jump up is heading for
  const zoom = useZoom({ canvas, model, go: id => go(id) }) // the zoom between views (see useZoom.ts)
  const { motion } = zoom
  const close = () => setSide(undefined)

  const go = (id: string) => {
    if (!unlessDraft(() => goNow(id))) goNow(id)
  }
  const goNow = (id: string) => {
    // Where the reader was is where Esc takes them back to. A way back has already taken its level off the list, and a jump up (Z, the breadcrumb) forgets the list.
    const arrived = arriving.current?.id === id ? arriving.current.how : undefined
    arriving.current = undefined
    if (arrived === 'jump') levels.current = []
    else if (arrived !== 'back') levels.current = remember(levels.current, view, id)
    cancelOpen()
    zoom.cancelMotion()
    setViewId(id)
    setPlaying(undefined)
    setCompare(c => (c?.kind === 'run' ? c : undefined)) // two flows are compared on their own views, so going to a level ends it; two runs are compared on the level
    session.viewChanged()
    setSide(s => (s?.kind === 'object' ? s : undefined)) // lines, Add and recording belong to one view
  }
  /** Up to `id` on purpose (Z, Backspace, the breadcrumb): Esc has nothing to go back to from there. */
  const jumpTo = (id: string) => {
    arriving.current = { id, how: 'jump' }
    zoom.zoomOut(id)
  }
  /** Esc: back to the level the reader came from, or up a level when they did not come from one. A second press while the zoom is still leaving goes on from where it is heading. */
  const back = () => {
    const here = motion?.phase === 'leave' ? motion.to : view
    const came = cameBack(levels.current, here, id => id === ROOT || canOpen(id))
    const to = came?.to ?? parentOf(model, here)
    levels.current = came?.rest ?? []
    arriving.current = { id: to, how: came ? 'back' : 'jump' }
    zoom.zoomAbout(to, moveBetween(model, here, to))
  }
  /** Open box `id`, from where it sits on screen: zoom in when it's inside this view, slide across when it sits beside it. */
  const zoomInto = (id: string) => {
    cancelOpen() // a click on the box queued its panel; the zoom replaces it
    close()
    const c = canvas.current!.getBoundingClientRect()
    const b = canvas.current!.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()
    zoom.zoomTo(id, moveBetween(model, view, id), b ? b.x + b.width / 2 - c.x : c.width / 2, b ? b.y + b.height / 2 - c.y : c.height / 2)
  }
  /** Play a flow where it plays (going to its level first), or while editing open it to edit. */
  const openFlow = (id: string) => {
    if (unlessDraft(() => openFlow(id))) return
    const f = model.flows[id]
    if (f.view !== view) go(f.view)
    setCompare(undefined)
    if (editing) show({ kind: 'flow', id, name: f.name })
    else setPlaying({ flow: id, step: 0 })
  }
  /** A step's story continues in another flow: open it (on its own view), leaving the place to come back to. */
  const openLinked = (id: string) => {
    const f = Object.hasOwn(model.flows, id) ? model.flows[id] : undefined
    if (!playing || !f || f.steps.length === 0 || !isView(model, f.view)) return // a flow whose view can't open can't play
    if (f.view !== view) go(f.view)
    setPlaying({ flow: id, step: 0, trail: leaveFlow(playing.trail ?? [], { flow: playing.flow, step: stopIndex }) })
  }
  /** Back to the flow this one was opened from, at the stop the reader left. */
  const goBack = () => {
    const closed = closeFlow(playing?.trail ?? [])
    const parent = closed && Object.hasOwn(model.flows, closed.back.flow) ? model.flows[closed.back.flow] : undefined
    if (!closed || !parent || !isView(model, parent.view)) return setPlaying(undefined) // the flow it came from is gone, or can't play any more
    if (parent.view !== view) go(parent.view)
    setPlaying({ flow: closed.back.flow, step: closed.back.step, ...(closed.trail.length > 0 ? { trail: closed.trail } : {}) })
  }
  /** Show it: play the flow that tells a failure, at the step it names (counted from 1), or open it to edit. */
  const showFlow = (id: string, step?: number) => {
    if (unlessDraft(() => showFlow(id, step))) return
    const f = Object.hasOwn(model.flows, id) ? model.flows[id] : undefined
    if (!f || f.steps.length === 0 || !isView(model, f.view)) return setNotice("That flow can't play yet.")
    closeFailures()
    if (f.view !== view) go(f.view)
    setCompare(undefined)
    if (editing) show({ kind: 'flow', id, name: f.name })
    else setPlaying({ flow: id, step: stopIndexOf(stopsOf(f), step === undefined ? 0 : Math.max(0, step - 1)) })
  }
  return { motion, go, goNow, jumpTo, back, zoomInto, openFlow, openLinked, goBack, showFlow }
}
