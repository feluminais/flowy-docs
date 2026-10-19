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
export type EscapeStep = 'shortcuts' | 'flow' | 'step' | 'panel' | 'up'

/**
 * Escape peels one layer per press: the shortcut list, a flow playing, a step half recorded, the side
 * panel, and then the box you're inside, back up to the level above. At the top, with nothing open, nothing.
 */
export function escapeStep(open: { shortcuts: boolean; flow: boolean; halfStep: boolean; panel: boolean; inside: boolean }): EscapeStep | undefined {
  if (open.shortcuts) return 'shortcuts'
  if (open.flow) return 'flow'
  if (open.halfStep) return 'step'
  if (open.panel) return 'panel'
  return open.inside ? 'up' : undefined
}
