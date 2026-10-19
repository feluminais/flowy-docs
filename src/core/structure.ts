/**
 * How the steps of a flow relate. A flow is a flat list of steps; a stretch of neighbouring steps may be a group
 * (`groups:` in the flow file, `group:` on each step in it): a `repeat` of the same steps, a `branch` of which one
 * lane happens, or `parallel` lanes that all happen at once. A step may also say `flow:`, the flow its story continues in.
 * This file turns that into what a player steps through (runs and stops) and what the checker says about it.
 * Nothing here draws, and nothing needs a browser. desktop/Flowy.Core/Structure.cs is a port, and
 * desktop/fixtures/structure.ts keeps the two equal.
 */
import { isMap } from './model.ts'
import type { Flow } from './model.ts'

export const GROUP_KINDS = ['repeat', 'branch', 'parallel'] as const
export type GroupKind = (typeof GROUP_KINDS)[number]
export const isGroupKind = (v: unknown): v is GroupKind => GROUP_KINDS.some(k => k === v)

/** Whether a value says nothing: not text, or only whitespace. A blank group, lane, flow or option is the same as none. */
export const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === ''

/** A step's group id, trimmed; "" when it has none. */
export const stepGroup = (flow: Flow, i: number): string => {
  const g = flow.steps[i].group
  return typeof g === 'string' ? g.trim() : ''
}

/** The kind of a declared group, or undefined when `id` is blank, not declared (a name Object has is not declared) or of no known kind. */
function kindOf(flow: Flow, id: string): GroupKind | undefined {
  const groups = flow.groups
  if (id === '' || !isMap(groups) || !Object.hasOwn(groups, id)) return undefined
  const g = groups[id]
  return isMap(g) && isGroupKind(g.kind) ? g.kind : undefined
}

/**
 * A stretch of neighbouring steps in one declared group: file step numbers from `start` to `end` (inclusive). For a branch or
 * parallel group, `lanes` splits it: a lane starts at a step that has a `lane` and runs to the next one, and steps before the
 * first `lane` form a first lane with the label "" (the checker reports that). A repeat has no lanes.
 */
export type Run = { group: string; kind: GroupKind; start: number; end: number; lanes: { label: string; steps: number[] }[] }

/** Every run of a flow, in order. A step in no group, or in one that is not declared or has no known kind, is in no run. A group split by another step is two runs. */
export function runsOf(flow: Flow): Run[] {
  const runs: Run[] = []
  const n = flow.steps.length
  for (let i = 0; i < n;) {
    const id = stepGroup(flow, i)
    const kind = kindOf(flow, id)
    if (kind === undefined) {
      i++
      continue
    }
    let end = i
    while (end + 1 < n && stepGroup(flow, end + 1) === id) end++
    const lanes: Run['lanes'] = []
    if (kind !== 'repeat') {
      for (let j = i; j <= end; j++) {
        const label = flow.steps[j].lane
        if (!blank(label)) lanes.push({ label: (label as string).trim(), steps: [j] })
        else if (lanes.length === 0) lanes.push({ label: '', steps: [j] })
        else lanes[lanes.length - 1].steps.push(j)
      }
    }
    runs.push({ group: id, kind, start: i, end, lanes })
    i = end + 1
  }
  return runs
}

/**
 * What a reader sees at once. `steps` are file step numbers: one, except in a parallel group, where stop k is the k-th step of every
 * lane (a lane that has run out drops out). `group` and `kind` are set for a stop in a run; a branch or parallel stop also has
 * `laneLabels` (every lane of the run) and `lanes` (the lane of each of `steps`, from 0). `before` is the steps of the stop that came
 * before: the stop before it, except that the first stop of a run, and the first stop of each lane of a branch, follow the last stop
 * before the run, since a lane does not follow the lane beside it. A callback "triggered outside" asks whether any of those landed on its `from`.
 */
export type Stop = { steps: number[]; group?: string; kind?: GroupKind; laneLabels?: string[]; lanes?: number[]; before: number[] }

/** The stops of a flow, in the order a player visits them. Total: a flow with problems still has stops, and every step is in exactly one. */
export function stopsOf(flow: Flow): Stop[] {
  const stops: Stop[] = []
  const prior = (): number[] => (stops.length === 0 ? [] : [...stops[stops.length - 1].steps])
  const runs = runsOf(flow)
  let r = 0
  for (let i = 0; i < flow.steps.length;) {
    const run = runs[r]
    if (run === undefined || i < run.start) {
      stops.push({ steps: [i], before: prior() })
      i++
      continue
    }
    const entry = prior()
    const labels = run.lanes.map(l => l.label)
    const base = { group: run.group, kind: run.kind }
    if (run.kind === 'repeat') {
      for (let j = run.start; j <= run.end; j++) stops.push({ steps: [j], ...base, before: prior() })
    } else if (run.kind === 'branch') {
      run.lanes.forEach((lane, k) => lane.steps.forEach((j, m) => stops.push({ steps: [j], ...base, laneLabels: labels, lanes: [k], before: m === 0 ? [...entry] : prior() })))
    } else {
      const longest = Math.max(...run.lanes.map(l => l.steps.length))
      for (let k = 0; k < longest; k++) {
        const live = run.lanes.flatMap((lane, li) => (k < lane.steps.length ? [{ step: lane.steps[k], lane: li }] : []))
        stops.push({ steps: live.map(x => x.step), ...base, laneLabels: labels, lanes: live.map(x => x.lane), before: k === 0 ? [...entry] : prior() })
      }
    }
    i = run.end + 1
    r++
  }
  return stops
}
