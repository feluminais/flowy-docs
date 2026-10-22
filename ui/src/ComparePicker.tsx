import { useEffect, useMemo, useRef, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { nameOf } from '../../src/core/views.ts'
import { choicesFor, openable, playable } from './compare.ts'
import type { Choice } from './compare.ts'
import { Link, Search as SearchIcon } from './icons.tsx'

const NO_RUNS: Record<string, Run> = {} // the same object every time, so the choices are not worked out again for it

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
  onPick: (id: string) => void
  onClose: () => void
}

/**
 * The popover over the player's Compare button, or under the Performance tab's Compare and Link with: the flows (or runs) `id` is linked to first (a tag names them; one that is not
 * there is greyed out as Missing), then a field to find any other. A flow that can't play is greyed out too. Picking one calls `onPick`; a click elsewhere or Esc closes it.
 */
export function ComparePicker({ model, runs = NO_RUNS, kind = 'flow', id: flowId, label = 'Compare with', toggle = 'data-compare-toggle', onPick, onClose }: Props) {
  const { linked, others } = useMemo(() => choicesFor(model, runs, kind, flowId), [model, runs, kind, flowId])
  const can = (id: string) => (kind === 'run' ? openable(runs, id) : playable(model, id))
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  // Closing by Esc or by picking hands the focus back to the Compare button; a press elsewhere has put it somewhere else on purpose.
  const giveBack = () => document.querySelector<HTMLElement>(`[${toggle}]`)?.focus()
  const found = q === '' ? others : others.filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q))
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
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])
  const row = (c: Choice, isLinked: boolean) => {
    const off = c.missing ? 'Missing' : !can(c.id) ? "Can't play yet" : undefined
    return (
      <li key={c.id}>
        <button disabled={off !== undefined} title={c.missing ? undefined : off} onClick={() => {
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
  return (
    <div className={kind === 'run' ? 'cpick down' : 'cpick'} ref={box} role="dialog" aria-label={label}>
      {linked.length > 0 && <ul>{linked.map(c => row(c, true))}</ul>}
      <label className="cpick-find">
        <SearchIcon size={16} />
        <input autoFocus value={query} placeholder={`Find a ${kind}`} aria-label={`Find a ${kind}`} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.key !== 'Enter') return
            const first = found.find(c => can(c.id))
            if (first) onPick(first.id)
            e.preventDefault()
          }} />
      </label>
      <ul className="cpick-others">{found.map(c => row(c, false))}</ul>
      {q !== '' && found.length === 0 && <p className="muted">Nothing called that</p>}
    </div>
  )
}
