import { Close, Trash } from './icons.tsx'

/**
 * What shows while several shapes are picked in edit mode: how many, Delete, and a way to let them go. It sits at the foot of the canvas
 * and not in the side panel, which would cover the shapes picked, right where they are to be dragged.
 */
export function PickedBar({ count, onDelete, onClear }: { count: number; onDelete: () => void; onClear: () => void }) {
  return (
    <div className="picked-bar" role="toolbar" aria-label="Selected shapes">
      <span>{count} selected</span>
      <button className="danger" onClick={onDelete}><Trash size={16} />Delete</button>
      <button className="icon" aria-label="Clear selection" title="Clear selection (Esc)" onClick={onClear}><Close size={16} /></button>
    </div>
  )
}
