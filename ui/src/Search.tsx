import { useState } from 'react'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { parentOf } from '../../src/core/views.ts'
import { nameOf } from './edit.ts'
import { findObjects } from './search.ts'

/** Find a box anywhere in the model by name or id. ↑ and ↓ move, Enter picks, Esc or leaving the field closes it. */
export function Search({ model, onPick, onClose }: { model: Model; onPick: (id: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [at, setAt] = useState(0)
  const found = findObjects(model, query)
  const where = (id: string) => {
    const parent = parentOf(model, id)
    return `${model.objects[id].type}${parent === ROOT ? '' : ` in ${nameOf(model, parent)}`}`
  }
  return (
    <div className="search" role="dialog" aria-label="Search">
      <input autoFocus value={query} placeholder="Find a box by name" aria-label="Find a box by name" onBlur={onClose}
        onChange={e => {
          setQuery(e.target.value)
          setAt(0)
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') setAt(Math.min(at + 1, found.length - 1))
          else if (e.key === 'ArrowUp') setAt(Math.max(at - 1, 0))
          else if (e.key === 'Enter' && found[at]) onPick(found[at])
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }} />
      {query.trim() && (found.length === 0 ? <p className="muted">Nothing called that.</p> : (
        <ul>
          {found.map((id, i) => (
            <li key={id}>
              {/* mousedown would blur the field and close the box before the click lands */}
              <button className={i === at ? 'at' : undefined} onMouseDown={e => e.preventDefault()} onClick={() => onPick(id)}>
                {nameOf(model, id)} <span className="muted">{where(id)}</span>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </div>
  )
}
