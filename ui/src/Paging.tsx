import { useState } from 'react'
import type { ReactNode } from 'react'
import { focusIfLost } from './focusback.ts'

/** How many rows a page has: the same as the desktop app's (Paging.cs). */
export const PAGE = 100

/**
 * How many rows of a long list to draw: a page, and a page more for every press of Show more. Every row is a node of the page, and a list of thousands (the flows of a big model,
 * the shapes no analysis covers, the dependents of a system about to go) made a panel that took seconds to build and again for every change. `reset` starts again at the first page
 * (a new filter or search); `floor` is a row that has to be drawn whatever the page says (the one that is playing or has the focus).
 */
export function usePaging(total: number, reset = '', floor = 0) {
  const [page, setPage] = useState({ reset, pages: 1 })
  const pages = page.reset === reset ? page.pages : 1
  const shown = Math.min(total, Math.max(pages * PAGE, floor))
  const left = total - shown
  return { shown, left, more: left > 0 ? () => setPage({ reset, pages: Math.floor(shown / PAGE) + 1 }) : undefined }
}

const FOCUSABLE = 'button, a[href], input, [tabindex]'

/** The button under a page of rows that draws the next: "Show 100 more", named for a screen reader with what is left. Gone when nothing is. */
export function ShowMore({ left, onMore }: { left: number; onMore?: () => void }) {
  if (onMore === undefined) return null
  const n = Math.min(PAGE, left)
  return (
    <button type="button" className="link showmore" aria-label={`Show ${n} more, ${left} left`}
      onClick={e => {
        const last = e.currentTarget.previousElementSibling
        onMore()
        // The last page takes the button away with it, and the focus goes to the first new row.
        if (left <= PAGE) setTimeout(() => {
          const first = last?.nextElementSibling
          focusIfLost(first?.matches(FOCUSABLE) ? first : first?.querySelector(FOCUSABLE))
        })
      }}>
      Show {n} more
    </button>
  )
}

/** The first page of `items`, drawn by `children`, and Show more under it. */
export function Paged<T>({ items, reset, floor, children }: { items: readonly T[]; reset?: string; floor?: number; children: (shown: readonly T[]) => ReactNode }) {
  const { shown, left, more } = usePaging(items.length, reset, floor)
  return (
    <>
      {children(shown === items.length ? items : items.slice(0, shown))}
      <ShowMore left={left} onMore={more} />
    </>
  )
}
