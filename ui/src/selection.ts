/** Several shapes picked at once in edit mode, so they can be moved or deleted together. These keep the ids of the boxes in the view being edited. */

/** Whether a click or a press carries a key that adds to a selection instead of replacing it (Ctrl, Shift, or Cmd on a Mac). */
export const addsToSelection = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean => e.ctrlKey || e.metaKey || e.shiftKey

/** The selection after `id` is clicked with that key held: added when it wasn't in, taken out when it was. */
export const toggled = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id])

/**
 * The selection while a box is drawn round shapes: React Flow reports each box it takes in or lets go of as a change. Only ids in
 * `boxes` count, so the frame round the view or a line never joins the selection.
 */
export function banded(ids: readonly string[], changes: readonly { type: string; id?: string; selected?: boolean }[], boxes: ReadonlySet<string>): string[] {
  const next = new Set(ids)
  for (const c of changes) {
    if (c.type !== 'select' || c.id === undefined || !boxes.has(c.id)) continue
    if (c.selected) next.add(c.id)
    else next.delete(c.id)
  }
  return [...next]
}

/**
 * Whether pressing on box `id` keeps several shapes selected: it does when the box is one of them (so a drag moves them all) or a key
 * that adds is held. A press on any other box starts over with that box alone, or else dragging it would carry the others along.
 */
export const keepsSelection = (ids: readonly string[], id: string, adds: boolean): boolean => ids.length > 1 && (adds || ids.includes(id))
