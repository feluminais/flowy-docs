/**
 * What depends on a shape or a line that is about to go: the flow steps and flow views that name a shape, the failure modes that sit on it, the
 * shapes inside it, and the leftovers that can simply go with it (its own lines, state entries, `affects` entries). Rows are plain data so the
 * browser, the desktop app and MCP all show the same thing; ops.ts's deleteWith applies the choice made for each row. The C# twin is
 * desktop/Flowy.Core/Dependents.cs and must stay word for word the same.
 */
import type { Mode, Model } from './model.ts'
import { isMap } from './text.ts'
import { memberIds } from './views.ts'

/** What is being deleted: a shape, or a line. A line with no `label` is any from → to line, and with `all` every one that matches goes, else the first. */
export type Target = { object: string } | { line: { from: string; to: string; label?: string; all?: boolean } }

/** The ways a row can be settled. Rows that go with the shape have none. */
export type Action = 'removeStep' | 'reroute' | 'deleteFlow' | 'changeView' | 'removeMode' | 'repoint' | 'changeScope' | 'moveOut' | 'deleteWith'

export type Dependent = {
  /** Where the row is, so it stays the same when the rows are worked out again: "step:checkout:3", "mode:ordering:late:on". */
  key: string
  /** The first five need a decision. The rest go with the shape. */
  kind: 'step' | 'view' | 'mode' | 'scope' | 'child' | 'line' | 'start' | 'stepState' | 'affects'
  /** The target it hangs on: a shape id, or "from>to" for a line. */
  of: string
  /** Step, view, start and stepState rows: the flow. `step` counts from 1; `ends` says which ends of the step name the target. */
  flow?: string
  step?: number
  ends?: ('from' | 'to')[]
  /** Mode, scope and affects rows: the analysis and mode. `part` is where the mode names the target. */
  analysis?: string
  mode?: string
  part?: 'on' | 'from' | 'to' | 'line'
  /** A child row: the shape inside the target. */
  child?: string
  /** A line row: the line that goes. */
  line?: { from: string; to: string; label?: string }
  /** The ways to settle it, the one to take by default first. Empty: it goes with the shape. */
  actions: Action[]
  /** A step row: every step of its flow is a row, so removing them all would leave no flow. */
  emptiesFlow?: boolean
}

/** How a row needs deciding: it has actions to choose from. */
export const needsDecision = (row: Dependent): boolean => row.actions.length > 0

const ACTIONS = {
  step: ['removeStep', 'reroute', 'deleteFlow'],
  view: ['changeView', 'deleteFlow'],
  mode: ['removeMode', 'repoint'],
  scope: ['changeScope'],
  child: ['deleteWith', 'moveOut'],
} as const satisfies Record<string, readonly Action[]>

const names = (states: unknown, ids: ReadonlySet<string>): boolean => isMap(states) && Object.keys(states).some(id => ids.has(id))

const labelOf = (c: { label?: string }): string => c.label ?? ''

/** The indices of the connections a line target takes out: the first match, or every match with `all`. */
export function lineIndices(model: Model, line: { from: string; to: string; label?: string; all?: boolean }): number[] {
  const hits = model.connections.flatMap((c, i) => (c.from === line.from && c.to === line.to && (line.label === undefined || labelOf(c) === line.label) ? [i] : []))
  return line.all ? hits : hits.slice(0, 1)
}

