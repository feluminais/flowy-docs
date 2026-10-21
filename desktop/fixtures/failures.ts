import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  analysesText, analysisProblems, analysisText, bandOf, carried, coverage, coverageText, drawnIn, homeView, inView, lightFor, partName, rank, ratingOf, ratingsAfter, ratingsOf,
  reach, riskOf, rollUp, runLinkProblems, usersOfConnection, usersOfObject,
} from '../../src/core/failures.ts'
import { ROOT } from '../../src/core/model.ts'
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
      modes: Object.entries(a.modes).map(([mid, m]) => ({ id: mid, ratings: ratingsOf(m), after: ratingsAfter(m), risk: riskOf(m) ?? null, band: bandOf(m), part: partName(model, m), home: homeView(model, m) })),
      rank: rank(a).map(r => ({ id: r.id, risk: r.risk ?? null, band: r.band })),
      coverage: coverage(model, a),
      coverageText: coverageText(model, a),
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
    shop: await dumpDir(FAILURES_DIRS.shop),
    plum: await dumpDir(FAILURES_DIRS.plum),
  }
}
