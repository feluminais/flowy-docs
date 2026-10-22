import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { check } from '../../src/core/check.ts'
import { loadDir, loadRuns } from '../../src/node/files.ts'
import { shop, shopWithFailures } from '../fixtures.ts'
import { play } from './play.ts'
import type { Finding, Fixture } from './play.ts'

/**
 * Scenario simulation of the edit ops: a seeded random user makes many edits to a model, and a judge checks every result against what must always hold
 * (see judge.ts). A line that goes wrong is a finding with the seed to replay it:
 *
 *   FLOWY_SCENARIO_SEED=17 FLOWY_SCENARIO_FIXTURE=Plum npm test -- test/scenarios/ops.test.ts   (prints the whole trace of that scenario)
 *   FLOWY_SCENARIOS=500 FLOWY_SCENARIO_STEPS=60 npm test -- test/scenarios/ops.test.ts           (a longer run)
 *
 * The seeds are fixed, so a run gives the same result every time; a change that breaks an invariant fails here, not at random.
 */
const SCENARIOS = Number(process.env.FLOWY_SCENARIOS ?? 20)
const STEPS = Number(process.env.FLOWY_SCENARIO_STEPS ?? 25)
const ONLY_SEED = process.env.FLOWY_SCENARIO_SEED === undefined ? undefined : Number(process.env.FLOWY_SCENARIO_SEED)
const ONLY_FIXTURE = process.env.FLOWY_SCENARIO_FIXTURE

/**
 * Violations that are real and known, by "rule:op". Each line is a bug somebody is to fix; when it is fixed the test fails until its line is
 * taken out, so this list can only get shorter.
 */
const KNOWN_GAPS: Record<string, string> = {
  // Both refuse a shape or a line that a flow or a failure analysis uses, and say nothing about a load-test run (perf/*.yaml) that measures it.
  'run-dangling:deleteObject': 'a run still names the deleted shape',
  'run-dangling:deleteObjects': 'a run still names a deleted shape',
  'run-dangling:disconnect': 'a run still measures the removed line',
  'run-dangling:removeConnection': 'a run still measures the removed line',
}

async function folder(name: string, rel: string): Promise<Fixture> {
  const dir = join(import.meta.dirname, '../..', rel)
  const { model } = await loadDir(dir)
  const { runs } = await loadRuns(dir, model)
  return { name, model, runs }
}

const fixtures: Fixture[] = [
  { name: 'Shop', model: shop(), runs: {} },
  { name: 'Shop with failures', model: shopWithFailures(), runs: {} },
  await folder('Plum', 'docs/demo/flowy'),
  await folder('Flowy', 'flowy'),
].filter(f => ONLY_FIXTURE === undefined || f.name === ONLY_FIXTURE)

const seeds = ONLY_SEED === undefined ? Array.from({ length: SCENARIOS }, (_, i) => i + 1) : [ONLY_SEED]
const played = fixtures.map(fixture => ({ fixture, runs: seeds.map(seed => play(fixture, seed, STEPS)) }))

const signature = (f: Finding) => `${f.rule}:${f.op}`

/** One finding for each signature, with how often it happened and the way to play it again. */
function report(findings: Finding[]): string {
  const bySignature = new Map<string, Finding[]>()
  for (const f of findings) bySignature.set(signature(f), [...(bySignature.get(signature(f)) ?? []), f])
  return [...bySignature].map(([sig, all]) => {
    const f = all[0]
    const trace = (ONLY_SEED === undefined ? f.trace.slice(-6) : f.trace).map(t => `      ${t}`).join('\n')
    return `  ${sig} (${all.length}x): ${f.detail}\n    first: FLOWY_SCENARIO_SEED=${f.seed} FLOWY_SCENARIO_FIXTURE="${f.fixture}", step ${f.step}, after\n${trace}`
  }).join('\n')
}

for (const { fixture } of played) {
  test(`${fixture.name} starts with no problems, or the scenarios would blame the ops for them`, () => {
    assert.deepEqual(check(fixture.model), [])
  })
}

for (const { fixture, runs } of played) {
  test(`${fixture.name}: ${seeds.length} scenarios of ${STEPS} edits break no rule`, () => {
    const unexpected = runs.flatMap(r => r.findings).filter(f => !Object.hasOwn(KNOWN_GAPS, signature(f)))
    assert.equal(unexpected.length, 0, `\n${report(unexpected)}\n`)
  })
}

test('every known gap still happens, so the list is only what is still broken', { skip: ONLY_SEED !== undefined || ONLY_FIXTURE !== undefined }, () => {
  const seen = new Set(played.flatMap(p => p.runs.flatMap(r => r.findings)).map(signature))
  const fixed = Object.keys(KNOWN_GAPS).filter(sig => !seen.has(sig))
  assert.deepEqual(fixed, [], 'these are fixed, so take them out of KNOWN_GAPS')
})

test('the scenarios do something: every op they try is accepted at least once', { skip: ONLY_SEED !== undefined || ONLY_FIXTURE !== undefined }, () => {
  const runs = played.flatMap(p => p.runs)
  const accepted = new Set(runs.flatMap(r => Object.keys(r.accepted)))
  const tried = new Set([...accepted, ...runs.flatMap(r => Object.keys(r.refused))])
  assert.deepEqual([...tried].filter(op => !accepted.has(op)), [], 'an op that is never accepted tests nothing past its refusal')
})
