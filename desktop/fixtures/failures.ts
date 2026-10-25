import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analysedText, analysesText, analysisProblems, analysisText, badgeName, BAND_RULES, bandLabel, bandOf, bandReason, carried, coverage, coverageText, drawnIn, homeView, inView, lightFor, partName, rank, ratingOf, ratingsAfter, ratingsOf,
  reach, riskOf, riskProduct, rollUp, rowName, runLinkProblems, usersOfConnection, usersOfObject,
} from '../../src/core/failures.ts'
import { ROOT } from '../../src/core/model.ts'
import { locate } from '../../ui/src/edit.ts'
import { activeAnalysis, afterText, bandCounts, firstErrorAt, modeCount, modeIn, neighbour, ratingCells, rowsFor, STATUS_NAMES } from '../../ui/src/failuresview.ts'
import { modelOf } from '../../src/core/state.ts'
import { computeView, isView } from '../../src/core/views.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The folders the analyses are read from: a small shop with a mode for each band and each problem, and Plum, the real example. */
export const FAILURES_DIRS = { shop: join(root, 'desktop/fixtures/cases/failures/flowy'), plum: join(root, 'docs/demo/flowy') }

/** Ratings as a file can write them: good ones, and the ones that are not ratings. */
const RATINGS = ['1', '5', '9', '10', '0', '11', '07', '5.5', ' 5', '1e1', '', 'a', '-1', '１']

/**
 * What the native reader (desktop/Flowy.Core/Failures.cs) must also say about each analysis of a folder: every mode's ratings, risk, band and part, the
 * ranking, the coverage, the table in both formats, the problems, and for every view what is marked, what is lit for each mode and what each drawn part carries.
 * The C# tests compare their own answers with this.
 */
async function dumpDir(dir: string): Promise<unknown> {
  const state = await loadState(dir)
  if (!('model' in state)) throw new Error(`${dir} did not load`)
  const model = modelOf(state)
  const runs = state.runs ?? {}
  const views = [ROOT, ...Object.keys(model.objects)].filter(id => isView(model, id))
  return {
    analyses: Object.entries(model.failures).map(([id, a]) => ({
      id,
      modes: Object.entries(a.modes).map(([mid, m]) => ({ id: mid, ratings: ratingsOf(m), after: ratingsAfter(m), risk: riskOf(m) ?? null, band: bandOf(m), bandReason: bandReason(m) ?? null, bandLabel: bandLabel(m), riskProduct: riskProduct(m) ?? null, part: partName(model, m), home: homeView(model, m) })),
      rank: rank(a).map(r => ({ id: r.id, risk: r.risk ?? null, band: r.band })),
      coverage: coverage(model, a),
      coverageText: coverageText(model, a),
      rowNames: rank(a).map(r => ({ id: r.id, name: rowName(model, r) })),
      markdown: analysisText(model, id, a, 'markdown'),
      csv: analysisText(model, id, a, 'csv'),
      problems: analysisProblems(model, id, a),
      runLinks: runLinkProblems(id, a, runs),
      views: views.map(view => {
        const v = computeView(model, view)
        const parts = [...v.members, ...v.outsiders].map(box => ({ box })).concat([]) as ({ box: string } | { line: [string, string] })[]
        for (const e of v.edges) parts.push({ line: [e.from, e.to] })
        return {
          view,
          marks: rollUp(model, a, view),
          inView: Object.entries(a.modes).filter(([, m]) => inView(model, view, m)).map(([mid]) => mid),
          drawnIn: Object.entries(a.modes).filter(([, m]) => drawnIn(model, view, m)).map(([mid]) => mid),
          reach: Object.entries(a.modes).map(([mid, m]) => ({ id: mid, reach: reach(model, view, m), light: lightFor(model, view, m) ?? null })),
          carried: parts.map(part => ({ ...part, ids: carried(model, a, view, part) })),
        }
      }),
    })),
    users: {
      objects: Object.keys(model.objects).map(id => ({ id, analyses: usersOfObject(model, id) })),
      connections: model.connections.map(c => ({ from: c.from, to: c.to, analyses: usersOfConnection(model, c.from, c.to) })),
    },
  }
}

