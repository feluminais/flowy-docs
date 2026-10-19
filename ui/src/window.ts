/** The maths of a windowed list: only the rows near the scroll position are drawn, so thousands of rows stay cheap. No DOM in here. */

/** The first row, and one past the last, that a scroll position shows in a list of `count` rows each `rowHeight` tall, with `overscan` more each side. */
export function visibleRows(scrollTop: number, viewport: number, count: number, rowHeight: number, overscan = 6): { start: number; end: number } {
  const start = Math.min(count, Math.max(0, Math.floor(scrollTop / rowHeight) - overscan))
  const end = Math.max(start, Math.min(count, Math.ceil((scrollTop + viewport) / rowHeight) + overscan))
  return { start, end }
}

/** The scroll position that brings row `index` into view with the least movement, or undefined when it already shows. */
export function scrollToRow(index: number, scrollTop: number, viewport: number, rowHeight: number): number | undefined {
  const top = index * rowHeight
  if (top < scrollTop) return top
  if (top + rowHeight > scrollTop + viewport) return top + rowHeight - viewport
  return undefined
}
