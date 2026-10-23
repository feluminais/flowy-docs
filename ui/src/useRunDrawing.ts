import { useMemo } from 'react'
import type { Model } from '../../src/core/model.ts'
import { runStates } from '../../src/core/perf/analyse.ts'
import { trafficAt } from '../../src/core/perf/traffic.ts'
import { eventsOf } from '../../src/core/perf/types.ts'
import type { Run, Setting } from '../../src/core/perf/types.ts'
import { marksOf } from '../../src/core/states.ts'
import type { StateMark } from '../../src/core/states.ts'
import { lineId } from './graph.ts'
import { settingOf } from './perfview.ts'
import { NO_MARKS } from './useFlowStage.ts'
import type { usePerfRun } from './usePerfRun.ts'

/** What `usePerfRun` holds: a run and where along it. */
export type PerfRunState = ReturnType<typeof usePerfRun>

/**
 * What a run puts on a canvas, from where it is along: the traffic on each line and measurements of each shape (`loadTraffic`), the thickness of each line, and for a run over time
 * the states its events have left the shapes in so far. The single canvas of the reader and each pane of a comparison of runs both take it from here, so they draw a run alike.
 * `shown` is whether the run is on a canvas at all: the single canvas draws one only while the Performance tab is open.
 *
 * The state marks are kept as text so that the graph (which takes dagre tens of ms) is rebuilt only when a state changes, not on every step of a Play.
 */
export function useRunDrawing({ model, runs, perf, view, shown }: { model: Model; runs: Record<string, Run>; perf: PerfRunState; view: string; shown: boolean }) {
  const { runKey, loadTest, dials, multi, here, hereKey, load, measure } = perf
  const timeEvents = shown && loadTest !== undefined && eventsOf(loadTest).length > 0
  const marksText = timeEvents && loadTest ? JSON.stringify(marksOf(model, runStates(loadTest, load))) : ''
  const runMarks = useMemo(() => (marksText === '' || marksText === '{}' ? NO_MARKS : (JSON.parse(marksText) as Record<string, StateMark>)), [marksText])
  const setting = useMemo<Setting>(() => (multi ? settingOf(dials, here) : { '': load }), [multi, dials, hereKey, load])
  const loadTraffic = useMemo(() => (shown && loadTest ? trafficAt(model, runs, runKey, setting, view, measure) : undefined), [shown, model, runs, runKey, loadTest, setting, view, measure])
  const widths = useMemo(() => new Map(loadTraffic?.lines.map(l => [lineId(l.from, l.to), l.width])), [loadTraffic])
  return { timeEvents, runMarks, loadTraffic, widths }
}
