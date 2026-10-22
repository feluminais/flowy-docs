import { useEffect, useMemo, useRef, useState } from 'react'
import type { Model } from '../../src/core/model.ts'
import { nameOf } from '../../src/core/views.ts'
import { choicesFor, playable } from './compare.ts'
import type { Choice } from './compare.ts'
import { Link, Search as SearchIcon } from './icons.tsx'

/**
 * The popover over the player's Compare button: the flows `flowId` is linked to first (a tag names them; one that is not there is greyed out as Missing), then a field to find
 * any other flow. A flow that can't play is greyed out too. Picking one calls `onPick`; a click elsewhere or Esc closes it.
 */
export function ComparePicker({ model, flowId, onPick, onClose }: { model: Model; flowId: string; onPick: (id: string) => void; onClose: () => void }) {
  const { linked, others } = useMemo(() => choicesFor(model, {}, 'flow', flowId), [model, flowId])
  const [query, setQuery] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const q = query.trim().toLowerCase()
  const found = q === '' ? others : others.filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q))
  // Esc is this popover's while it is open, ahead of the keys of the page; a press outside it closes it (the Compare button toggles it itself).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && !box.current?.contains(e.target) && e.target.closest('[data-compare-toggle]') === null) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
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
    const off = c.missing ? 'Missing' : !playable(model, c.id) ? "Can't play yet" : undefined
    return (
      <li key={c.id}>
        <button disabled={off !== undefined} title={off} onClick={() => onPick(c.id)}>
          {isLinked && <span className="linked" role="img" aria-label="Linked" title="Linked"><Link size={14} /></span>}
          <strong>{c.name}</strong>
          {!c.missing && Object.hasOwn(model.flows, c.id) && <span className="muted">{nameOf(model, model.flows[c.id].view)}</span>}
        </button>
      </li>
    )
  }
  return (
    <div className="cpick" ref={box} role="dialog" aria-label="Compare with">
      {linked.length > 0 && <ul>{linked.map(c => row(c, true))}</ul>}
      <label className="cpick-find">
        <SearchIcon size={16} />
        <input autoFocus value={query} placeholder="Find a flow" aria-label="Find a flow" onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.nativeEvent.isComposing || e.key !== 'Enter') return
            const first = found.find(c => playable(model, c.id))
            if (first) onPick(first.id)
            e.preventDefault()
          }} />
      </label>
      <ul className="cpick-others">{found.map(c => row(c, false))}</ul>
      {q !== '' && found.length === 0 && <p className="muted">Nothing called that</p>}
    </div>
  )
}
