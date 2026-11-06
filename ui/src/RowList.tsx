import { useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { stepRow } from './dropdown.ts'

export type Row = {
  id: string
  name: string
  /** What sits at the end of the row, after the name. */
  end?: ReactNode
}

/**
 * A short set of choices as rows in a panel, in place of a dropdown: the runs of the Performance tab, the analyses of the Failures tab. Four rows show in full; past that the list
 * scrolls inside itself, and half a fifth row shows there is more. It is one Tab stop: the arrows up and down, Home and End go through the rows, and the page keeps its other keys.
 */
export function RowList({ label, rows, value, onPick }: { label: string; rows: Row[]; value: string | undefined; onPick: (id: string) => void }) {
  const list = useRef<HTMLUListElement>(null)
  // The choice also changes from outside the list (a link, a comparison that closes): its row stays in view, and only the list moves, never the panel. The focus follows the keys.
  useLayoutEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!box || !row) return
    const shown = box.getBoundingClientRect()
    const at = row.getBoundingClientRect()
    if (at.top < shown.top) box.scrollTop -= shown.top - at.top
    else if (at.bottom > shown.bottom) box.scrollTop += at.bottom - shown.bottom
    if (box.contains(document.activeElement)) row.focus({ preventScroll: true })
  }, [value])
  const pick = (id: string) => {
    if (id !== value) onPick(id)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const at = rows.findIndex(r => r.id === value)
    const to = e.key === 'ArrowDown' || e.key === 'ArrowUp' ? stepRow(at, e.key === 'ArrowDown' ? 1 : -1, rows.length) : e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : undefined
    if (to === undefined) return
    e.preventDefault()
    e.stopPropagation() // Home and End are the page's anywhere else
    pick(rows[to].id)
  }
  return (
    <ul ref={list} className="row-list" aria-label={label} onKeyDown={onKeyDown}>
      {rows.map(r => (
        <li key={r.id}>
          <button className="flow-row" aria-current={r.id === value} tabIndex={r.id === value ? 0 : -1} title={r.name} onClick={() => pick(r.id)}>
            <span className="name">{r.name}</span>
            {r.end}
          </button>
        </li>
      ))}
    </ul>
  )
}
