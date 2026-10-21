/**
 * How the steps of a flow relate. A flow is a flat list of steps; a stretch of neighbouring steps may be a group
 * (`groups:` in the flow file, `group:` on each step in it): a `repeat` of the same steps, a `branch` of which one
 * lane happens, or `parallel` lanes that all happen at once. A step may also say `flow:`, the flow its story continues in.
 * This file turns that into what a player steps through (runs and stops) and what the checker says about it.
 * Nothing here draws, and nothing needs a browser. desktop/Flowy.Core/Structure.cs is a port, and
 * desktop/fixtures/structure.ts keeps the two equal.
 */
import { ID_RULE, isValidId } from './model.ts'
import { blank, isMap } from './text.ts'
import type { Flow } from './model.ts'

export const GROUP_KINDS = ['repeat', 'branch', 'parallel'] as const
export type GroupKind = (typeof GROUP_KINDS)[number]
export const isGroupKind = (v: unknown): v is GroupKind => GROUP_KINDS.some(k => k === v)

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

/** Every option a group may hold. Which of them a kind takes is checked below; `in` is kept back for nesting. */
const GROUP_OPTIONS = ['kind', 'text', 'times', 'until'] as const
export const TIMES_MIN = 2
export const TIMES_MAX = 99

/** `times` is digits only, from 2 to 99: files hold text, and put_flow turns a number into text before it is written. */
export const timesOk = (v: unknown): boolean => typeof v === 'string' && /^[0-9]+$/.test(v) && Number(v) >= TIMES_MIN && Number(v) <= TIMES_MAX

/**
 * What is wrong with a flow's groups, lanes and flow links, in this order: each declared group's own problems (in the order the
 * file lists them), then each step's, then each declared group that no step uses (or that has too few lanes). A step's problem has
 * its 0-based `step` and is worded to follow "step N: "; the others stand alone. `hasFlow` says whether a flow id exists.
 */
export function structureProblems(flow: Flow, hasFlow: (id: string) => boolean): { step?: number; message: string }[] {
  const out: { step?: number; message: string }[] = []
  const groups = isMap(flow.groups) ? flow.groups : {}
  const ids = Object.keys(groups)
  const kinds = GROUP_KINDS.join(', ')

  for (const id of ids) {
    const add = (message: string) => out.push({ message: `group "${id}": ${message}` })
    const body = isMap(groups[id]) ? groups[id] : {}
    const kind = body.kind
    if (!isValidId(id)) add(`ids ${ID_RULE}`)
    if (blank(kind)) add(`kind is missing (use ${kinds})`)
    else if (!isGroupKind(kind)) add(`unknown kind "${String(kind)}" (use ${kinds})`)
    const extra = Object.keys(body).find(k => !GROUP_OPTIONS.some(o => o === k))
    if (extra !== undefined) add(`unknown option "${extra}" (use ${GROUP_OPTIONS.join(', ')})`)
    if (!isGroupKind(kind)) continue
    if (kind !== 'repeat') {
      if (!blank(body.times)) add('times only applies to repeat')
      if (!blank(body.until)) add('until only applies to repeat')
    } else {
      if (!blank(body.times) && !timesOk(body.times)) add(`times must be a whole number from ${TIMES_MIN} to ${TIMES_MAX}`)
      if (blank(body.times) && blank(body.until)) add('a repeat needs times or until')
    }
  }

  const members = new Map<string, number[]>()
  flow.steps.forEach((_, i) => {
    const g = stepGroup(flow, i)
    if (g !== '') members.set(g, [...(members.get(g) ?? []), i])
  })
  const laneOf = (i: number): string => (blank(flow.steps[i].lane) ? '' : String(flow.steps[i].lane).trim())

  flow.steps.forEach((s, i) => {
    const at = (message: string) => out.push({ step: i, message })
    const gid = stepGroup(flow, i)
    const declared = gid !== '' && Object.hasOwn(groups, gid)
    const kind = declared ? kindOf(flow, gid) : undefined
    const lane = laneOf(i)
    if (gid !== '' && !declared) at(`group "${gid}" is not declared under groups`)
    if (lane !== '' && gid === '') at('lane needs a group')
    if (declared && kind === 'repeat' && lane !== '') at('lane only applies to branch and parallel')
    if (declared && (kind === 'branch' || kind === 'parallel')) {
      const mine = members.get(gid) ?? []
      if (mine[0] === i && lane === '') at(`the first step of group "${gid}" needs a lane`)
      if (lane !== '' && mine.some(j => j < i && laneOf(j) === lane)) at(`lane "${lane}" is already used in group "${gid}"`)
    }
    for (const id of ids) {
      const m = members.get(id) ?? []
      if (m.length >= 2 && i > m[0] && i < m[m.length - 1] && gid !== id) at(`sits inside the stretch of group "${id}" without belonging to it`)
    }
    if (!blank(s.flow)) {
      const to = String(s.flow).trim()
      if (!hasFlow(to)) at(`unknown flow "${to}"`)
    }
  })

  for (const id of ids) {
    const m = members.get(id) ?? []
    if (m.length === 0) out.push({ message: `group "${id}": no step belongs to it` })
    else if (kindOf(flow, id) === 'parallel' && m.filter(j => laneOf(j) !== '').length < 2) out.push({ message: `group "${id}": a parallel group needs at least two lanes` })
  }
  return out
}

/**
 * The stop that stop `k` follows: the one `stops[k].before` points at, which is the stop whose first step is `before[0]`. Undefined for a first
 * stop (nothing came before), and for a `k` that is not a stop. A stop only ever follows an earlier one, so this is found by looking back from `k`.
 */
export function stopBefore(stops: Stop[], k: number): number | undefined {
  if (!Number.isInteger(k) || k < 0 || k >= stops.length) return undefined
  const first = stops[k].before[0]
  if (first === undefined) return undefined
  for (let i = k - 1; i >= 0; i--) if (stops[i].steps[0] === first) return i
  return undefined
}

/** The stop that holds file step `step`, or the first stop when no stop does (a stale step number never leaves the player nowhere). */
export function stopIndexOf(stops: Stop[], step: number): number {
  const at = stops.findIndex(s => s.steps.includes(step))
  return at === -1 ? 0 : at
}

/**
 * For stop `k` of a branch: the file steps of the lanes it is not in, the ones a player draws faint. The branch is the run of stops around `k`
 * in the same group. Nothing for a stop that is not in a branch.
 */
export function otherLaneSteps(stops: Stop[], k: number): number[] {
  const s = stops[k]
  if (s === undefined || s.kind !== 'branch' || s.group === undefined) return []
  let from = k
  let to = k
  while (from > 0 && stops[from - 1].group === s.group) from--
  while (to + 1 < stops.length && stops[to + 1].group === s.group) to++
  return stops.slice(from, to + 1).filter(t => t.lanes?.[0] !== s.lanes?.[0]).flatMap(t => t.steps)
}
