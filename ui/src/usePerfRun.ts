import { useEffect, useMemo, useRef, useState } from 'react'
import { kneeOf } from '../../src/core/perf/analyse.ts'
import { dialsOf } from '../../src/core/perf/dials.ts'
import { callSize } from '../../src/core/perf/measure.ts'
import type { Measure } from '../../src/core/perf/measure.ts'
import type { Dial, Run } from '../../src/core/perf/types.ts'
import type { Perf } from './hash.ts'
import { activeRun, clampDial, clampPos, dialTop, loadAt, openingPositions, placeActive, rampActive, rampFrom, rampFromActive, rampPos, RAMP_STEP_MS, snap, top } from './perfview.ts'

const NO_DIALS: Dial[] = [] // the same array every time, for a run that is not there
const SCRUB_MS = 250 // ms after the slider of a run was last dragged that the shapes still change their state at once, with no fade

/**
 * The run the Performance panel shows and where along it: which run, a position for each of its dials (one for a run of one source), and `active`, the dial the keys and
 * Ramp act on, the one that was moved last. A whole number is a tested level; a ramp goes between them. Whether the panel is open is not in here (it is the Performance tab of the navigator), but a
 * ramp stops when it closes: the reader calls `stopRamp` then.
 *
 * `still` is the reader's wish for no motion: there is no ramp then. `named` is the run the page's address names, read once when the page opens. A pane of a comparison names just
 * its run, and the run opens where a run does without an address: at its first struggle. The hook never writes the address, so any number of them can live at once.
 */
