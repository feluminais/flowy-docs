import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../../src/core/check.ts'
import { play } from './play.ts'
import { fixtures, ONLY_FIXTURE, ONLY_SEED, report, seedsOf, signature } from './shared.ts'

/**
 * Scenario simulation of the edit ops: a seeded random user makes many edits to a model, and a judge checks every result against what must always hold
 * (see judge.ts). A line that goes wrong is a finding with the seed to replay it:
 *
 *   FLOWY_SCENARIO_SEED=17 FLOWY_SCENARIO_FIXTURE=Plum node --test test/scenarios/ops.test.ts   (prints the whole trace of that scenario)
 *   FLOWY_SCENARIOS=500 FLOWY_SCENARIO_STEPS=60 node --test test/scenarios/ops.test.ts           (a longer run)
 *
 * The seeds are fixed, so a run gives the same result every time; a change that breaks an invariant fails here, not at random.
 * mcp.test.ts does the same through the MCP tools.
 */
const SCENARIOS = Number(process.env.FLOWY_SCENARIOS ?? 20)
const STEPS = Number(process.env.FLOWY_SCENARIO_STEPS ?? 25)

/**
 * Violations that are real and known, by "rule:op". Each line is a bug somebody is to fix; when it is fixed the test fails until its line is
 * taken out, so this list can only get shorter.
 */
const KNOWN_GAPS: Record<string, string> = {}

const seeds = seedsOf(SCENARIOS)
const played = fixtures.map(fixture => ({ fixture, runs: seeds.map(seed => play(fixture, seed, STEPS)) }))

for (const { fixture } of played) {
  test(`${fixture.name} starts with no problems, or the scenarios would blame the ops for them`, () => {
    assert.deepEqual(check(fixture.model), [])
  })
}

for (const { fixture, runs } of played) {
  test(`${fixture.name}: ${seeds.length} scenarios of ${STEPS} edits break no rule`, () => {
    const unexpected = runs.flatMap(r => r.findings).filter(f => !Object.hasOwn(KNOWN_GAPS, signature(f)))
    assert.equal(unexpected.length, 0, `\n${report(unexpected, 'ops.test.ts')}\n`)
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
