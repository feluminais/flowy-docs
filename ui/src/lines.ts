import { LINE_STYLES } from '../../src/core/model.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { readPref, writePref } from './store.ts'

/** What the Lines picker calls each style. */
export const LINE_NAMES: Record<LineStyle, string> = { straight: 'straight', curved: 'curved', angled: 'right-angled' }

const KEY = 'flowy.lines'

/** The line style this reader picked for their own screen, if any. Storage may be blocked (private windows, some exported pages). */
export function ownLines(): LineStyle | undefined {
  return LINE_STYLES.find(s => s === readPref(KEY))
}

/** Remember this reader's own line style, or forget it. When storage is blocked it lasts until the page closes. */
export function keepOwnLines(style: LineStyle | undefined): void {
  writePref(KEY, style)
}