export function usePerfRun({ runs, named, still }: { runs: Record<string, Run>; named: () => (Pick<Perf, 'run'> & Partial<Perf>) | undefined; still: boolean }) {
  // Where a run opens: a single run at the level its address names, else at its first struggle, else at the top. A run with several sources at the places its address names when it
  // names one for each dial, else together at the first struggle (each dial along its own loads), else every dial at its top.
  const startPositions = (id: string, level?: number, levels?: number[]): number[] => {
    const dialled = dialsOf(runs, id)
    if (!dialled) return [0]
    if (dialled.mode === 'single') return [clampPos(runs[id], (levels === undefined ? level : undefined) ?? kneeOf(runs, id)?.index ?? top(runs[id]))]
    if (levels !== undefined && levels.length === dialled.dials.length) return dialled.dials.map((d, i) => clampDial(d, levels[i]))
    return openingPositions(dialled.dials, kneeOf(runs, id))
  }
  const [runId, setRunId] = useState(() => {
    const run = named()?.run
    return run !== undefined && Object.hasOwn(runs, run) ? run : Object.keys(runs)[0] ?? ''
  })
  const [positions, setPositions] = useState(() => startPositions(runId, named()?.level, named()?.levels))
  const [active, setActive] = useState(0)
  const [ramping, setRamping] = useState(false)
  const [asked, setMeasure] = useState<Measure>() // what the lines show, as the reader chose it: none yet means the run's own best (see `measure` for what is drawn)
  const [scrubbing, setScrubbing] = useState(false) // the slider of a run is being dragged: the states of shapes snap instead of moving
  const scrubTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(scrubTimer.current), [])
  const posNow = useRef(positions) // the ramp reads where it is from here, so a render in between never makes it start over

  // The run on show and where along it: a run that was renamed, deleted or cut short under a live reload falls back to one that is there.
  const runKey = activeRun(runs, runId)
  const loadTest = runKey ? runs[runKey] : undefined
  // What the run is turned up on: one dial for a run of one source, one for each source of a run with several.
  const found = useMemo(() => (runKey ? dialsOf(runs, runKey) : undefined), [runs, runKey])
  const dials = found?.dials ?? NO_DIALS
  const multi = found !== undefined && found.mode !== 'single'
  // Data needs the run to give the size of a call. A run that doesn't draws Calls whatever was chosen, and the switch says why.
  const dataOff = useMemo(() => (runKey && callSize(runs, runKey) === undefined ? 'No size of a call in this run' : undefined), [runs, runKey])
  // Mixed (stripes for the calls and blobs for the data) when the run gives both, else the calls. A run with no sizes draws Calls whatever was chosen.
  const wanted: Measure = asked ?? (dataOff === undefined ? 'mixed' : 'calls')
  const measure: Measure = wanted !== 'calls' && dataOff !== undefined ? 'calls' : wanted
  const activeDial = Math.min(active, Math.max(0, dials.length - 1))
  const here = multi ? dials.map((d, i) => clampDial(d, positions[i] ?? 0)) : [loadTest ? clampPos(loadTest, positions[0] ?? 0) : 0]
  const hereKey = here.join(',')
  if (!ramping) posNow.current = here // while it ramps, the ramp is ahead of what the screen shows
  const load = loadTest && !multi ? loadAt(loadTest, here[0]) : 0 // the load at the position on show, or for a run over time the time (a run with several sources has none of its own)

  // Ramp: the load sweeps up through the tested levels on its own, with a frame for each step of the screen.
  useEffect(() => {
    if (!ramping || !loadTest) return
    let last = performance.now()
    let shown = last // when the screen last got a position
    let frame = 0
    const tick = (t: number) => {
      const ms = Math.min(100, t - last) // a tab that was asleep doesn't jump
      const next = multi ? rampActive(dials, posNow.current, activeDial, ms) : [rampPos(loadTest, posNow.current[0], ms)]
      last = t
      posNow.current = next
      const done = multi ? next[activeDial] >= dialTop(dials[activeDial]) : next[0] >= top(loadTest)
      if (done || t - shown >= RAMP_STEP_MS) {
        shown = t
        setPositions(next)
      }
      if (done) setRamping(false)
      else frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ramping, loadTest, multi, dials, activeDial])

  const stopRamp = () => setRamping(false)
  /** Show a run, at `at` (default: where it opens). The ramp, if any, is the caller's to stop. */
  const pick = (id: string, at = startPositions(id)) => {
    setRunId(id)
    setPositions(at)
    setActive(0)
  }
  // Ramp a dial (the active one when none is named), or stop the ramp that runs on it. Pressing another dial's button moves the ramp there.
  const toggleRamp = (dial = activeDial) => {
    if (!loadTest || still) return
    if (ramping && dial === activeDial) {
      setPositions(posNow.current) // where it has got to, not where the screen last was
      return setRamping(false)
    }
    setActive(dial) // a ramp is of the dial it was started on
    const from = multi ? rampFromActive(dials, posNow.current, dial) : [rampFrom(loadTest, posNow.current[0])] // at the top, a ramp starts again from the bottom
    posNow.current = from // the ramp reads it before the next render
    setPositions(from)
    setRamping(true)
  }
  // To a tested level of the active dial (or of the dial named): the arrow keys and Home and End.
  const stepLevel = (to: number, dial = activeDial) => {
    if (!loadTest) return
    setRamping(false)
    if (multi) {
      setActive(dial)
      setPositions(placeActive(dials, here, dial, Math.round(clampDial(dials[dial], to))))
    } else setPositions([snap(loadTest, to)])
  }
  // Go to a place with every dial at its position (Go there), at tested levels.
  const placeAll = (to: number[]) => {
    if (!loadTest) return
    setRamping(false)
    setPositions(multi ? dials.map((d, i) => clampDial(d, to[i] ?? 0)) : [snap(loadTest, to[0] ?? 0)])
  }
  // Anywhere along the run, not only at a level: a click on an event. The states move to it, as they do for a step.
  const jumpTo = (to: number) => {
    if (!loadTest) return
    setRamping(false)
    setPositions([clampPos(loadTest, to)])
  }
  // The slider of a dial is being dragged: the states follow at once, and for a moment after the last move (a drag is many moves), so the shapes don't fade behind the thumb.
  const slide = (to: number, dial = activeDial) => {
    if (!loadTest) return
    setScrubbing(true)
    clearTimeout(scrubTimer.current)
    scrubTimer.current = setTimeout(() => setScrubbing(false), SCRUB_MS)
    if (multi) {
      setRamping(false)
      setActive(dial)
      setPositions(placeActive(dials, here, dial, to))
    } else jumpTo(to)
  }

  return { runKey, loadTest, measure, setMeasure, dataOff, dials, multi, activeDial, here, hereKey, load, ramping, scrubbing, startPositions, pick, stopRamp, toggleRamp, stepLevel, placeAll, jumpTo, slide, setActive }
}
