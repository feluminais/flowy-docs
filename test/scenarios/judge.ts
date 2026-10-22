import { newProblems } from '../../src/core/check.ts'
import * as F from '../../src/core/failures.ts'
import { flowToMermaid, viewToMermaid } from '../../src/core/mermaid.ts'
import { ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { outline } from '../../src/core/outline.ts'
import { kneeOf } from '../../src/core/perf/analyse.ts'
import { checkRun } from '../../src/core/perf/check.ts'
import type { Run } from '../../src/core/perf/types.ts'
import type { Problem } from '../../src/core/problem.ts'
import { fileData, parseFile, serializeFile } from '../../src/core/modelfiles.ts'
import { computeView, isView } from '../../src/core/views.ts'
import type { Move } from './moves.ts'

/** What went wrong with one move. The rule plus the op is the signature a report groups by and a known gap is listed under. */
export type Violation = { rule: Rule; op: string; detail: string }

export const RULES = [
  'crash', // an op threw something other than a refusal
  'mutated-input', // an op changed the model it was given
  'empty-refusal', // a refusal that says nothing
  'postcondition', // the op was accepted but did not do what it is for
  'run-dangling', // a load-test run now names a shape or line that is gone
  'mode-run-link', // a failure mode now names a run that is not there
  'reader-crash', // something that reads the model throws on the result
  'unsaveable', // the result can't be written to files and read back
  // MCP only (see mcp-play.ts)
  'tool-crash', // a tool answered with an error that is a bug in the server, not a refusal
  'garbled-answer', // an answer that says undefined or [object Object]
  'wrote-on-error', // a call that was refused and still changed a file
  'read-wrote', // a call that only reads and changed a file
  'read-failed', // a read of something that is there, refused
  'read-wrong', // a read whose answer does not match the folder
  'echo-refused', // what a tool showed, sent back as it is, was refused
  'echo-changed', // what a tool showed, sent back as it is, changed a file
  'new-problem', // a write that was accepted and left the folder with a problem it did not have
  'accepts-refused', // the tool took an edit that the op refuses
  'refuses-accepted', // the tool refused an edit that the op takes, for no reason the tool is meant to have
  'differs-from-op', // the tool and the op were both accepted and left different files
] as const
export type Rule = (typeof RULES)[number]

// A scenario judges each model twice, as the result of one edit and as the start of the next, so the work on it is kept.
const crashCache = new WeakMap<Model, Map<string, string>>()
const runCache = new WeakMap<Model, Problem[]>()
const linkCache = new WeakMap<Model, Problem[]>()
const memo = <T>(cache: WeakMap<Model, T>, model: Model, make: () => T): T => {
  const kept = cache.get(model)
  if (kept !== undefined) return kept
  const made = make()
  cache.set(model, made)
  return made
}

const first = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 120)

/** Every reader of a model that must cope with whatever an accepted edit leaves: it returns the readers that throw, with why. */
function readerCrashes(model: Model, runs: Record<string, Run>): Map<string, string> {
  return memo(crashCache, model, () => readersThatThrow(model, runs))
}

function readersThatThrow(model: Model, runs: Record<string, Run>): Map<string, string> {
  const crashed = new Map<string, string>()
  const read = (name: string, f: () => unknown) => {
    try {
      f()
    } catch (e) {
      crashed.set(name, first(e))
    }
  }
  const views = [ROOT, ...Object.keys(model.objects).filter(id => isView(model, id))]
  for (const v of views) {
    read('computeView', () => computeView(model, v))
    read('viewToMermaid', () => viewToMermaid(model, v))
  }
  for (const id of Object.keys(model.flows)) read('flowToMermaid', () => flowToMermaid(model, id))
  read('outline', () => outline(model, { expanded: new Set(views), editing: true }))
  for (const [aid, a] of Object.entries(model.failures)) {
    read('failures.table', () => F.table(model, a, 'markdown'))
    read('failures.coverageText', () => F.coverageText(model, a))
    for (const v of views) read('failures.rollUp', () => F.rollUp(model, a, v))
    for (const mode of Object.values(a.modes)) for (const v of views) read('failures.reach', () => F.reach(model, v, mode))
    read('failures.rank', () => F.rank(a))
    read('failures.problems', () => F.analysisProblems(model, aid, a))
  }
  for (const id of Object.keys(runs)) read('kneeOf', () => kneeOf(runs, id))
  return crashed
}

const runProblems = (model: Model, runs: Record<string, Run>): Problem[] =>
  memo(runCache, model, () => Object.entries(runs).flatMap(([id, run]) => checkRun(id, run, model)))
const linkProblems = (model: Model, runs: Record<string, Run>): Problem[] =>
  memo(linkCache, model, () => Object.entries(model.failures).flatMap(([aid, a]) => F.runLinkProblems(aid, a, runs)))

/** Whether a file can be written as text and read again, as saving does (see saveProblems in node/files.ts): why not, or undefined. */
function cannotRoundTrip(model: Model, rel: string): string | undefined {
  try {
    parseFile(rel, serializeFile(rel, fileData(model, rel)))
    return undefined
  } catch (e) {
    return first(e)
  }
}

/** The files a move changed (the ones whose data is no longer the same object) that can't be saved again, where they could before. Saving every file after every edit would take most of the run. */
function unsaveable(before: Model, after: Model): Problem[] {
  const changed = [
    ...(before.objects !== after.objects || before.connections !== after.connections || before.meta !== after.meta ? ['model.yaml'] : []),
    ...Object.keys(after.flows).filter(id => before.flows[id] !== after.flows[id]).map(id => `flows/${id}.yaml`),
    ...Object.keys(after.failures).filter(id => before.failures[id] !== after.failures[id]).map(id => `failures/${id}.yaml`),
  ]
  return changed.flatMap(file => {
    const message = cannotRoundTrip(after, file)
    return message === undefined || cannotRoundTrip(before, file) !== undefined ? [] : [{ file, message: `can't be saved again: ${message}` }]
  })
}

/** What is wrong with the model an accepted move left, compared with the one it was given. A problem that was already there is not the move's. */
export function judgeAccepted(before: Model, after: Model, move: Move, runs: Record<string, Run>): Violation[] {
  const out: Violation[] = []
  const add = (rule: Rule, detail: string) => out.push({ rule, op: move.op, detail })
  const why = move.expect?.(before, after)
  if (why !== undefined) add('postcondition', why)
  for (const p of newProblems(runProblems(before, runs), runProblems(after, runs))) add('run-dangling', `${p.file}: ${p.message}`)
  for (const p of newProblems(linkProblems(before, runs), linkProblems(after, runs))) add('mode-run-link', `${p.file}: ${p.message}`)
  const wasCrashing = readerCrashes(before, runs)
  for (const [name, message] of readerCrashes(after, runs)) if (!wasCrashing.has(name)) add('reader-crash', `${name}: ${message}`)
  for (const p of unsaveable(before, after)) add('unsaveable', `${p.file}: ${p.message}`)
  return out
}