export async function dumpFailures(): Promise<unknown> {
  return {
    ratingOf: RATINGS.map(text => ({ text, rating: ratingOf(text) ?? null })),
    analysesText: [[], ['a'], ['a', 'b'], ['a', 'b', 'c']].map(ids => analysesText(ids)),
    bandRules: BAND_RULES,
    analysedText: [[0, 0], [1, 1], [3, 4], [15, 26]].map(([a, t]) => analysedText(a, t)),
    badgeNames: [badgeName({ band: 'high', count: 1 }), badgeName({ band: 'medium', count: 2 }, 'Ordering to Stripe')],
    shop: await dumpDir(FAILURES_DIRS.shop),
    plum: await dumpDir(FAILURES_DIRS.plum),
  }
}

/** Every pure answer the Failures tab works out before it draws, over the same two folders. */
async function dumpViewDir(dir: string): Promise<unknown> {
  const state = await loadState(dir)
  if (!('model' in state)) throw new Error(`${dir} did not load`)
  const model = modelOf(state)
  const runs = state.runs ?? {}
  const views = [ROOT, ...Object.keys(model.objects)].filter(id => isView(model, id))
  const bands = [undefined, 'high', 'medium', 'low', 'unrated'] as const
  return {
    modeCount: modeCount(model),
    // Where the bar's problem list takes a click on a problem of an analysis: the view, and the analysis and mode to open.
    locate: Object.entries(model.failures).flatMap(([id, a]) => analysisProblems(model, id, a).map(problem => ({ problem, spot: locate(model, problem) }))),
    active: [...Object.keys(model.failures), 'nope', '', 'constructor'].map(id => ({ id, active: activeAnalysis(model.failures, id) ?? null })),
    analyses: Object.entries(model.failures).map(([id, a]) => ({
      id,
      bandCounts: bandCounts(a),
      rows: views.flatMap(view => bands.map(band => {
        const r = rowsFor(model, a, view, { band })
        return { view, band: band ?? null, here: r.here.map(x => x.id), elsewhere: r.elsewhere.map(x => x.id) }
      })),
      partRows: views.flatMap(view => {
        const v = computeView(model, view)
        const parts = [...v.members, ...v.outsiders].map(box => ({ box })) as ({ box: string } | { line: [string, string] })[]
        for (const e of v.edges) parts.push({ line: [e.from, e.to] })
        return parts.map(part => ({ view, ...part, here: rowsFor(model, a, view, { part }).here.map(x => x.id) }))
      }),
      modes: Object.entries(a.modes).map(([mid, m]) => ({
        id: mid,
        after: afterText(m) ?? null,
        known: modeIn(model, id, mid) !== undefined,
        firstError: Object.entries(runs).map(([run, r]) => ({ run, at: firstErrorAt(model, r, m) ?? null })),
      })),
    })),
  }
}

export async function dumpFailuresView(): Promise<unknown> {
  const ids = ['a', 'b', 'c']
  const neighbours: [string[], string | undefined, 1 | -1][] = [
    [ids, undefined, 1], [ids, undefined, -1], [ids, 'a', -1], [ids, 'a', 1], [ids, 'b', 1], [ids, 'b', -1], [ids, 'c', 1], [ids, 'c', -1], [ids, 'x', 1], [[], undefined, 1], [[], 'a', 1],
  ]
  return {
    ratingCells: [undefined, 0, 1, 5, 10].map(rating => ({ rating: rating ?? null, cells: ratingCells(rating) })),
    statusNames: STATUS_NAMES,
    neighbour: neighbours.map(([list, current, delta]) => ({ ids: list, current: current ?? null, delta, id: neighbour(list, current, delta) ?? null })),
    shop: await dumpViewDir(FAILURES_DIRS.shop),
    plum: await dumpViewDir(FAILURES_DIRS.plum),
  }
}
