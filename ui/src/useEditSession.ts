import { useRef, useState } from 'react'
import type { XYPosition } from '@xyflow/react'
import type { Model } from '../../src/core/model.ts'
import type { SaveEdit } from './forms.tsx'
import type { Edit, Restore } from './useModel.ts'

type Back = () => Promise<string | undefined>
type Op = (model: Model) => Model

/** A box moved by a drag or an arrow key. `dragging` is false for the last move. */
export type Moved = { id: string; position: XYPosition; dragging?: boolean }

/**
 * The reader's edit session: whether edit mode is on, the notice under the canvas, where boxes are being dragged to, and the runner every edit goes through.
 *
 * `justMoved` is the one subtle bit: the last thing done was dragging a box, and nothing has been done since, so Esc or Backspace take it back (see `undoesMove` in keys.ts).
 * Everything else the reader does calls `didSomethingElse()` so that it is not left standing. It is a ref on purpose: it must never re-render.
 */
export function useEditSession({ edit, undo, redo, restore, readOnly }: { edit: Edit; undo: Back; redo: Back; restore: Restore; readOnly: boolean }) {
  const [editMode, setEditMode] = useState(false)
  const [notice, setNotice] = useState<string>()
  // Where boxes are being dragged to. Nodes are controlled, so a box only moves through this.
  const [moved, setMoved] = useState(new Map<string, XYPosition>())
  const layoutSaves = useRef(0) // layout saves still queued; `moved` is cleared once the last one is back
  const justMoved = useRef(false)
  const banding = useRef(false) // a box is being drawn round shapes to pick them (Shift and drag)
  // A file that can't be read, a lost server, or an exported page makes the canvas read-only.
  const editing = editMode && !readOnly

  /** The reader did something that is not dragging a box: a click, an edit, a move to another level. Esc and Backspace go back to closing and going up. */
  const didSomethingElse = () => {
    justMoved.current = false
  }
  /** Boxes dragged to where the file does not say any more are shown where the file says. */
  const clearMoved = () => setMoved(new Map())

  /** Every edit goes through here: the notice of an earlier one goes, and the notice of this one (if it failed) comes. Resolves to whether it worked. */
  const run: SaveEdit = async op => {
    didSomethingElse()
    setNotice(undefined)
    const message = await edit(op)
    setNotice(message)
    return message === undefined
  }
  const takeBack = async () => {
    didSomethingElse()
    setNotice(undefined)
    setNotice((await undo()) ?? 'Undone.')
    clearMoved() // a box dragged back shows where the file says
  }
  const bringBack = async () => {
    didSomethingElse()
    setNotice(undefined)
    setNotice((await redo()) ?? 'Redone.')
    clearMoved()
  }
  // Putting a version back from the YAML tab: the notice says which, and a shape dragged earlier shows where the file says.
  const restoreVersion = async (id: string, seen: Record<string, string | null>, label: string) => {
    didSomethingElse()
    setNotice(undefined)
    const message = await restore(id, seen, label)
    setNotice(message ?? `${label}.`)
    clearMoved()
    return message
  }

  /** E: edit mode on or off. */
  const toggleEditMode = () => {
    didSomethingElse()
    setEditMode(!editing)
    setNotice(undefined) // "Press E to fix this flow" is stale the moment E is pressed
  }
  /** The reader moved to another view: what was dragged there is no longer on screen. */
  const viewChanged = () => {
    didSomethingElse()
    clearMoved()
  }

  /**
   * Boxes were moved (a drag, or an arrow key on a selected box). The last move of a drag saves the whole view's layout: `layout` makes the edit for where every box now stands.
   * Arrow keys queue a save per press, so `moved` is cleared only after the last of them is back, or an early one would snap the box back mid-way.
   */
  const dragged = (moves: Moved[], layout: (at: Map<string, XYPosition>) => Op) => {
    const next = new Map(moved)
    for (const c of moves) next.set(c.id, c.position)
    setMoved(next)
    if (moves.some(c => c.dragging)) return
    layoutSaves.current++
    void run(layout(next)).then(saved => {
      layoutSaves.current--
      if (layoutSaves.current === 0) clearMoved()
      justMoved.current = saved
    })
  }

  /** Shift and drag on the empty canvas: a box is drawn round shapes to pick them. */
  const startBanding = () => {
    banding.current = true
    didSomethingElse()
  }
  const endBanding = () => {
    banding.current = false
  }

  return {
    editing, notice, setNotice, moved, run, takeBack, bringBack, restoreVersion,
    toggleEditMode, viewChanged, clearMoved, dragged, didSomethingElse,
    /** Whether Esc or Backspace should take back a drag now (read when the key is pressed, not when it renders). */
    justMoved: () => justMoved.current,
    startBanding, endBanding, isBanding: () => banding.current,
  }
}
