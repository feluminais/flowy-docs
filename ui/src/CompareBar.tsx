import type { Compare } from './compare.ts'
import { ArrowsLeftRight, Close } from './icons.tsx'

/**
 * The bar over the two panes, in the look of the top bar: the two ways to view (Side by side, or Swap, which flips one canvas between the flows), a control that puts the
 * flows on each other's side, and Close.
 */
export function CompareBar({ mode, onMode, onFlip, onClose }: { mode: Compare['mode']; onMode: (mode: Compare['mode']) => void; onFlip: () => void; onClose: () => void }) {
  return (
    <div className="bar compare-bar" role="group" aria-label="Compare">
      <button aria-pressed={mode === 'side'} onClick={() => onMode('side')}>Side by side</button>
      {/* Swap comes with its own animation; the choice is here so the bar is the one it will have. */}
      <button aria-pressed={mode === 'swap'} disabled title="Swap is not built yet" onClick={() => onMode('swap')}>Swap</button>
      <button className="icon" aria-label="Swap sides" title="Swap sides" onClick={onFlip}><ArrowsLeftRight size={16} /></button>
      <span className="grow" />
      <button title="Close the comparison (Esc)" onClick={onClose}><Close size={16} />Close</button>
    </div>
  )
}
