import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { needsDecision } from '../../src/core/dependents.ts'
import type { Target } from '../../src/core/dependents.ts'
import type { Model } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import { loadState } from '../../src/node/files.ts'
import { ACTION_LABELS, alongText, defaultChoice, doneText, planOf, removeAll, rerouteAll, resolutionsOf, rowText, shapesLeft } from '../../ui/src/usedby.ts'
import type { Choices, Plan } from '../../ui/src/usedby.ts'
import { fixtureDirs } from './dump.ts'
import { FAILURES_DIRS } from './failures.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

const objectOf = (t: Target) => ('object' in t ? t.object : undefined)

/** A plan in words and keys, so the C# twin can say the same. */
const summary = (plan: Plan) => ({
  targets: plan.targets.map(t => ('object' in t ? t.object : `${t.line.from}>${t.line.to}`)),
  asks: plan.asks.map(r => r.key), open: plan.open.map(r => r.key), along: plan.along.map(r => r.key), flows: [...plan.flows].sort(),
})

const sorted = (choices: Choices) => Object.entries(choices).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, c]) => ({ key, action: c.action, to: c.to }))

/** What the plan says once these choices are made: the plan, the resolutions deleteWith is told, and the notice. */
function after(model: Model, targets: Target[], choices: Choices) {
  const plan = planOf(model, targets, choices)
  return {
    choices: sorted(choices), plan: summary(plan),
    resolutions: resolutionsOf(plan, choices).map(r => ({ key: r.key, action: r.action, to: r.to })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    done: doneText(model, plan, choices, targets), along: alongText(plan.along),
  }
}

async function dumpDir(dir: string): Promise<unknown> {
  const state = await loadState(dir)
  if (!('model' in state)) throw new Error(`${dir} did not load`)
  const model = modelOf(state)
  const ids = Object.keys(model.objects)
  const sets: Target[][] = [...ids.map(object => [{ object }]), ...(ids.length >= 3 ? [[{ object: ids[0] }, { object: ids[1] }], ids.slice(0, 3).map(object => ({ object }))] : [])]
  const lines: Target[][] = model.connections.map(c => [{ line: { from: c.from, to: c.to, label: c.label ?? '' } }])
  return [...sets, ...lines].map(targets => {
    const plan = planOf(model, targets, {})
    const left = shapesLeft(model, plan)
    const first = plan.asks[0]
    return {
      targets: targets.map(t => ('object' in t ? { object: t.object } : { line: { from: t.line.from, to: t.line.to, label: t.line.label } })),
      none: after(model, targets, {}),
      left,
      rows: plan.rows.filter(needsDecision).map(r => ({ key: r.key, text: rowText(model, r), choice: r.kind === 'step' || r.kind === 'view' || r.kind === 'mode' || r.kind === 'scope' || r.kind === 'child' ? defaultChoice(r) : undefined, labels: r.actions.map(a => ACTION_LABELS[a]) })),
      removeAll: after(model, targets, removeAll(model, targets, {})),
      reroute: left[0] === undefined ? undefined : after(model, targets, rerouteAll(model, targets, {}, left[0])),
      first: first === undefined ? undefined : after(model, targets, { [first.key]: defaultChoice(first) }),
      half: first === undefined ? undefined : after(model, targets, removeAll(model, targets, { [first.key]: first.actions.includes('reroute') && left[0] ? { action: 'reroute', to: left[0] } : defaultChoice(first) })),
      shapes: targets.map(objectOf).filter(Boolean),
    }
  })
}

/** What the native reader (desktop/Flowy.Core/UsedBy.cs) must also say about what is waiting on a delete, once choices are made for the rows. */
export async function dumpUsedBy(): Promise<unknown> {
  const dirs: Record<string, string> = { ...fixtureDirs(), 'delete-case': join(root, 'desktop/fixtures/cases/delete/flowy'), ...FAILURES_DIRS }
  const out: Record<string, unknown> = {}
  for (const name of ['shop', 'delete-case']) out[name] = await dumpDir(dirs[name])
  return out
}
