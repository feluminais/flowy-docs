import type { Model } from '../../src/core/model.ts'
import { dependents, needsDecision } from '../../src/core/dependents.ts'
import { deleteWith } from '../../src/core/ops.ts'
import { connectionsOf } from './edit.ts'
import type { SaveEdit } from './forms.tsx'
import type { Delete } from './Panel.tsx'
import type { Side } from './side.ts'
import { doneText, planOf } from './usedby.ts'

/** Deleting what is picked: shapes or lines, at once when nothing depends on them, else through the Used by panel. */
export function useDelete({ model, view, side, chosen, run, setSide, setNotice, announce, close }: {
  model: Model; view: string; side: Side | undefined; chosen: string[]; run: SaveEdit; setSide: (side: Side | undefined) => void; setNotice: (notice: string) => void
  announce: (text: string) => void; close: () => void
}) {
  /** Deletes shapes or lines: at once when nothing depends on them (the notice says what went with them, and Undo is beside it), else the Used by panel opens to settle what does. */
  const askDelete: Delete = (targets, then) => {
    if (dependents(model, targets).some(needsDecision)) return setSide({ kind: 'usedby', targets, back: side })
    const text = doneText(model, planOf(model, targets, {}), {}, targets)
    void run(m => deleteWith(m, targets, [])).then(saved => {
      if (!saved) return
      announce(text)
      then?.()
    })
  }
  const remove = () => {
    // One edit for the lot, so one undo brings them all back.
    if (side?.kind === 'object' || side?.kind === 'objects') return askDelete(chosen.map(object => ({ object })), close)
    if (side?.kind !== 'line') return
    const merged = connectionsOf(model, view, side.from, side.to)
    if (merged.length > 1) return setNotice(`This line stands for ${merged.length} connections. Delete them one at a time in the panel.`)
    const c = merged[0]?.connection
    if (c) askDelete([{ line: { from: c.from, to: c.to, label: c.label ?? '' } }], close)
  }
  return { askDelete, remove }
}
