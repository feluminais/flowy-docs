import { LINE_STYLES } from '../../src/core/model.ts'
import type { LineStyle } from '../../src/core/model.ts'

/** What the Lines picker calls each style. */
export const LINE_NAMES: Record<LineStyle, string> = { straight: 'straight', curved: 'curved', angled: 'right-angled' }

const KEY = 'flowy.lines'

/** The line style this reader picked for their own screen, if any. Storage may be blocked (private windows, some exported pages). */
export function ownLines(): LineStyle | undefined {
  try {
    return LINE_STYLES.find(s => s === localStorage.getItem(KEY))
  } catch {
    return undefined
  }
}

/** Remember this reader's own line style, or forget it. When storage is blocked it lasts until the page closes. */
export function keepOwnLines(style: LineStyle | undefined): void {
  try {
    if (style === undefined) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, style)
  } catch {
    // nothing to do: the choice still holds in this page
  }
}
