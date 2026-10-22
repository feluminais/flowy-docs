import { join } from 'node:path'
import { loadDir, loadRuns } from '../../src/node/files.ts'
import { shop, shopWithFailures } from '../fixtures.ts'
import type { Finding, Fixture } from './play.ts'

/** Replay one scenario (`FLOWY_SCENARIO_SEED`, with `FLOWY_SCENARIO_FIXTURE` to name its fixture): its whole trace is printed. */
export const ONLY_SEED = process.env.FLOWY_SCENARIO_SEED === undefined ? undefined : Number(process.env.FLOWY_SCENARIO_SEED)
export const ONLY_FIXTURE = process.env.FLOWY_SCENARIO_FIXTURE

async function folder(name: string, rel: string): Promise<Fixture> {
  const dir = join(import.meta.dirname, '../..', rel)
  const { model } = await loadDir(dir)
  const { runs } = await loadRuns(dir, model)
  return { name, model, runs, dir }
}

/** The models the scenarios start from: two small ones, the demo and Flowy's own. Each must start with no problems. */
export const fixtures: Fixture[] = [
  { name: 'Shop', model: shop(), runs: {} },
  { name: 'Shop with failures', model: shopWithFailures(), runs: {} },
  await folder('Plum', 'docs/demo/flowy'),
  await folder('Flowy', 'flowy'),
].filter(f => ONLY_FIXTURE === undefined || f.name === ONLY_FIXTURE)

export const seedsOf = (count: number): number[] => (ONLY_SEED === undefined ? Array.from({ length: count }, (_, i) => i + 1) : [ONLY_SEED])

/** What a known gap and a report group by: the rule that broke and the op or tool it broke on. */
export const signature = (f: Finding): string => `${f.rule}:${f.op}`

/** One finding for each signature, with how often it happened and how to play it again. */
export function report(findings: Finding[], via: string): string {
  const bySignature = new Map<string, Finding[]>()
  for (const f of findings) bySignature.set(signature(f), [...(bySignature.get(signature(f)) ?? []), f])
  return [...bySignature].map(([sig, all]) => {
    const f = all[0]
    const trace = (ONLY_SEED === undefined ? f.trace.slice(-6) : f.trace).map(t => `      ${t}`).join('\n')
    return `  ${sig} (${all.length}x): ${f.detail}\n    first: FLOWY_SCENARIO_SEED=${f.seed} FLOWY_SCENARIO_FIXTURE="${f.fixture}" (${via}), step ${f.step}, after\n${trace}`
  }).join('\n')
}