/** The rows for deleting these targets, worked out together so that targets which depend on each other don't count against each other. */
export function dependents(model: Model, targets: Target[]): Dependent[] {
  const objects = new Set(targets.flatMap(t => ('object' in t ? [t.object] : [])))
  const cut = new Set<number>(targets.flatMap(t => ('line' in t ? lineIndices(model, t.line) : [])))
  const incident = (i: number) => objects.has(model.connections[i].from) || objects.has(model.connections[i].to)
  const rows: Dependent[] = []
  const hit = (id: unknown): id is string => typeof id === 'string' && objects.has(id)

  for (const [fid, flow] of Object.entries(model.flows)) {
    if (hit(flow.view)) rows.push({ key: `view:${fid}`, kind: 'view', of: flow.view, flow: fid, actions: [...ACTIONS.view] })
    const stepRows: Dependent[] = []
    flow.steps.forEach((s, i) => {
      const ends = (['from', 'to'] as const).filter(end => hit(s[end]))
      const at = { flow: fid, step: i + 1 }
      if (ends.length > 0) stepRows.push({ key: `step:${fid}:${i + 1}`, kind: 'step', of: s[ends[0]] as string, ...at, ends, actions: [...ACTIONS.step] })
      else if (names(s.states, objects)) rows.push({ key: `stepState:${fid}:${i + 1}`, kind: 'stepState', of: Object.keys(s.states as object).find(id => objects.has(id))!, ...at, actions: [] })
    })
    const empties = stepRows.length > 0 && stepRows.length === flow.steps.length
    for (const r of stepRows) rows.push(empties ? { ...r, actions: ['deleteFlow', 'reroute', 'removeStep'], emptiesFlow: true } : r)
    if (names(flow.states, objects)) rows.push({ key: `start:${fid}`, kind: 'start', of: Object.keys(flow.states as object).find(id => objects.has(id))!, flow: fid, actions: [] })
  }

  // A line goes when it is cut, or when a shape it joins goes. A mode on a line is left with nothing only when no from → to line is left.
  const remaining = model.connections.filter((_, i) => !cut.has(i) && !incident(i))
  for (const [aid, a] of Object.entries(model.failures)) {
    if (hit(a.scope)) rows.push({ key: `scope:${aid}`, kind: 'scope', of: a.scope, analysis: aid, actions: [...ACTIONS.scope] })
    for (const [mid, m] of Object.entries(a.modes)) {
      const parts = (['on', 'from', 'to'] as const).filter(p => hit(m[p]))
      for (const part of parts) rows.push({ key: `mode:${aid}:${mid}:${part}`, kind: 'mode', of: m[part] as string, analysis: aid, mode: mid, part, actions: [...ACTIONS.mode] })
      if (parts.length === 0) {
        for (const t of targets) {
          if (!('line' in t) || m.from !== t.line.from || m.to !== t.line.to) continue
          if (remaining.some(c => c.from === m.from && c.to === m.to)) continue
          rows.push({ key: `mode:${aid}:${mid}:line`, kind: 'mode', of: `${t.line.from}>${t.line.to}`, analysis: aid, mode: mid, part: 'line', actions: ['removeMode'] })
          break
        }
      }
    }
  }

  for (const id of objects) for (const child of memberIds(model, id)) if (!objects.has(child)) rows.push({ key: `child:${child}`, kind: 'child', of: id, child, actions: [...ACTIONS.child] })

  model.connections.forEach((c, i) => {
    if (!incident(i) || cut.has(i)) return
    const line = { from: c.from, to: c.to, ...(c.label === undefined ? {} : { label: c.label }) }
    rows.push({ key: `line:${i}`, kind: 'line', of: objects.has(c.from) ? c.from : c.to, line, actions: [] })
  })
  for (const [aid, a] of Object.entries(model.failures))
    for (const [mid, m] of Object.entries(a.modes)) {
      const id = affectsOf(m).find(x => objects.has(x))
      if (id !== undefined) rows.push({ key: `affects:${aid}:${mid}`, kind: 'affects', of: id, analysis: aid, mode: mid, actions: [] })
    }
  // What needs a decision first, then what goes along; each in the order they were found.
  return [...rows.filter(needsDecision), ...rows.filter(r => !needsDecision(r))]
}

const affectsOf = (m: Mode): string[] => (Array.isArray(m.affects) ? m.affects.filter((x): x is string => typeof x === 'string') : [])

/** A row in a few words for a refusal, in the words of the flow or analysis it sits in: "flow checkout, step 3". */
export function describeDependent(row: Dependent): string {
  switch (row.kind) {
    case 'step': case 'stepState': return `flow ${row.flow}, step ${row.step}`
    case 'view': return `the view of flow ${row.flow}`
    case 'start': return `where flow ${row.flow} starts`
    case 'mode': case 'affects': return `mode ${row.mode} of ${row.analysis}`
    case 'scope': return `the scope of ${row.analysis}`
    case 'child': return `${row.child} inside it`
    case 'line': return `the line ${row.line!.from} → ${row.line!.to}`
  }
}
