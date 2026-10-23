/**
 * The letter a shortcut means: the one typed when it's Latin, otherwise the key's place on a US
 * keyboard, so E, Ctrl+K and Ctrl+Z work on a Ukrainian or Greek layout too.
 */
export function letter(e: { key: string; code: string }): string {
  if (/^[a-z]$/i.test(e.key)) return e.key.toLowerCase()
  return e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : e.key
}

/** Enter belongs to a focused button, link or disclosure summary, not to the canvas behind it. */
export const takesEnter = (target: { closest?: (selector: string) => unknown } | null): boolean => Boolean(target?.closest?.('button, a, summary'))

/**
 * Whether Esc or Backspace should take back the box that was just dragged, rather than close or go up. Someone who has moved a box and got
 * it wrong reaches for those keys, so right after the drag they undo it. Once anything else is done (a click, another edit, a move to another
 * level) they close and go up again, and Z is always there to zoom out.
 */
export const undoesMove = (e: { key: string }, s: { editing: boolean; justMoved: boolean; shortcuts: boolean; plain: boolean }): boolean =>
  s.editing && s.justMoved && !s.shortcuts && (e.key === 'Escape' || (e.key === 'Backspace' && s.plain))

/** What one press of Escape closes, innermost first. */
export type EscapeStep = 'shortcuts' | 'navigator' | 'flow' | 'step' | 'panel' | 'compare' | 'back'

/**
 * Escape peels one layer per press: the shortcut list, the navigator (Explorer, Flows, Performance, Failures or YAML) when it is the last thing used, a flow playing,
 * a step half recorded, Details or a Performance or Failures panel the last click was not in, a pane of a comparison zoomed into a shape, a comparison, and then the level you are in, back to the one you came from (the level above, when there is none). At the top, with
 * nothing open, nothing. `navigator` is true only when the navigator is open and the last click or key was in it: Escape in the diagram
 * leaves it alone. A comparison takes the place of the flow playing, so the two are never open together.
 */
export function escapeStep(open: { shortcuts: boolean; navigator: boolean; flow: boolean; halfStep: boolean; panel: boolean; compare: boolean; inside: boolean; paneInside?: boolean }): EscapeStep | undefined {
  if (open.shortcuts) return 'shortcuts'
  if (open.navigator) return 'navigator'
  if (open.flow) return 'flow'
  if (open.halfStep) return 'step'
  if (open.panel) return 'panel'
  if (open.compare) return open.paneInside ? 'back' : 'compare' // a pane zoomed into a shape goes back up before the comparison closes
  return open.inside ? 'back' : undefined
}
