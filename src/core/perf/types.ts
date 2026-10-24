import type { CompareTag } from '../compare.ts'
import type { StateName } from '../states.ts'

/**
 * Load-test runs. A run is a test summarised: for each load level that was tested, what each object and each
 * connection measured. Flowy replays the numbers and never predicts: between two tested levels it interpolates,
 * and outside the tested range there is nothing to show. Pure, so the browser and the node side use the same code
 * (desktop/Flowy.Core/Perf*.cs is a port of it, kept equal by fixtures).
 */

/** Everything a run can measure. On an object: util, queue, errors. On a connection or overall: rate, bytes (a call's size), p50, p95, errors. A missing number means "not measured", never zero. */
export type Metrics = { util?: number; queue?: number; errors?: number; rate?: number; bytes?: number; p50?: number; p95?: number }
/** How the failing share of a line fails, when it is said: a request that is lost on the way, or one that is turned away at the end. Without one, the generic fade. */
export type Failure = 'lost' | 'rejected'
export const FAILURES: readonly Failure[] = ['lost', 'rejected']
/**
 * What one connection measured, or one line in a view once connections are rolled up. `by` splits what a line carries between the sources of a run that has
 * several (see Run.sources): each source's own `rate`, `bytes`, `p50` and `errors`, so its dots can take its colour and scale. Left out of a line that doesn't say.
 */
export type Pair = Metrics & { from: string; to: string; failure?: Failure; by?: Record<string, Metrics> }
/**
 * What was measured at one load (or one time). A run tested with several sources has no single load: its levels carry `loads`, a load for each source (and `load` is
 * 0, unused). The levelAt of a run with several sources gives `loads` too, as the setting it was worked out at.
 */
export type Level = { load: number; loads?: Record<string, number>; overall: Metrics; objects: Record<string, Metrics>; connections: Pair[] }
/** Where each dial of a run stands: a load for each, by the dial's id (a run with one source has one dial, with the id ''). See dialsOf and levelAt. */
export type Setting = Record<string, number>
/**
 * A formula as the run wrote it. Only the text is kept: a run travels to the browser as JSON, which drops anything but data, so the formula is read
 * from the text where it is used (see formulaOf). parseRun has already checked that the text reads.
 */
export type SourceFormula = { text: string }
/**
 * Where a run's requests come from, and how to draw them: the dots' colour (a colour name or hex, like a shape's), a formula for how many dots a
 * line shows at once and one for the area of a dot. Every key is optional. Part 3b will make a run hold a list of these; keep it a value of its own.
 */
export type Source = { color?: string; dot?: SourceFormula; size?: SourceFormula }
/**
 * What a run is measured over: the load put on the system (the default), or time. A time run's levels are points in time and its `events`
 * (a shape stopped, a restart begun) change shapes' states along the way. The number a level stands at is `load` in both, whatever the axis.
 */
export type Axis = 'load' | 'time'
export const AXES: readonly Axis[] = ['load', 'time']
/** Something that happens at a time in a time run: a shape goes into a state. `text` is empty when the run doesn't say; eventText then words it. */
export type RunEvent = { at: number; on: string; state: StateName; text: string }
/**
 * One of the sources of a run that was tested with several at once: a name, the unit of its load, the shape its requests enter at, and how to draw them
 * (the colour and the two formulas of a single run's `source:`, kept as a Source).
 */
export type SourceInfo = { name: string; entry?: string; unit: string; source?: Source }
/**
 * `axis` and `events` are left out of a run that has none, so a load run is exactly what it was before time runs existed (a time run says its axis;
 * its events are there when it has any). Read them through isTime and eventsOf. A run that has several sources of requests is one of two kinds, and a
 * single run has neither key: `adds` (the ids of the runs it adds, and no levels of its own) or `sources` (tested together: its levels form a grid, one load for
 * each source). Read what such a run means through dialsOf, never from these keys.
 */
export type Run = {
  name: string; about?: string; unit: string; entry?: string; source?: Source; axis?: Axis; events?: RunEvent[]
  adds?: string[]; sources?: Record<string, SourceInfo>; levels: Level[]
  /** The run it compares with (see compare.ts). Left out when the file has no readable `compare`. */
  compare?: CompareTag
}

/** Whether the run is measured over time. */
export const isTime = (run: Run): boolean => run.axis === 'time'
const NO_EVENTS: readonly RunEvent[] = []
/** A run's events in time order (later in the file last among those at one time); none for a load run. */
export const eventsOf = (run: Run): readonly RunEvent[] => run.events ?? NO_EVENTS

/**
 * A dial: one thing the load can be turned up on. A run with one source has one (its `id` is ''); a run that adds others has one for each run it adds (the id of that run); a run
 * tested together has one for each of its sources. `values` are the loads that were tested, going up; `color` is the colour its dots are drawn in, from its source or else from
 * the palette. `idle` is on a dial that can go below its first tested load, down to no load at all (see idleOf): its positions then start at -1, where the load is 0.
 */
export type Dial = { id: string; name: string; unit: string; values: number[]; source?: Source; color: string; idle?: true }
/** Which kind of run it is: one source, several added from separate runs, or several tested together. */
export type Mode = 'single' | 'added' | 'tested'

/**
 * Where a run first struggles: a tested level, and either the object that is worst there or, with none to blame, the latency. A run with several sources has no single
 * load: its knee is a step of the sources rising together (`index`, from 0; see kneeOf) and `setting` says where each source stood (`load` is 0, unused).
 */
export type Knee =
  | { index: number; load: number; setting?: Setting; by: { id: string; kind: 'util' | 'errors'; share: number } }
  | { index: number; load: number; setting?: Setting; latency: { from: number; to: number } }

export type BoxTraffic = { strain?: number; queue: number }
/**
 * How a line looks: how thick, how many particles a second, how long one takes to cross (ms), and the share of them that fail.
 * What a run's source adds is left out when it adds nothing, so a run without one is described as it always was: `color` (as written),
 * `radius` (times the usual dot's radius), `capped` (the count was scaled down to fit the screen), `failure` (how the failing share fails)
 * and `dots` (how many are on the line at once, once the `dot` formula has decided and the cap has had its say). A line that several sources share has an entry
 * for each of them: `source` is the dial it is for, and `offset` how far from the middle of the line (in steps of a dot's width, either side) its dots run, so that
 * two sources on one path don't hide each other. A run with one source has neither. `bare` is on a line the run gives nothing to count: it is drawn as plain stripes moving
 * along it, as busy (`stripes`, 0 to 1) as the run is loaded, and has no dots.
 */
export type LineTraffic = {
  from: string; to: string; width: number; perSecond: number; travelMs: number; failed: number
  color?: string; radius?: number; capped?: true; failure?: Failure; dots?: number; source?: string; offset?: number; stripes?: number; bare?: true
}
export type Traffic = { boxes: Record<string, BoxTraffic>; lines: LineTraffic[] }
