import { dependents, describeDependent, lineIndices, needsDecision } from '../../src/core/dependents.ts'
import type { Dependent, Target } from '../../src/core/dependents.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { loadState } from '../../src/node/files.ts'
import { fixtureDirs } from './dump.ts'
import { FAILURES_DIRS } from './failures.ts'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** A row with every field there, so the C# twin can compare field for field. */
const flat = (r: Dependent) => ({
  key: r.key, kind: r.kind, of: r.of, flow: r.flow, step: r.step, ends: r.ends, analysis: r.analysis, mode: r.mode, part: r.part,
  child: r.child, line: r.line ? { from: r.line.from, to: r.line.to, label: r.line.label } : undefined, actions: r.actions, emptiesFlow: r.emptiesFlow === true, needsDecision: needsDecision(r),
  described: describeDependent(r),
})

const targetsOf = (t: Target) => ('object' in t ? { object: t.object } : { line: { from: t.line.from, to: t.line.to, label: t.line.label, all: t.line.all === true } })

/**
 * What the native reader (desktop/Flowy.Core/Dependents.cs) must also say about what depends on a shape or a line: the rows for each shape and each line of
 * some folders, and for sets of targets that go together, with the connections a line target takes out.
 */
async function dumpDir(dir: string): Promise<unknown> {
  const state = await loadState(dir)
  if (!('model' in state)) throw new Error(`${dir} did not load`)
  const model: Model = modelOf(state)
  const rows = (targets: Target[]) => ({ targets: targets.map(targetsOf), rows: dependents(model, targets).map(flat) })
  const ids = Object.keys(model.objects)
  const together: Target[][] = ids.length >= 3 ? [[{ object: ids[0] }, { object: ids[1] }], ids.slice(0, 3).map(object => ({ object })), [{ object: ids[1] }, ...(model.connections[0] ? [{ line: { from: model.connections[0].from, to: model.connections[0].to } }] : [])]] : []
  const lines = model.connections.flatMap(c => [{ line: { from: c.from, to: c.to, label: c.label ?? '' } }, { line: { from: c.from, to: c.to } }, { line: { from: c.from, to: c.to, all: true } }])
  return {
    objects: ids.map(id => rows([{ object: id }])),
    lines: lines.map(t => ({ ...rows([t]), indices: lineIndices(model, t.line) })),
    together: together.map(rows),
  }
}

export async function dumpDependents(): Promise<unknown> {
  const dirs = { ...fixtureDirs(), 'delete-case': join(root, 'desktop/fixtures/cases/delete/flowy'), ...FAILURES_DIRS }
  const wanted = ['shop', 'plum', 'delete-case', 'states']
  const out: Record<string, unknown> = {}
  for (const name of wanted) if (dirs[name as keyof typeof dirs]) out[name] = await dumpDir(dirs[name as keyof typeof dirs])
  return out
}
