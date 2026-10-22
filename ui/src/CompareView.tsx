import { useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { ColorMode } from '@xyflow/react'
import { diffFlows } from '../../src/core/flowdiff.ts'
import type { SideMarks } from '../../src/core/flowdiff.ts'
import type { LineStyle, Model } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import { marksFor, orderPair, samePick } from './compare.ts'
import type { Compare, Picked } from './compare.ts'
import { CompareBar } from './CompareBar.tsx'
import { ComparePane } from './ComparePane.tsx'
import type { PaneHandle } from './ComparePane.tsx'
import { lineId } from './graph.ts'
import { SwapCanvas } from './SwapCanvas.tsx'
import { usePref } from './store.ts'

/** Where the switch for the change marks is kept, so it is as last time. Storage may be blocked or empty: the marks then start off. */
const MARKS_KEY = 'flowy.compare.marks'

/** What the reader can reach in the view: the pane that has the focus (in Swap, the flow on show), which the keys of a flow act on, and the swap itself. */
export type CompareHandle = { focused(): PaneHandle | null; swap(): void }

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
 * In Swap there is one canvas instead (SwapCanvas), showing one flow at a time; the keys of a flow act on that one.
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
  // In Swap the flows keep a place that does not change when the sides swap (the sorted order), so each keeps its player; `on` is the one on show, as a place in it. It starts at
  // the flow whose pane had the focus.
  const places = flows[0] <= flows[1] ? flows : [flows[1], flows[0]]
  const placeOf = (side: 0 | 1): 0 | 1 => (flows[0] === flows[1] ? side : flows[side] === places[0] ? 0 : 1)
  const [on, setOn] = useState<0 | 1>(() => placeOf(focused))
  const swapRef = useRef<PaneHandle>(null)
  const swap = compare.mode === 'swap'
  useImperativeHandle(ref, () => ({ focused: () => (swap ? swapRef.current : refs[focused].current), swap: () => setOn(i => (i === 0 ? 1 : 0)) }))
  const pick = (key: string, picked: Picked) => {
    setFocusKey(key)
    if (last === key && samePick(shown, picked)) return onClosePanel() // its panel is already open: a second click closes it
    setLast(key)
    onPick(picked)
  }
  const mode = (m: Compare['mode']) => {
    if (m === 'swap' && compare.mode !== 'swap') setOn(placeOf(focused)) // Swap opens on the flow whose pane has the focus
    onMode(m)
  }
  const names = flows.map(id => model.flows[id].name || id) as [string, string]
  // The change marks: the flow that holds the tag (the newer; else the one on the right) is compared with the other, and each pane draws its own side's marks. Runs have none.
  const [marksPref, setMarksPref] = usePref(MARKS_KEY, 'off')
  const marksOff = compare.kind === 'flow' ? undefined : 'Not for runs'
  const marksOn = marksPref === 'on' && marksOff === undefined
  const [older, newer] = orderPair('flow', model.flows, compare.a, compare.b)
  const diff = useMemo(() => (marksOn ? diffFlows(model.flows[older], model.flows[newer]) : undefined), [marksOn, model.flows[older], model.flows[newer]])
  const marksOf = (id: string): SideMarks | undefined => diff && marksFor(diff, id === newer ? 'newer' : 'older')
  return (
    <div className={['compare', nav && 'nav', details && 'details'].filter(Boolean).join(' ')}>
      <CompareBar mode={compare.mode} onMode={mode} onFlip={onFlip} onClose={onClose} swap={{ names, on: placeOf(0) === on ? 0 : 1, onShow: side => setOn(placeOf(side)) }}
        changes={{ on: marksOn, onToggle: () => setMarksPref(marksOn ? 'off' : 'on'), off: marksOff, diff }} />
      {swap ? (
        <div className="panes one">
          <SwapCanvas key={places.join('|')} ref={swapRef} model={model} paneId={`${places[0]}-${places[1]}`.replace(/[^A-Za-z0-9_-]/g, '_')} flows={[places[0], places[1]]} index={on} start={start} shown={shown}
            marks={diff && [marksOf(places[0])!, marksOf(places[1])!]} onPick={picked => (samePick(shown, picked) ? onClosePanel() : onPick(picked))} onClosePanel={onClosePanel} onEmpty={onEmpty} fitKey="" colorMode={colorMode} problems={problems} lines={lines} still={still} />
        </div>
      ) : (
        <div className="panes">
          {([0, 1] as const).map(slot => {
            const id = flows[slot]
            const own = last === keys[slot] ? shown : undefined
            return (
              <ComparePane key={keys[slot]} ref={refs[slot]} model={model} paneId={`${id.replace(/[^A-Za-z0-9_-]/g, '_')}-${again(slot)}`} flowId={id} title={model.flows[id].name || id}
                label={again(slot) ? `${model.flows[id].name || id} (2)` : undefined} startAt={start?.flow === id && !again(slot) ? start.step : undefined} onEmpty={onEmpty} focused={focused === slot} onFocus={() => setFocusKey(keys[slot])}
                onPick={p => pick(keys[slot], p)} selectedBox={own?.kind === 'object' ? own.id : undefined} selectedLine={own?.kind === 'line' ? lineId(own.from!, own.to!) : undefined}
                marks={marksOf(id)} fitKey={compare.mode} colorMode={colorMode} problems={problems} lines={lines} still={still} />
            )
          })}
        </div>
      )}
    </div>
  )
}
