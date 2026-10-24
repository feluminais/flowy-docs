import { useEffect } from 'react'
import type { Dispatch, RefObject, SetStateAction } from 'react'
import type { Flow, Model } from '../../src/core/model.ts'
import { ROOT } from '../../src/core/model.ts'
import { parentOf } from '../../src/core/views.ts'
import type { CompareHandle } from './CompareView.tsx'
import type { Compare } from './compare.ts'
import { neighbour } from './failuresview.ts'
import { fitOptions } from './graph.ts'
import { keepsKeys } from './keys.ts'
import { contextOf, dispatch } from './keymap.ts'
import type { KeyActions, KeyState } from './keymap.ts'
import { dialTop, stepFrom, top } from './perfview.ts'
import { sideFor } from './side.ts'
import type { FlowSide, Side } from './side.ts'
import type { useCanvasEvents } from './useCanvasEvents.ts'
import type { useEditSession } from './useEditSession.ts'
import type { useFailuresView } from './useFailuresView.ts'
import type { useFlowStage } from './useFlowStage.ts'
import type { useNavigation } from './useNavigation.ts'
import type { usePanels } from './usePanels.ts'
import type { usePerfRun } from './usePerfRun.ts'
import type { Play } from './usePlayer.ts'

/**
 * The keyboard. Added again on every render, so the handler always sees the current state. Which key does what is in keymap.ts; this builds what it needs to know and can do.
 */
