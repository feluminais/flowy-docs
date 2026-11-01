import { useEffect, useId, useRef, useState } from 'react'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { nameOf, parentOf } from '../../src/core/views.ts'
import { ObjectTile } from './Chrome.tsx'
import { useFocusBack } from './focusback.ts'
import { Search as SearchIcon } from './icons.tsx'
import { findObjects } from './search.ts'

/** The attribute of the top bar's Search button: a press on it is not "outside", and it takes the focus back when nothing else can. */
export const SEARCH_TOGGLE = 'data-search-toggle'

/**
 * Find a shape anywhere in the model by name or id. ↑ and ↓ move, Enter picks, Esc clears the text and then closes it, and so does a press outside it. Focus stays in the
 * field and the row it is on is its active descendant, so a screen reader reads each row as ↑ and ↓ reach it.
 */
export function Search({ model, onPick, onClose }: { model: Model; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [picked, setAt] = useState(0)
  const list = useId()
  const box = useRef<HTMLDivElement>(null)
  useFocusBack(() => document.querySelector(`[${SEARCH_TOGGLE}]`))
  // Not on blur: switching to another window blurs the field too, and the box would be gone when the reader came back.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element && !box.current?.contains(e.target) && e.target.closest(`[${SEARCH_TOGGLE}]`) === null) onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [onClose])
  const rowId = (i: number) => `${list}-${i}`
  const found = findObjects(model, query)
  const at = Math.max(0, Math.min(picked, found.length - 1)) // the list can shrink under it, after a live reload
  const where = (id: string) => {
    const parent = parentOf(model, id)
    return `${model.objects[id].type}${parent === ROOT ? '' : ` in ${nameOf(model, parent)}`}`
  }
  return (
    <div className="search" role="dialog" aria-label="Search" ref={box}>
      <label className="search-field">
      <SearchIcon size={18} />
      <input autoFocus value={query} placeholder="Find a shape by name" aria-label="Find a shape by name"
        role="combobox" aria-autocomplete="list" aria-controls={list} aria-expanded={found.length > 0}
        aria-activedescendant={found[at] ? rowId(at) : undefined}
        onChange={e => {
          setQuery(e.target.value)
          setAt(0)
        }}
        onKeyDown={e => {
          if (e.nativeEvent.isComposing) return // Enter that ends typing with an input method isn't a pick
          if (e.key === 'ArrowDown') setAt(Math.min(at + 1, found.length - 1))
          else if (e.key === 'ArrowUp') setAt(Math.max(at - 1, 0))
          else if (e.key === 'Enter' && found[at]) onPick(found[at])
          else if (e.key === 'Escape') {
            if (query === '') onClose()
            else {
              setQuery('')
              setAt(0)
            }
          } else return
          e.preventDefault()
          if (e.key === 'Escape') e.stopPropagation()
        }} />
      </label>
      <p className="visually-hidden" role="status">{query.trim() ? (found.length === 1 ? '1 shape' : `${found.length} shapes`) : ''}</p>
      {query.trim() && found.length === 0 && <p className="muted">Nothing called that.</p>}
      <ul id={list} role="listbox" aria-label="Shapes" hidden={found.length === 0}>
        {found.map((id, i) => (
          // mousedown would take the focus off the field before the click lands
          <li key={id} id={rowId(i)} role="option" aria-selected={i === at} className={i === at ? 'at' : undefined}
            onMouseDown={e => e.preventDefault()} onClick={() => onPick(id)}>
            <ObjectTile model={model} object={model.objects[id]} size={26} />
            <strong>{nameOf(model, id)}</strong> <span className="muted">{where(id)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
