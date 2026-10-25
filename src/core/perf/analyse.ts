import type { States } from '../states.ts'
import { levelAt } from './levels.ts'
import { dialsOf, lockstepPositions, lockstepTop, settingAt } from './dials.ts'
import { eventsOf } from './types.ts'
import type { Knee, Level, Metrics, Run, RunEvent } from './types.ts'

/** What a run shows: its events at a time, how strained a shape is, and where it first struggles. */

/** The events at or before time `x`, in time order. None for a load run, and for a time that is not a number. */
export function eventsPassed(run: Run, x: number): RunEvent[] {
  return eventsOf(run).filter(e => e.at <= x)
}

/**
 * Where each shape a time run has an event for stands at time `x`: the latest event at or before it, and of two at one time the later in the file.
 * Running is an entry like the others, so the shape shows itself and not what is inside it (see marksOf). A shape with no event yet is not in it.
 * Nothing is stored between times, so any time can be asked for in any order.
 */
export function runStates(run: Run, x: number): States {
  const out: States = {}
  for (const e of eventsPassed(run, x)) Object.defineProperty(out, e.on, { value: e.state, enumerable: true, writable: true, configurable: true })
  return out
}

/**
 * How strained an object is, 0 to 1: its utilisation, or its error share counted twenty times (5% failing is as bad as
 * full), whichever is worse. Undefined when neither was measured. `share` is the raw number that decided it.
 */
export function strain(m: Metrics): { value: number; by: 'util' | 'errors'; share: number } | undefined {
  if (m.util === undefined && m.errors === undefined) return undefined
  const util = m.util ?? 0
  const errors = m.errors ?? 0
  const fromErrors = Math.min(1, errors * 20)
  return m.util !== undefined && util >= fromErrors ? { value: util, by: 'util', share: util } : { value: fromErrors, by: 'errors', share: errors }
}

/** A shape this strained is "struggling" (see knee). */
export const KNEE_STRAIN = 0.85
/** The number drawn on a shape once it is this strained ("90%"), as a second copy of the outline colour for those who can't tell the colours apart. Undefined below KNEE_STRAIN: a calm canvas has none. */
export function strainLabel(strain: number | undefined): string | undefined {
  return strain !== undefined && strain >= KNEE_STRAIN ? `${Math.round(strain * 100)}%` : undefined
}

/** Overall p95 this many times the lowest level's counts as latency giving way. */
export const KNEE_LATENCY = 3

/** What gives out at a level: the object that is worst there if it is strained to KNEE_STRAIN, else the latency if the slowest 5% passed KNEE_LATENCY times `base`. */
function struggle(level: Level, base: number | undefined): { by: { id: string; kind: 'util' | 'errors'; share: number } } | { latency: { from: number; to: number } } | undefined {
  let worst: { id: string; kind: 'util' | 'errors'; share: number; value: number } | undefined
  for (const [id, m] of Object.entries(level.objects)) {
    const s = strain(m)
    if (s && (worst === undefined || s.value > worst.value)) worst = { id, kind: s.by, share: s.share, value: s.value }
  }
  if (worst && worst.value >= KNEE_STRAIN) return { by: { id: worst.id, kind: worst.kind, share: worst.share } }
  const p95 = level.overall.p95
  if (base !== undefined && base > 0 && p95 !== undefined && p95 >= KNEE_LATENCY * base) return { latency: { from: base, to: p95 } }
  return undefined
}

/**
 * The first tested level where an object's strain reaches KNEE_STRAIN, naming the worst one there; failing that, the
 * first where overall p95 is KNEE_LATENCY times the lowest level's. Undefined when the run never struggles. It looks
 * at the objects that were measured, not at what holds them: the object to name is the one that was measured.
 */
export function knee(run: Run): Knee | undefined {
  const base = run.levels[0].overall.p95
  for (const [index, level] of run.levels.entries()) {
    const found = struggle(level, base)
    if (found) return { index, load: level.load, ...found }
  }
  return undefined
}

/**
 * Where a run first struggles. One source: knee. Several: every dial rises together from its lowest load to its highest, each along its own loads (see lockstepPositions), and
 * the first step where a shape is strained to KNEE_STRAIN, or failing that the slowest 5% pass KNEE_LATENCY times what they were at the start, is the knee; its `setting` says
 * where each source stood. Undefined when the run never struggles, and for a run that can't be played.
 */
export function kneeOf(runs: Record<string, Run>, id: string): Knee | undefined {
  const found = dialsOf(runs, id)
  if (!found) return undefined
  if (found.mode === 'single') return knee(runs[id])
  const { dials } = found
  let base: number | undefined
  for (let step = 0; step <= lockstepTop(dials); step++) {
    const setting = settingAt(dials, lockstepPositions(dials, step))
    const level = levelAt(runs, id, setting)
    if (step === 0) base = level.overall.p95
    const hit = struggle(level, base)
    if (hit) return { index: step, load: 0, setting, ...hit }
  }
  return undefined
}