export function useReaderKeys({ model, view, editing, readOnly, canPerf, session, panels, perfRun, perfOpen, runsOpen, failuresOpen, shortcuts, setShortcuts, setSearching, flow, stops, stopIndex, stepTo, togglePlay, replay, setPlaying, comparing, compareRef, toggleCompare, closeCompare, recording, setSide, show, detailsOpen, manyPicked, closeDetails, failures, navigation, selectedBox, canOpen, fitNow, toggleEdit, remove, members }: {
  model: Model; view: string; editing: boolean; readOnly: boolean; canPerf: boolean; session: ReturnType<typeof useEditSession>; panels: ReturnType<typeof usePanels>
  perfRun: ReturnType<typeof usePerfRun>; perfOpen: boolean; runsOpen: boolean; failuresOpen: boolean; shortcuts: boolean; setShortcuts: Dispatch<SetStateAction<boolean>>; setSearching: (searching: boolean) => void
  flow: Flow | undefined; stops: ReturnType<typeof useFlowStage>['stops']; stopIndex: number; stepTo: (stop: number) => void; togglePlay: () => void; replay: () => void
  setPlaying: (playing: Play | undefined) => void; comparing: Compare | undefined; compareRef: RefObject<CompareHandle | null>; toggleCompare: () => void; closeCompare: () => void
  recording: FlowSide | undefined; setSide: (side: Side | undefined) => void; show: (s: Side | undefined) => void; detailsOpen: boolean; manyPicked: boolean; closeDetails: () => void
  failures: Pick<ReturnType<typeof useFailuresView>, 'analysis' | 'rows' | 'mode' | 'modeId' | 'selectMode'>; navigation: Pick<ReturnType<typeof useNavigation>, 'motion' | 'back' | 'jumpTo' | 'zoomInto'>
  selectedBox: string | undefined; canOpen: (id: string) => boolean; fitNow: ReturnType<typeof useCanvasEvents>['fitNow']; toggleEdit: () => void; remove: () => void; members: string[]
}) {
  const { nav, navUsed, setTab, toggleTab, closePerf, closeFailures, detailsWidth, navWidth } = panels
  const { here, activeDial, loadTest, multi, dials } = perfRun
  const { analysis, rows, mode, modeId, selectMode } = failures
  const { motion, back, jumpTo, zoomInto } = navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inNavigator = e.target instanceof Element && e.target.closest('.navpanel') !== null
      // A text field keeps its keys. A slider, a checkbox or a colour does not: one that was just used keeps the focus, and the keys stay the tab's (arrows and Home and End step the run).
      // The navigator's filters clear themselves on Escape and stop it, so one that gets here is empty: a click in it lets Escape close the navigator.
      // A field in the Failures tab's forms keeps its Escape: a half-filled form is not thrown away by it.
      if (keepsKeys(e.target as HTMLElement | null)) {
        if (!(e.key === 'Escape' && inNavigator && e.target instanceof HTMLInputElement && e.target.closest('.navfind') !== null)) return
      }
      const state: KeyState = {
        editing, justMoved: session.justMoved(), shortcuts, navigatorOpen: nav !== undefined, navigatorUsed: navUsed.current, flow: flow !== undefined, compare: comparing !== undefined, swap: comparing?.mode === 'swap', runCompare: comparing?.kind === 'run', halfStep: recording?.from !== undefined,
        panel: detailsOpen || manyPicked || perfOpen || runsOpen || failuresOpen, inside: view !== ROOT && !comparing, paneInside: comparing?.kind === 'flow' && compareRef.current?.focused()?.inside() === true, recording: recording !== undefined, perfOpen, failuresOpen, analysis: analysis !== undefined, readOnly,
        canPerf,
      }
      const act: KeyActions = {
        takeBack: () => void session.takeBack(),
        bringBack: () => void session.bringBack(),
        closeShortcuts: () => setShortcuts(false),
        toggleShortcuts: () => setShortcuts(open => !open),
        closeNavigator: () => setTab(undefined),
        stopFlow: () => setPlaying(undefined),
        compare: toggleCompare,
        closeCompare,
        swap: () => compareRef.current?.swap(),
        clearStep: () => { if (recording) setSide({ ...recording, from: undefined, to: undefined }) },
        closePanel: () => (detailsOpen || manyPicked ? closeDetails() : perfOpen || runsOpen ? closePerf() : closeFailures()),
        // A second press while a zoom out is still leaving goes up from where that one is heading.
        back: () => (comparing ? compareRef.current?.focused()?.up() : back()), // a pane of a comparison goes up from where it is zoomed to
        up: () => (comparing ? compareRef.current?.focused()?.up() : jumpTo(parentOf(model, motion?.phase === 'leave' && motion.dir === 'out' ? motion.to : view))),
        // With two runs side by side the keys of the Performance tab act on the pane that has the focus.
        stepRun: by => (comparing ? compareRef.current?.focusedRun()?.step(by) : perfRun.stepLevel(stepFrom(here[activeDial], by))),
        runEnd: end => {
          if (comparing) compareRef.current?.focusedRun()?.end(end)
          else if (end === 'first') perfRun.stepLevel(0)
          else if (loadTest) perfRun.stepLevel(multi ? dialTop(dials[activeDial]) : top(loadTest))
        },
        ramp: () => (comparing ? compareRef.current?.focusedRun()?.ramp() : perfRun.toggleRamp()),
        stepFailure: by => selectMode(neighbour([...rows.here, ...rows.elsewhere].map(r => r.id), mode ? modeId : undefined, by)),
        // With two flows side by side the keys of a flow act on the pane that has the focus.
        stepFlow: by => (comparing ? compareRef.current?.focused()?.step(by) : stepTo(stopIndex + by)),
        flowEnd: end => (comparing ? compareRef.current?.focused()?.end(end) : stepTo(end === 'first' ? 0 : stops.length - 1)),
        play: () => (comparing ? compareRef.current?.focused()?.play() : togglePlay()),
        replay: () => (comparing ? compareRef.current?.focused()?.replay() : replay()),
        enter: () => {
          // The box with keyboard focus (Tab moves it), else the one whose panel is open: in if it opens, else its panel. A pane of a comparison does not open boxes.
          const id = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.react-flow__node-box')?.dataset.id ?? selectedBox
          if (id === undefined) return false
          if (comparing) show({ kind: 'object', id })
          else if (canOpen(id)) zoomInto(id)
          else show({ kind: 'object', id })
          return true
        },
        search: () => setSearching(true),
        fit: () => (comparing ? (comparing.kind === 'run' ? compareRef.current?.focusedRun() : compareRef.current?.focused())?.fit() : fitNow.current?.({ ...fitOptions(detailsOpen ? detailsWidth : 0, flow !== undefined, nav ? navWidth : 0), duration: 300 })),
        toggleTab,
        togglePerf: () => toggleTab('performance'),
        toggleFailures: () => toggleTab('failures'),
        toggleEdit,
        add: () => show({ kind: 'add' }),
        remove,
        selectAll: () => show(sideFor(members)),
      }
      if (dispatch(contextOf(e, inNavigator, state, act))) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
