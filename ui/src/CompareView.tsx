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
  /** A click on nothing in a pane: the Details panel closes, as on the single canvas. */
  onEmpty: () => void
  /** The stop the flow that was playing was at, for its pane to start at. */
  start?: { flow: string; step: number }
  onMode: (mode: Compare['mode']) => void
  onFlip: () => void
  onClose: () => void
  ref?: Ref<CompareHandle>
}

/**
 * Two flows side by side, each in a pane of its own, under the bar of the comparison. Every pane works alone (zoom, pan and play); they share the one Details panel, which shows
 * the last thing clicked in either. One pane has the focus (it is outlined): the first to start with, then the one last clicked or tabbed into. The keys of a flow act on it.
 */
export function CompareView({ model, compare, problems, colorMode, lines, still, shown, nav, details, onPick, onClosePanel, onEmpty, start, onMode, onFlip, onClose, ref }: Props) {
  // A pane is keyed by its flow, so swapping the sides moves the panes (React moves their elements) instead of unmounting them: each keeps its place in its flow and its zoom.
  // A flow compared with itself has two panes, told apart by the second's suffix. The focus and the pane the panel came from follow the pane, not the side it is on.
  const flows = [compare.a, compare.b]
  const again = (i: number) => (i === 1 && flows[0] === flows[1] ? 1 : 0)
  const keys = flows.map((id, i) => (again(i) ? `${id}#1` : id))
  const [focusKey, setFocusKey] = useState<string>() // the first pane has it until one is clicked
  const [last, setLast] = useState<string>() // the pane the Details panel was opened from
  const focused = Math.max(0, keys.indexOf(focusKey ?? keys[0])) as 0 | 1
  const refs = [useRef<PaneHandle>(null), useRef<PaneHandle>(null)]
  useImperativeHandle(ref, () => ({ focused: () => refs[focused].current }))
  const pick = (key: string, picked: Picked) => {
    setFocusKey(key)
    if (last === key && samePick(shown, picked)) return onClosePanel() // its panel is already open: a second click closes it
    setLast(key)
    onPick(picked)
  }
  return (
    <div className={['compare', nav && 'nav', details && 'details'].filter(Boolean).join(' ')}>
      <CompareBar mode={compare.mode} onMode={onMode} onFlip={onFlip} onClose={onClose} />
      <div className="panes">
        {([0, 1] as const).map(slot => {
          const id = flows[slot]
          const own = last === keys[slot] ? shown : undefined
          return (
            <ComparePane key={keys[slot]} ref={refs[slot]} model={model} paneId={`${id.replace(/[^A-Za-z0-9_-]/g, '_')}-${again(slot)}`} flowId={id} title={model.flows[id].name || id}
              label={again(slot) ? `${model.flows[id].name || id} (2)` : undefined} startAt={start?.flow === id && !again(slot) ? start.step : undefined} onEmpty={onEmpty} focused={focused === slot} onFocus={() => setFocusKey(keys[slot])}
              onPick={p => pick(keys[slot], p)} selectedBox={own?.kind === 'object' ? own.id : undefined} selectedLine={own?.kind === 'line' ? lineId(own.from!, own.to!) : undefined}
              fitKey={compare.mode} colorMode={colorMode} problems={problems} lines={lines} still={still} />
          )
        })}
      </div>
    </div>
  )
}
