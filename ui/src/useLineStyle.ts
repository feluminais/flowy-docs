import { useState } from 'react'
import type { LineStyle, Model } from '../../src/core/model.ts'
import { LINE_STYLES, lineStyle } from '../../src/core/model.ts'
import { setLines } from '../../src/core/ops.ts'
import type { SaveEdit } from './forms.tsx'
import { keepOwnLines, ownLines } from './lines.ts'

/** How lines look: in edit mode the project's style, which is what the picker changes there; reading, the picker only changes this screen. */
export function useLineStyle({ model, editing, run }: { model: Model; editing: boolean; run: SaveEdit }) {
  const [mine, setMine] = useState(ownLines)
  const projectLines = lineStyle(model)
  const lines = editing ? projectLines : mine ?? projectLines
  const pickLines = (value: string) => {
    const style = LINE_STYLES.find(s => s === value)
    if (style === undefined) return
    const own = (s: LineStyle | undefined) => {
      keepOwnLines(s)
      setMine(s)
    }
    // In edit mode the project's style is what you see, so once it's saved your own choice goes.
    if (editing) void run(m => setLines(m, style)).then(saved => saved && own(undefined))
    else own(style === projectLines ? undefined : style) // the project's own style isn't kept as a pick: the screen follows the project again
  }
  return { lines, pickLines }
}
