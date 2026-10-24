import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Flow, Model } from '../../src/core/model.ts'
import { compareOf } from '../../src/core/compare.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { compareOff, firstLinked, firstLinkedRun, openable, pairOf, playable, runCompareOff, runPairOf } from './compare.ts'
import type { Compare } from './compare.ts'
import type { PickAt } from './ComparePicker.tsx'
import type { NavTab } from './navstate.ts'
import type { Side } from './side.ts'
import type { Play } from './usePlayer.ts'
import type { usePerfRun } from './usePerfRun.ts'
import type { Tag } from './useModel.ts'

/**
 * What opens and closes a comparison: the Compare buttons of the player, of a flow's row and of the Performance tab's run header, the popovers under them, and the link a run keeps
 * to the one it is the newer of. Each popover hangs on its owner and closes when the owner goes. The state of the comparison is in useCompare.
 */
export function useCompareActions({ model, runs, editing, tag, setNotice, setSide, setCompare, setCompareStart, comparing, asking, setAsking, unlessDraft, flow, playing, setPlaying, stopIndex, perfRun, perfOpen, runsOpen, nav, leave }: {
  model: Model; runs: Record<string, Run>; editing: boolean; tag: Tag; setNotice: (notice: string | undefined) => void; setSide: (side: Side | undefined) => void
  setCompare: Dispatch<SetStateAction<Compare | undefined>>; setCompareStart: (start: { flow: string; step: number } | undefined) => void; comparing: Compare | undefined
  asking: { leave: () => void } | undefined; setAsking: (asking: { leave: () => void } | undefined) => void; unlessDraft: (leave: () => void) => boolean
  flow: Flow | undefined; playing: Play | undefined; setPlaying: Dispatch<SetStateAction<Play | undefined>>; stopIndex: number
  perfRun: ReturnType<typeof usePerfRun>; perfOpen: boolean; runsOpen: boolean; nav: NavTab | undefined; leave: (t: NavTab) => void
}) {
  const [picking, setPicking] = useState(false) // the popover of the player's Compare button
  const [rowPicking, setRowPicking] = useState<{ flow: string; at: PickAt }>() // the popover of a flow row's Compare button, in the Flows tab or the Explorer
  const [pickingRun, setPickingRun] = useState<'compare'>() // the popover under the Compare button of the Performance tab's run header
  const [linkingRun, setLinkingRun] = useState<string>() // the run whose Link with picker is open in the Performance tab while editing
  const [dropping, setDropping] = useState<{ id: string; other: string | undefined }>() // a run's link about to go with the note it holds, until the reader says yes
  const { runKey } = perfRun

  useEffect(() => {
    if (!flow) setPicking(false) // the popover hangs on the player
  }, [flow])
  useEffect(() => {
    setRowPicking(undefined) // and this one on a row of the Flows tab or the Explorer, which are gone when the tab is, or when editing starts
  }, [nav, editing])
  useEffect(() => {
    if (!perfOpen) setPickingRun(undefined) // and these hang on the run header
    if (!runsOpen) setLinkingRun(undefined)
  }, [perfOpen, runsOpen])

  /** Two flows side by side: `id` is the one that was playing, `other` the one picked to go with it. A flow that can't play doesn't open. */
  const openCompare = (id: string, other: string) => {
    setPicking(false)
    setRowPicking(undefined)
    if (!playable(model, id) || !playable(model, other)) return setNotice("That flow can't play yet.")
    setSide(undefined)
    setCompareStart(flow && playing?.flow === id ? { flow: id, step: stopIndex } : undefined)
    if (playing?.auto) setPlaying({ ...playing, auto: false }) // it must not start up again behind the panes, or when the comparison closes
    setCompare(pairOf(model, id, other))
  }
  /** Two runs side by side: `id` is the one the Performance tab showed, `other` the one picked to go with it. The tab leaves, as the comparison has a panel of its own for each run. */
  const openRunCompare = (id: string, other: string) => {
    setPickingRun(undefined)
    if (!openable(runs, id) || !openable(runs, other)) return setNotice("That run can't open.")
    setSide(undefined)
    perfRun.stopRamp()
    leave('performance')
    setCompare(runPairOf(runs, id, other))
  }
  /** Writes the link of run `id` (the run it is the newer of, or none to unlink), in its own file. A run's note belongs to its link, so one that would go with it asks first. */
  const writeLink = (id: string, other: string | undefined) =>
    void tag('run', id, other === undefined ? undefined : { with: other }).then(message => message !== undefined && setNotice(message))
  const linkRun = (id: string, other: string | undefined) => {
    const was = Object.hasOwn(runs, id) ? compareOf(runs[id].compare) : undefined
    if (was?.with === other || (was === undefined && other === undefined)) return // nothing to change
    if (was?.note !== undefined) setDropping({ id, other })
    else writeLink(id, other)
  }
  // Close, Esc and C all come here. With a note that isn't saved they ask first (see the prompt below); one more of them while it asks is a Keep.
  const closeCompare = () => {
    if (asking) return setAsking(undefined)
    if (unlessDraft(closeCompare)) return
    setCompare(undefined)
    setSide(undefined) // what it showed was clicked in a pane
  }
  /** C: close the comparison, or open it beside the flow playing (or the run the Performance tab shows), with the first one it is linked to or else the picker. */
  const toggleCompare = () => {
    if (comparing) return closeCompare()
    const off = perfOpen ? runCompareOff(runs, editing) : compareOff(model, editing)
    if (off !== undefined) return setNotice(off)
    if (perfOpen) {
      const other = firstLinkedRun(model, runs, runKey)
      if (other === undefined) setPickingRun(open => (open === 'compare' ? undefined : 'compare'))
      else openRunCompare(runKey, other)
      return
    }
    const id = flow ? playing?.flow : undefined
    if (id === undefined) return
    const other = firstLinked(model, id)
    if (other === undefined) setPicking(open => !open)
    else openCompare(id, other)
  }
  /** The Compare button on a flow's row in the navigator: the comparison with the first flow it is linked to, or else the picker under that row. */
  const compareRow = (id: string, at: PickAt) => {
    if (compareOff(model, editing) !== undefined) return
    if (unlessDraft(() => compareRow(id, at))) return
    const other = firstLinked(model, id)
    if (other === undefined) setRowPicking(open => (open?.flow === id ? undefined : { flow: id, at }))
    else openCompare(id, other)
  }
  return { picking, setPicking, rowPicking, setRowPicking, pickingRun, setPickingRun, linkingRun, setLinkingRun, dropping, setDropping, openCompare, openRunCompare, writeLink, linkRun, closeCompare, toggleCompare, compareRow }
}
