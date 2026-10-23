import { idleOf } from './idle.ts'
import type { Dial, Mode, Run, Setting, Source } from './types.ts'
import { put } from './util.ts'
import { sameColor, whyNotAdded } from './sources.ts'

/** Dials: what a run is turned up on, and the maths of positions along them. */

/**
 * The colours a source takes when it names none, in the order the sources are listed. Red is left out: it is the colour of a call that fails. A source that
 * names a colour keeps it, and one that doesn't takes the first of these that no other source draws in (see dialsOf).
 */
export const SOURCE_PALETTE: readonly string[] = ['blue', 'green', 'orange', 'indigo']

/**
 * The colour of each source: the one it names, else the first of the palette that no other source draws in, in the order the sources come. (Two sources that name the same colour are
 * a problem the checks report; they keep it.) A source nobody names a colour for is never red, the colour of a failing call.
 */
function colorsOf(sources: (Source | undefined)[]): string[] {
  const taken: string[] = sources.flatMap(s => (s?.color === undefined ? [] : [s.color]))
  const free = SOURCE_PALETTE.filter(c => !taken.some(t => sameColor(t, c)))
  let next = 0
  return sources.map(s => s?.color ?? free[Math.min(next++, free.length - 1)] ?? SOURCE_PALETTE[0])
}

/**
 * What a run is turned up on. A run with one source is one dial; a run that adds others is one dial for each run it can add (at least two, else the run can't be played and this
 * is undefined); a run tested together is one for each source. Undefined too for an id that isn't a run. The loads of a dial are the tested ones, so a position on it can be
 * any fraction of an index into them.
 */
export function dialsOf(runs: Record<string, Run>, id: string): { mode: Mode; dials: Dial[] } | undefined {
  if (!Object.hasOwn(runs, id)) return undefined
  const run = runs[id]
  const loads = (r: Run): number[] => r.levels.map(l => l.load)
  if (run.adds !== undefined) {
    const parts = run.adds.filter(part => whyNotAdded(runs, part) === undefined)
    if (parts.length < 2) return undefined
    const colors = colorsOf(parts.map(part => runs[part].source))
    return { mode: 'added', dials: parts.map((part, i) => ({ id: part, name: runs[part].name, unit: runs[part].unit, values: loads(runs[part]), ...(runs[part].source ? { source: runs[part].source } : {}), color: colors[i], ...(idleOf(runs[part]) ? { idle: true as const } : {}) })) }
  }
  if (run.sources !== undefined) {
    const ids = Object.keys(run.sources)
    const colors = colorsOf(ids.map(sid => run.sources![sid].source))
    return {
      mode: 'tested',
      dials: ids.map((sid, i) => {
        const info = run.sources![sid]
        const values = [...new Set(run.levels.map(l => l.loads?.[sid] ?? 0))].sort((a, b) => a - b)
        return { id: sid, name: info.name, unit: info.unit, values, ...(info.source ? { source: info.source } : {}), color: colors[i] }
      }),
    }
  }
  return { mode: 'single', dials: [{ id: '', name: run.name, unit: run.unit, values: loads(run), ...(run.source ? { source: run.source } : {}), color: run.source?.color ?? SOURCE_PALETTE[0], ...(idleOf(run) ? { idle: true as const } : {}) }] }
}

/**
 * The load at a position along a dial's tested loads: a tested load exactly at a whole number, a straight line between two in between. A position past the top is the top;
 * one that isn't a number is the lowest. Below the first load a position runs from -1, where there is no load at all, to 0, the first load (only a dial that can be idle has any: see
 * Dial.idle); a position under -1 is -1.
 */
export function loadOfPosition(values: readonly number[], pos: number): number {
  if (pos < 0) return values[0] * (1 + Math.max(-1, pos))
  const top = values.length - 1
  const p = Math.min(top, Math.max(0, Number.isFinite(pos) ? pos : 0))
  const i = Math.min(top - 1, Math.floor(p))
  return values[i] + (values[i + 1] - values[i]) * (p - i)
}

/** The setting that puts every dial at a position along its own loads (one position for each dial, in dial order). */
export function settingAt(dials: readonly Dial[], positions: readonly number[]): Setting {
  const out: Setting = {}
  dials.forEach((d, i) => put(out, d.id, loadOfPosition(d.values, positions[i] ?? 0)))
  return out
}

/**
 * The steps of every dial rising together, from its lowest load to its highest: as many as the dial with the most loads has levels, less one. Step `i` puts a dial with `m`
 * levels at position `i * (m - 1) / N`, so a dial with 3 levels and one with 5 meet at (0, 0), (0.5, 1), (1, 2), (1.5, 3) and (2, 4).
 */
export const lockstepTop = (dials: readonly Dial[]): number => Math.max(...dials.map(d => d.values.length)) - 1
export const lockstepPositions = (dials: readonly Dial[], step: number): number[] => {
  const n = lockstepTop(dials)
  return dials.map(d => (n === 0 ? 0 : (step * (d.values.length - 1)) / n))
}
