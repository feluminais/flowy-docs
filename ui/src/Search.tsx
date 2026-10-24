import { useId, useState } from 'react'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { nameOf, parentOf } from '../../src/core/views.ts'
import { ObjectTile } from './Chrome.tsx'
import { Search as SearchIcon } from './icons.tsx'
import { findObjects } from './search.ts'

/**
 * Find a shape anywhere in the model by name or id. ↑ and ↓ move, Enter picks, Esc or leaving the field closes it. Focus stays in the
 * field and the row it is on is its active descendant, so a screen reader reads each row as ↑ and ↓ reach it.
 */
export function Search({ model, onPick, onClose }: { model: Model; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [picked, setAt] = useState(0)
  const list = useId()
  const rowId = (i: number) => `${list}-${i}`
  const found = findObjects(model, query)
  const at = Math.max(0, Math.min(picked, found.length - 1)) // the list can shrink under it, after a live reload
  const where = (id: string) => {
    const parent = parentOf(model, id)
    return `${model.objects[id].type}${parent === ROOT ? '' : ` in ${nameOf(model, parent)}`}`
  }
  return (
    <div className="search" role="dialog" aria-label="Search">
      <label className="search-field">
      <SearchIcon size={18} />
      <input autoFocus value={query} placeholder="Find a shape by name" aria-label="Find a shape by name" onBlur={onClose}
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
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }} />
      </label>
      <p className="visually-hidden" role="status">{query.trim() ? (found.length === 1 ? '1 shape' : `${found.length} shapes`) : ''}</p>
      {query.trim() && found.length === 0 && <p className="muted">Nothing called that.</p>}
      <ul id={list} role="listbox" aria-label="Shapes" hidden={found.length === 0}>
        {found.map((id, i) => (
          // mousedown would blur the field and close the box before the click lands
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
