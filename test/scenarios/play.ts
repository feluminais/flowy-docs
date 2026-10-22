import { isDeepStrictEqual } from 'node:util'
import { OpError, refuseNewProblems } from '../../src/core/ops.ts'
import type { Model } from '../../src/core/model.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { judgeAccepted } from './judge.ts'
import type { Violation } from './judge.ts'
import { MAKERS } from './moves.ts'
import type { Maker } from './moves.ts'
import { Rng } from './rng.ts'

export type Fixture = { name: string; model: Model; runs: Record<string, Run> }

/** A violation with where it happened: the seed to play again, and every move up to and including the one that broke. */
export type Finding = Violation & { fixture: string; seed: number; step: number; trace: string[] }

export type Played = { findings: Finding[]; accepted: Record<string, number>; refused: Record<string, number> }

const first = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 120)

/**
 * One scenario: a user who makes `steps` edits to a copy of the fixture, each as the app would take it (the op, then the refusal of an edit that
 * adds problems that MCP and the canvas both make), with the judge looking at every result. An edit that is refused changes nothing, as in the app.
 * `makers` is the edits to pick from; only the test of the judge itself passes its own.
 */
export function play(fixture: Fixture, seed: number, steps: number, makers: Record<string, Maker> = MAKERS): Played {
  const rng = new Rng(seed)
  const names = Object.keys(makers)
  const played: Played = { findings: [], accepted: {}, refused: {} }
  const trace: string[] = []
  let model = structuredClone(fixture.model)

  steps: for (let step = 1; step <= steps; step++) {
    const move = makers[rng.pick(names)](model, rng)
    if (!move) continue
    const found = (v: Violation) => played.findings.push({ ...v, fixture: fixture.name, seed, step, trace: [...trace] })
    const given = structuredClone(model)
    let after: Model
    try {
      after = move.run(model)
      refuseNewProblems(model, after)
    } catch (e) {
      const mutated = !isDeepStrictEqual(model, given)
      if (e instanceof OpError) {
        trace.push(`${step}. ${move.label}  -> refused: ${first(e)}`)
        played.refused[move.op] = (played.refused[move.op] ?? 0) + 1
        if (e.message.trim() === '') found({ rule: 'empty-refusal', op: move.op, detail: move.label })
      } else {
        trace.push(`${step}. ${move.label}  -> THREW ${first(e)}`)
        found({ rule: 'crash', op: move.op, detail: first(e) })
      }
      if (mutated) found({ rule: 'mutated-input', op: move.op, detail: 'the model it was given changed' })
      model = given
      continue steps
    }
    trace.push(`${step}. ${move.label}  -> ok`)
    played.accepted[move.op] = (played.accepted[move.op] ?? 0) + 1
    if (!isDeepStrictEqual(model, given)) found({ rule: 'mutated-input', op: move.op, detail: 'the model it was given changed' })
    for (const v of judgeAccepted(model, after, move, fixture.runs)) found(v)
    model = after
  }
  return played
}
