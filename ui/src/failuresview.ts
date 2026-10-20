import { bandOf, carried, homeView, inView, lineKey, rank, ratingsAfter, ratingsOf, risk } from '../../src/core/failures.ts'
import type { Band, Part, Ranked } from '../../src/core/failures.ts'
import type { Analysis, Mode, Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf.ts'
import { placeEnds, placeStep } from '../../src/core/views.ts'
import { boxSeries, lineSeries } from './perfview.ts'

/**
 * What the Failures tab works out before it draws: which analysis shows, the rows of its list, the cells of a rating, the words for a status,
 * and where along a run a failure first shows. Pure, so the tab only draws.
 */

/** What the list is narrowed to: one band, or the shapes no mode names yet. */
export type Filter = { band?: Band; left?: boolean }

/** The analysis on show: the one asked for if it is there, else the first, else none. */
export const activeAnalysis = (analyses: Record<string, Analysis>, id: string): string | undefined => (Object.hasOwn(analyses, id) ? id : Object.keys(analyses)[0])

/** How many modes the folder holds, all analyses together: the count on the rail. */
export const modeCount = (model: Model): number => Object.values(model.failures).reduce((n, a) => n + Object.keys(a.modes).length, 0)

/**
 * The rows of the list, worst first: those the view holds, then the others. With a `part` (a shape or line picked on the canvas) only what that part
 * carries in this view, all under `here`. A band keeps only that band.
 */
export function rowsFor(model: Model, a: Analysis, view: string, f: { band?: Band; part?: Part }): { here: Ranked[]; elsewhere: Ranked[] } {
  const ranked = rank(a).filter(r => f.band === undefined || r.band === f.band)
  if (f.part) {
    const ids = new Set(carried(model, a, view, f.part))
    return { here: ranked.filter(r => ids.has(r.id)), elsewhere: [] }
  }
  return { here: ranked.filter(r => inView(model, view, r.mode)), elsewhere: ranked.filter(r => !inView(model, view, r.mode)) }
}

export function bandCounts(a: Analysis): Record<Band, number> {
  const counts: Record<Band, number> = { high: 0, medium: 0, low: 0, unrated: 0 }
  for (const m of Object.values(a.modes)) counts[bandOf(m)]++
  return counts
}

/** Ten cells, the first `rating` of them filled. */
export const ratingCells = (rating: number | undefined): boolean[] => Array.from({ length: 10 }, (_, i) => rating !== undefined && i < rating)

/** "150 to 30": the risk now and once the next action is done. Nothing without an `after`, or when either risk can't be worked out. */
export function afterText(m: Mode): string | undefined {
  if (m.after === undefined) return undefined
  const before = risk(ratingsOf(m))
  const after = risk(ratingsAfter(m))
  return before === undefined || after === undefined ? undefined : `${before} to ${after}`
}

/** What a reader sees for each status a file can hold. */
export const STATUS_NAMES: Record<string, string> = { open: 'Open', planned: 'Planned', done: 'Done', accepted: 'Accepted' }

/** The id after or before `current` in a list, staying at the ends; the first when nothing is current. */
export function neighbour(ids: string[], current: string | undefined, delta: 1 | -1): string | undefined {
  if (ids.length === 0) return undefined
  const at = current === undefined ? -1 : ids.indexOf(current)
  return at === -1 ? ids[0] : ids[Math.max(0, Math.min(ids.length - 1, at + delta))]
}

/** The first tested level of a run, from 0, where the mode's part has errors above 0, measured in the view that draws it. Undefined when it never does, or was never measured. */
export function firstErrorAt(model: Model, run: Run, m: Mode): number | undefined {
  const view = homeView(model, m)
  let series: (number | undefined)[] = []
  if (typeof m.on === 'string' && m.on !== '') {
    const box = placeStep(model, view, { from: m.on })?.[0]
    if (box !== undefined) series = boxSeries(model, run, view, box, 'errors')
  } else if (typeof m.from === 'string' && typeof m.to === 'string') {
    const ends = placeEnds(model, view, m.from, m.to)
    if (ends) series = lineSeries(model, run, view, ends[0], ends[1], 'errors')
  }
  const at = series.findIndex(v => v !== undefined && v > 0)
  return at === -1 ? undefined : at
}
