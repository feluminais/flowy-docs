import type { FlowDiff } from '../../src/core/flowdiff.ts'
import type { Compare } from './compare.ts'
import { CompareKey } from './CompareKey.tsx'
import { ArrowsLeftRight, Close } from './icons.tsx'

/** What the bar adds in Swap: the two flows' names, in the order they read, and which one is on show. */
export type SwapChoice = { names: [string, string]; on: 0 | 1; onShow: (side: 0 | 1) => void }

/** The switch for the change marks: whether they are on, why it is greyed out when it can't apply, and (while on) what differs, for the key beside it. */
export type ChangesSwitch = { on: boolean; onToggle: () => void; off?: string; diff?: FlowDiff; sides: ('older' | 'newer')[] }

/**
 * The bar over the two panes, in the look of the top bar: the two ways to view (Side by side, or Swap, which flips one canvas between the flows), a control that puts the
 * flows on each other's side, the switch for the change marks with their key, and Close. In Swap it names the two flows, the one on show marked, and a click on the other swaps to it.
 */
export function CompareBar({ mode, onMode, onFlip, onClose, swap, changes }: { mode: Compare['mode']; onMode: (mode: Compare['mode']) => void; onFlip: () => void; onClose: () => void; swap: SwapChoice; changes: ChangesSwitch }) {
  return (
    <div className="bar compare-bar" role="group" aria-label="Compare">
      <button aria-pressed={mode === 'side'} onClick={() => onMode('side')}>Side by side</button>
      <button aria-pressed={mode === 'swap'} title="One canvas that flips between the flows" onClick={() => onMode('swap')}>Swap</button>
      {mode === 'swap' && (
        <>
          <span className="sep" aria-hidden="true" />
          {([0, 1] as const).map(side => (
            <button key={side} className="flow-name" aria-pressed={swap.on === side} aria-current={swap.on === side ? 'true' : undefined} title={swap.on === side ? `${swap.names[side]} is on show` : `Swap to ${swap.names[side]} (X)`}
              onClick={() => swap.on !== side && swap.onShow(side)}>{swap.names[side]}</button>
          ))}
        </>
      )}
      <button className="icon" aria-label="Swap sides" title="Swap sides" onClick={onFlip}><ArrowsLeftRight size={16} /></button>
      <span className="sep" aria-hidden="true" />
      <span className="marks-label">Marks</span>
      <button aria-pressed={changes.on} disabled={changes.off !== undefined} title={changes.off ?? 'Mark what differs between the flows'} onClick={changes.onToggle}>Show changes</button>
      {changes.on && changes.diff && <CompareKey diff={changes.diff} sides={changes.sides} />}
      <span className="grow" />
      <button title="Close the comparison (Esc)" onClick={onClose}><Close size={16} />Close</button>
    </div>
  )
}
