import type { Problem } from '../problem.ts'
import { getObject } from '../model.ts'
import type { Model } from '../model.ts'
import { eventsOf } from './types.ts'
import type { Run } from './types.ts'
import { brief } from './util.ts'
import { sharedColors, whyNotAdded } from './sources.ts'

/** Checking a run against the other runs and against the model. */

/**
 * What a run says about other runs, which one run alone can't see: each run an adder lists must be a load run of its own (not missing, not a run over time, not another
 * adder, not tested with several sources), and two of them may not draw in one colour. An adder with fewer than two runs it can add can't be played: the loader leaves it out
 * (see dialsOf). Each problem names the run it is about.
 */
export function checkRuns(runs: Record<string, Run>): Problem[] {
  const problems: Problem[] = []
  for (const [id, run] of Object.entries(runs)) {
    if (run.adds === undefined) continue
    const add = (message: string) => problems.push({ file: `perf/${id}.yaml`, message })
    const good: string[] = []
    for (const part of run.adds) {
      const why = whyNotAdded(runs, part)
      if (why === undefined) good.push(part)
      else add(`adds "${brief(part)}", ${why}`)
    }
    if (good.length < 2) add("can't be played: fewer than two of the runs it adds can be added")
    else sharedColors(good.map(part => runs[part].source?.color), good.map(part => runs[part].name), add)
  }
  return problems
}

/**
 * What a run says that the model doesn't back up: an `entry` or an object that isn't there, a connection that
 * isn't one of the model's. Each is reported once, however many levels repeat it. The numbers can't quietly
 * point at things that are gone, the rule `code` paths already follow.
 */
export function checkRun(id: string, run: Run, model: Model): Problem[] {
  const file = `perf/${id}.yaml`
  const problems: Problem[] = []
  const said = new Set<string>()
  const once = (message: string) => {
    if (said.has(message)) return
    said.add(message)
    problems.push({ file, message })
  }
  if (run.entry !== undefined && !getObject(model, run.entry)) once(`entry "${run.entry}" is not an object`)
  for (const [sid, info] of Object.entries(run.sources ?? {})) if (info.entry !== undefined && !getObject(model, info.entry)) once(`source ${sid}: entry "${info.entry}" is not an object`)
  for (const level of run.levels) {
    for (const oid of Object.keys(level.objects)) if (!getObject(model, oid)) once(`unknown object "${oid}"`)
    for (const { from, to } of level.connections) {
      const unknown = [from, to].filter(end => !getObject(model, end))
      for (const end of unknown) once(`unknown object "${end}"`)
      if (unknown.length === 0 && !model.connections.some(c => c.from === from && c.to === to)) once(`${from} → ${to} is not a connection in the model`)
    }
  }
  // A shape deleted after the run was written shows up here at the next load, never as a crash: runs are outside the edit pipeline.
  for (const e of eventsOf(run)) if (!getObject(model, e.on)) once(`unknown object "${e.on}"`)
  return problems
}
