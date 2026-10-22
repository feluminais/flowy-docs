import { test } from 'node:test'
import assert from 'node:assert/strict'
import { playMcp } from './mcp-play.ts'
import type { Finding, Fixture, Played } from './play.ts'
import { fixtures, ONLY_FIXTURE, ONLY_SEED, report, seedsOf, signature } from './shared.ts'

/**
 * Scenario simulation of the MCP server: the same seeded user and the same judge as ops.test.ts, but each edit goes through a tool of a real server
 * on a copy of the fixture's folder, the way an AI sends it (now and then with an argument the wrong way round, now and then several calls at once),
 * and reads and send-backs are mixed in. On top of the judge's rules, a tool must answer like the op for the same edit, refuse in its own words and
 * write nothing when it refuses, never write what adds a problem, and accept what get_model showed when it is sent back as it is.
 *
 *   FLOWY_SCENARIO_SEED=5 FLOWY_SCENARIO_FIXTURE=Plum node --test test/scenarios/mcp.test.ts   (prints the whole trace of that scenario)
 *   FLOWY_MCP_SCENARIOS=100 FLOWY_MCP_STEPS=40 node --test test/scenarios/mcp.test.ts           (a longer run)
 */
const SCENARIOS = Number(process.env.FLOWY_MCP_SCENARIOS ?? 4)
const STEPS = Number(process.env.FLOWY_MCP_STEPS ?? 14)

/**
 * Real and known, by "rule:tool", with the same ratchet as ops.test.ts: when one is fixed this test fails until its line goes. A tool of "*" is any
 * tool, since several calls sent at once are named together and the call that broke the folder is not known.
 */
const KNOWN_GAPS: Record<string, string> = {
  // The same gap as in ops.test.ts, reached through the tools.
  'run-dangling:*': 'delete_object and disconnect leave a run pointing at a shape or a line that is gone',
}

const known = (f: Finding) => Object.hasOwn(KNOWN_GAPS, signature(f)) || Object.hasOwn(KNOWN_GAPS, `${f.rule}:*`)

const seeds = seedsOf(SCENARIOS)
const played: { fixture: Fixture; runs: Played[] }[] = []
for (const fixture of fixtures) {
  const runs: Played[] = []
  for (const seed of seeds) runs.push(await playMcp(fixture, seed, STEPS))
  played.push({ fixture, runs })
}

for (const { fixture, runs } of played) {
  test(`${fixture.name}: ${seeds.length} scenarios of ${STEPS} calls break no rule`, () => {
    const unexpected = runs.flatMap(r => r.findings).filter(f => !known(f))
    assert.equal(unexpected.length, 0, `\n${report(unexpected, 'mcp.test.ts')}\n`)
  })
}

test('every known gap still happens, so the list is only what is still broken', { skip: ONLY_SEED !== undefined || ONLY_FIXTURE !== undefined }, () => {
  const seen = new Set(played.flatMap(p => p.runs.flatMap(r => r.findings)).flatMap(f => [signature(f), `${f.rule}:*`]))
  assert.deepEqual(Object.keys(KNOWN_GAPS).filter(sig => !seen.has(sig)), [], 'these are fixed, so take them out of KNOWN_GAPS')
})

test('the scenarios do something: every tool they call is accepted at least once', { skip: ONLY_SEED !== undefined || ONLY_FIXTURE !== undefined }, () => {
  const runs = played.flatMap(p => p.runs)
  const accepted = new Set(runs.flatMap(r => Object.keys(r.accepted)))
  const tried = new Set([...accepted, ...runs.flatMap(r => Object.keys(r.refused))])
  assert.deepEqual([...tried].filter(op => !accepted.has(op)), [], 'a tool that is never accepted tests nothing past its refusal')
})
