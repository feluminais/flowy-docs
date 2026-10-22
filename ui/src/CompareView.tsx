import { useImperativeHandle, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { ColorMode } from '@xyflow/react'
import type { LineStyle, Model } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import { samePick } from './compare.ts'
import type { Compare, Picked } from './compare.ts'
import { CompareBar } from './CompareBar.tsx'
import { ComparePane } from './ComparePane.tsx'
import type { PaneHandle } from './ComparePane.tsx'
import { lineId } from './graph.ts'

/** What the reader can reach in the view: the pane that has the focus, which the keys of a flow act on. */
export type CompareHandle = { focused(): PaneHandle | null }

type Shown = { kind: string; id?: string; from?: string; to?: string; view?: string }

type Props = {
  model: Model
  compare: Compare
  problems: Problem[]
  colorMode: ColorMode
  lines: LineStyle
  still: boolean
  /** What the shared Details panel shows now, so the pane it came from can outline it and a second click on it can close the panel. */
  shown: Shown | undefined
  /** The navigator and the Details panel are open: they lie over the canvas, so the panes keep clear of them. */
  nav: boolean
  details: boolean
  onPick: (picked: Picked) => void
  onClosePanel: () => void
  onMode: (mode: Compare['mode']) => void
  onFlip: () => void
  onClose: () => void
  ref?: Ref<CompareHandle>
}

/**
 * Two flows side by side, each in a pane of its own, under the bar of the comparison. Every pane works alone (zoom, pan and play); they share the one Details panel, which shows
 * the last thing clicked in either. One pane has the focus (it is outlined): the first to start with, then the one last clicked or tabbed into. The keys of a flow act on it.
 */
export function CompareView({ model, compare, problems, colorMode, lines, still, shown, nav, details, onPick, onClosePanel, onMode, onFlip, onClose, ref }: Props) {
  const [focused, setFocused] = useState<0 | 1>(0)
  const [last, setLast] = useState<0 | 1>() // the pane the Details panel was opened from
  const refs = [useRef<PaneHandle>(null), useRef<PaneHandle>(null)]
  useImperativeHandle(ref, () => ({ focused: () => refs[focused].current }))
  const pick = (slot: 0 | 1, picked: Picked) => {
    setFocused(slot)
    if (last === slot && samePick(shown, picked)) return onClosePanel() // its panel is already open: a second click closes it
    setLast(slot)
    onPick(picked)
  }
  const flows = [compare.a, compare.b]
  return (
    <div className={['compare', nav && 'nav', details && 'details'].filter(Boolean).join(' ')}>
      <CompareBar mode={compare.mode} onMode={onMode} onFlip={onFlip} onClose={onClose} />
      <div className="panes">
        {([0, 1] as const).map(slot => {
          const id = flows[slot]
          const own = last === slot ? shown : undefined
          return (
            <ComparePane key={`${slot}:${id}`} ref={refs[slot]} model={model} slot={slot} flowId={id} title={model.flows[id].name || id} focused={focused === slot} onFocus={() => setFocused(slot)}
              onPick={p => pick(slot, p)} selectedBox={own?.kind === 'object' ? own.id : undefined} selectedLine={own?.kind === 'line' ? lineId(own.from!, own.to!) : undefined}
              fitKey={`${nav} ${details}`} colorMode={colorMode} problems={problems} lines={lines} still={still} />
          )
        })}
      </div>
    </div>
  )
}
