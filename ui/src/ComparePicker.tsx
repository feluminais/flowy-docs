import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { nameOf } from '../../src/core/views.ts'
import { choicesFor, openable, playable } from './compare.ts'
import type { Choice } from './compare.ts'
import { Link, Search as SearchIcon } from './icons.tsx'

const NO_RUNS: Record<string, Run> = {} // the same object every time, so the choices are not worked out again for it

/** Where a popover that hangs off a row of a list sits, in the window's pixels: the list scrolls, so the popover can't live inside it. Below the row (`top`) or above it (`bottom`). */
export type PickAt = { left: number; width: number; top?: number; bottom?: number }

type Props = {
  model: Model
  /** The runs, for a picker of runs. */
  runs?: Record<string, Run>
  /** What it picks from: other flows (the player's Compare) or other runs (the Performance tab's Compare and Link with). */
  kind?: 'flow' | 'run'
  /** The flow or run the others are picked for. */
  id: string
  /** What the popover is called, for a screen reader. */
  label?: 'Compare with' | 'Link with'
  /** The attribute of the button that opened it, which takes the focus back and which a press on it does not count as outside. */
  toggle?: string
  /** Set for the Compare button of a row in the Flows tab or the Explorer: the popover is then placed in the window instead of on its parent, and closes when a list scrolls. */
  at?: PickAt
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * The popover over the player's Compare button, or under the Performance tab's Compare and Link with: the flows (or runs) `id` is linked to first (a tag names them; one that is not
 * there is greyed out as Missing), then a field to find any other. A flow that can't play is greyed out too. Picking one calls `onPick`; a click elsewhere or Esc closes it.
 */
export function ComparePicker({ model, runs = NO_RUNS, kind = 'flow', id: flowId, label = 'Compare with', toggle = 'data-compare-toggle', at, onPick, onClose }: Props) {
  const { linked, others } = useMemo(() => choicesFor(model, runs, kind, flowId), [model, runs, kind, flowId])
  const can = (id: string) => (kind === 'run' ? openable(runs, id) : playable(model, id))
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  // Closing by Esc or by picking hands the focus back to the Compare button; a press elsewhere has put it somewhere else on purpose.
  const giveBack = () => document.querySelector<HTMLElement>(`[${toggle}]`)?.focus()
  const found = q === '' ? others : others.filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q))
  // The arrow keys move over the rows that can be picked, linked ones first; Enter picks the one they are on. Typing puts them back on the first.
  const rows = [...linked, ...found]
  const pickable = (c: Choice) => !c.missing && can(c.id)
  const [cursor, setCursor] = useState(0)
  const onRow = cursor < rows.length && pickable(rows[cursor]) ? cursor : rows.findIndex(pickable)
  const move = (by: 1 | -1) => {
    for (let next = onRow + by; next >= 0 && next < rows.length; next += by) {
      if (pickable(rows[next])) return setCursor(next)
    }
  }
  // Esc is this popover's while it is open, ahead of the keys of the page; a press outside it closes it (the Compare button toggles it itself).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && !box.current?.contains(e.target) && e.target.closest(`[${toggle}]`) === null) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      giveBack()
      onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    // A list that scrolls moves the row the popover hangs off, and the popover would stay behind.
    const onScroll = (e: Event) => {
      if (e.target instanceof Element && e.target.matches('.navscroll, .tree')) onClose()
    }
    window.addEventListener('keydown', onKey, true)
    if (at) window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])
  const row = (c: Choice, isLinked: boolean) => {
    const off = c.missing ? 'Missing' : !can(c.id) ? "Can't play yet" : undefined
    return (
      <li key={c.id}>
        <button className={rows[onRow]?.id === c.id ? 'at' : undefined} disabled={off !== undefined} title={c.missing ? undefined : off} onClick={() => {
          giveBack()
          onPick(c.id)
        }}>
          <strong>{c.name}</strong>
          <span className="cpick-end muted">
            {!c.missing && kind === 'flow' && Object.hasOwn(model.flows, c.id) && nameOf(model, model.flows[c.id].view)}
            {c.missing && 'Missing'}
            {isLinked && <span className="linked"><Link size={13} />Linked</span>}
          </span>
        </button>
      </li>
    )
  }
  const popover = (
    <div className={at ? 'cpick pop' : kind === 'run' ? 'cpick down' : 'cpick'} ref={box} role="dialog" aria-label={label}
      style={at && { left: at.left, width: at.width, top: at.top ?? 'auto', bottom: at.bottom ?? 'auto' }}>
      {linked.length > 0 && <ul>{linked.map(c => row(c, true))}</ul>}
      <label className="cpick-find">
        <SearchIcon size={16} />
        <input autoFocus value={query} placeholder={`Find a ${kind}`} aria-label={`Find a ${kind}`} onChange={e => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing) return
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              move(e.key === 'ArrowDown' ? 1 : -1)
              e.preventDefault()
            } else if (e.key === 'Enter') {
              if (rows[onRow]) onPick(rows[onRow].id)
              e.preventDefault()
            }
          }} />
      </label>
      <ul className="cpick-others">{found.map(c => row(c, false))}</ul>
      {q !== '' && found.length === 0 && <p className="muted">Nothing called that</p>}
    </div>
  )
  // On a row of a scrolling list the popover goes to the body: focusing its field would otherwise scroll the list's panel to bring it into view.
  return at ? createPortal(popover, document.body) : popover
}
