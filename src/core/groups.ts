/**
 * Changing the groups of a flow's steps: who is in a group, which lane a step starts, what a group is when its kind changes. These are
 * the rules about how a group is shaped, with no model and no refusals in them; ops.ts checks the request and wraps the result in a model.
 * Reading a group is structure.ts's groupOf.
 */
import type { Flow, Group, Step } from './model.ts'
import { GROUP_INFO, groupOf, hasLanes, takesOption } from './structure.ts'
import type { GroupKind } from './structure.ts'

/** The name a lane gets until a reader names it: "Lane 1", "Lane 2"… */
export const laneName = (n: number): string => `Lane ${n}`

/** A step's group id, trimmed; "" when it has none (or there is no step). */
export const stepGroupId = (s: Step | undefined): string => (s !== undefined && typeof s.group === 'string' ? s.group.trim() : '')

/** The label of the lane a step starts, trimmed; "" when it starts none (or there is no step). */
export const stepLaneLabel = (s: Step | undefined): string => (s !== undefined && typeof s.lane === 'string' ? s.lane.trim() : '')

/**
 * The flow with these groups: replaced where its `groups:` already is, else put just before the steps, so the file reads name, view, groups,
 * steps. No groups, or none left, takes the section out.
 */
export function withGroups(flow: Flow, groups: Record<string, Group> | undefined): Flow {
  const none = groups === undefined || Object.keys(groups).length === 0
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(flow)) {
    if (key === 'groups') {
      if (!none) out.groups = groups
      continue
    }
    if (key === 'steps' && !none && !('groups' in flow)) out.groups = groups
    out[key] = value
  }
  return out as Flow
}

/**
 * The steps of a flow with step `index` taken out of its group (it stays in the list, without `group` and `lane`), and the groups without
 * any that this left empty. When it started a lane and the next step of the group has none, that step takes the label.
 */
export function leaveGroup(flow: Flow, index: number): { steps: Step[]; groups: Record<string, Group> | undefined } {
  const steps = [...flow.steps]
  const g = stepGroupId(steps[index])
  if (g === '') return { steps, groups: flow.groups }
  const lane = stepLaneLabel(steps[index]) !== '' ? steps[index].lane : undefined
  const next = steps[index + 1]
  if (lane !== undefined && stepGroupId(next) === g && stepLaneLabel(next) === '') steps[index + 1] = { ...next, lane }
  const { group: _g, lane: _l, ...kept } = steps[index]
  steps[index] = kept as Step
  let groups = flow.groups
  if (groups !== undefined && !steps.some(s => stepGroupId(s) === g)) {
    const { [g]: _, ...rest } = groups
    groups = rest
  }
  return { steps, groups }
}

/**
 * The steps with step `index` (already out of any group) put in group `to`, which is of this `kind`. In a group with lanes a step that comes
 * before the others takes over the label of the first lane, which it joins at the front, and in a group with no other step it starts "Lane 1".
 */
export function joinGroup(steps: Step[], index: number, to: string, kind: unknown): Step[] {
  const out = [...steps]
  const { lane: _l, ...joined } = { ...out[index], group: to }
  out[index] = joined as Step
  if (hasLanes(kind)) {
    const first = out.findIndex((s, i) => i !== index && stepGroupId(s) === to)
    if (first === -1) out[index] = { ...out[index], lane: laneName(1) }
    else if (first > index) {
      const has = stepLaneLabel(out[first]) !== ''
      out[index] = { ...out[index], lane: has ? out[first].lane : laneName(1) }
      if (has) {
        const { lane: _o, ...rest } = out[first]
        out[first] = rest as Step
      }
    }
  }
  return out
}

/**
 * Group `group` of the flow as a group of another `kind`: the declaration (a repeat keeps its `times` and `until` and gets `times: "3"` when it has
 * neither, the others drop them) and the steps (members lose their lanes when it becomes a repeat; when it becomes a group with lanes its first step
 * starts "Lane 1" and, for parallel, every other step that starts no lane starts one of its own unless two lanes are there already).
 */
export function changeKind(flow: Flow, group: string, kind: GroupKind): { steps: Step[]; declared: Group } {
  const old = flow.groups![group]
  const { times: _t, until: _u, ...others } = old
  const declared: Group = { ...others, kind }
  for (const option of GROUP_INFO[kind].options) if (old[option] !== undefined) declared[option] = old[option]
  const info = groupOf(flow, group)
  if (takesOption(kind, 'times') && info?.times === undefined && info?.until === undefined) declared.times = '3'
  const steps = [...flow.steps]
  const members = steps.flatMap((s, i) => (stepGroupId(s) === group ? [i] : []))
  if (!hasLanes(kind)) {
    for (const i of members) {
      if (steps[i].lane === undefined) continue
      const { lane: _l, ...kept } = steps[i]
      steps[i] = kept as Step
    }
  } else if (members.length > 0) {
    if (stepLaneLabel(steps[members[0]]) === '') steps[members[0]] = { ...steps[members[0]], lane: laneName(1) }
    // Parallel lanes are at least two: every step that starts no lane starts one of its own, as groupRange does.
    if (kind === 'parallel' && members.filter(i => stepLaneLabel(steps[i]) !== '').length < 2) {
      for (const i of members) {
        if (stepLaneLabel(steps[i]) !== '') continue
        const used = new Set(members.map(j => stepLaneLabel(steps[j])))
        let n = 1
        while (used.has(laneName(n))) n++
        steps[i] = { ...steps[i], lane: laneName(n) }
      }
    }
  }
  return { steps, declared }
}

/** A new group of this kind as it is declared: a repeat says `times: "3"`, the others only their kind. */
export const newGroup = (kind: GroupKind): Group => (takesOption(kind, 'times') ? { kind, times: '3' } : { kind })

/** The steps with steps `first` to `last` (0-based, both included, none in a group yet) put in group `group`. With lanes, every step starts a lane of its own. */
export function groupRange(steps: Step[], group: string, kind: GroupKind, first: number, last: number): Step[] {
  const out = [...steps]
  for (let i = first; i <= last; i++) {
    const { lane: _l, ...kept } = out[i]
    out[i] = hasLanes(kind) ? { ...kept, group, lane: laneName(i - first + 1) } as Step : { ...kept, group } as Step
  }
  return out
}

/** The steps without the group and lane of every step that named group `id`. */
export const dropGroup = (steps: Step[], id: string): Step[] =>
  steps.map(s => {
    if (typeof s.group !== 'string' || s.group.trim() !== id) return s
    const { group: _g, lane: _l, ...kept } = s
    return kept as Step
  })
