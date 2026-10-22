import { isDeepStrictEqual } from 'node:util'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { check, newProblems } from '../../src/core/check.ts'
import { runLinkProblems } from '../../src/core/failures.ts'
import { modelFiles } from '../../src/core/modelfiles.ts'
import { refuseNewProblems } from '../../src/core/ops.ts'
import { createMcpServer } from '../../src/node/mcp.ts'
import { checkRun } from '../../src/core/perf/check.ts'
import type { Run } from '../../src/core/perf/types.ts'
import { loadDir, loadReport, missingPaths } from '../../src/node/files.ts'
import type { Report } from '../../src/node/files.ts'
import { judgeAccepted } from './judge.ts'
import type { Violation } from './judge.ts'
import { MCP_MAKERS } from './mcp-moves.ts'
import type { Call, McpMaker, McpMove } from './mcp-moves.ts'
import type { Fixture, Played } from './play.ts'
import { Rng } from './rng.ts'

type Answer = { error: boolean; text: string }

const first = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 120)

/** An error that is the server's own bug showing, not a refusal in its words. */
const CRASH = /TypeError|ReferenceError|RangeError|Cannot read propert|is not a function|is not iterable|\(reading '|\[object Object\]|\bat (async )?[\w.<>]+ \(.*:\d+:\d+\)/
/** A refusal the tool is meant to have that the op does not: the schema, a file in perf/, a file it can't read or write back. */
const OWN_REFUSAL = /Input validation|Invalid arguments|perf\/|load-test run|couldn't be read back|can't be read|changed underneath|Nothing saved:/

async function files(dir: string, rel = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await readdir(join(dir, rel), { withFileTypes: true })) {
    const path = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) Object.assign(out, await files(dir, path))
    else out[path] = await readFile(join(dir, path), 'utf8')
  }
  return out
}

/** The fixture as a folder: copied if it came from one, else written from the model. It sits in a folder called flowy, since code paths are read from its parent. */
async function materialise(fixture: Fixture, dir: string): Promise<void> {
  if (fixture.dir !== undefined) return cp(fixture.dir, dir, { recursive: true })
  for (const [rel, text] of Object.entries(modelFiles(fixture.model))) {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
}

const changedFile = (a: Record<string, string>, b: Record<string, string>): string | undefined =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].find(rel => a[rel] !== b[rel])

/** What the op for the same edit would have done to the folder as it was: the files it would leave, or why it refuses. */
function opResult(move: McpMove, before: Report, dir: string): { files: Record<string, string> } | { refused: string } {
  try {
    const next = move.twin!.run(before.model)
    refuseNewProblems(before.model, next, missingPaths(dir, before.model, next), before.runs)
    return { files: modelFiles(next) }
  } catch (e) {
    return { refused: first(e) }
  }
}

/**
 * The folder as loadReport reads it, but with the runs read once: no tool writes a run, and reading and checking the files of perf/ is most of what
 * loading a folder costs. A scenario starts by asking loadReport too, and a difference between the two is a finding.
 */
async function reportOf(dir: string, runs: Record<string, Run>): Promise<Report> {
  const { model, failureProblems } = await loadDir(dir)
  const others = [
    ...check(model, missingPaths(dir, model)), ...failureProblems,
    ...Object.entries(model.failures).flatMap(([aid, a]) => runLinkProblems(aid, a, runs)),
    ...Object.entries(runs).flatMap(([id, run]) => checkRun(id, run, model)),
  ]
  // loadReport also tries to save every file again; here the judge does that for the files a move changed, which is all that can have changed.
  return { model, runs, problems: others }
}

/** Everything wrong with what one move did to the folder. */
function judge(move: McpMove, answers: Answer[], before: Report, after: Report, was: Record<string, string>, now: Record<string, string>, dir: string): Violation[] {
  const out: Violation[] = []
  const add = (rule: Violation['rule'], detail: string) => out.push({ rule, op: move.op, detail })
  const changed = changedFile(was, now)
  for (const a of answers) {
    if (a.error && CRASH.test(a.text)) add('tool-crash', first(a.text))
    if (!a.error && move.kind === 'write' && /\[object Object\]|\bundefined\b|\bNaN\b/.test(a.text)) add('garbled-answer', first(a.text))
  }

  if (move.kind === 'read') {
    if (changed !== undefined) add('read-wrote', changed)
    const [a] = answers
    if (a.error) add('read-failed', first(a.text))
    else {
      if (move.calls[0].tool === 'get_model') try { JSON.parse(a.text) } catch { add('read-wrong', 'get_model did not answer JSON') }
      const why = move.answer?.(a.text, before)
      if (why !== undefined) add('read-wrong', why)
    }
    return out
  }

  if (move.kind === 'echo') {
    if (answers[0].error) add('read-failed', first(answers[0].text))
    else if (answers.length < 2) add('read-wrong', 'what get_model showed could not be sent back')
    else if (answers[1].error) add('echo-refused', first(answers[1].text))
    else {
      // The files may be written in another form (a line of flow style made into a block, line endings), so the models are what is compared.
      const section = (['objects', 'connections', 'flows', 'failures', 'meta'] as const).find(k => !isDeepStrictEqual(before.model[k], after.model[k]))
      if (section !== undefined) add('echo-changed', `${section} changed`)
    }
    return out
  }

  const succeeded = answers.some(a => !a.error)
  if (!succeeded && changed !== undefined) add('wrote-on-error', changed)
  const problems = newProblems(before.problems, after.problems).filter(p => !p.file.startsWith('perf/')) // a run's are the run-dangling rule's
  for (const p of problems) add('new-problem', `${p.file}: ${p.message}`)
  if (!succeeded) {
    if (move.twin && !OWN_REFUSAL.test(answers[0].text)) {
      const twin = opResult(move, before, dir)
      if ('files' in twin) add('refuses-accepted', `${first(answers[0].text)} (the op takes it)`)
    }
    return out
  }
  const edit = { op: move.op, label: move.label, run: (m: Report['model']) => m, expect: move.expect }
  for (const v of judgeAccepted(before.model, after.model, edit, before.runs)) out.push(v)
  if (move.twin && answers.length === 1) {
    const twin = opResult(move, before, dir)
    if ('refused' in twin) add('accepts-refused', twin.refused)
    else {
      const differs = changedFile(modelFiles(after.model), twin.files)
      if (differs !== undefined) add('differs-from-op', differs)
    }
  }
  return out
}

/**
 * One scenario over MCP: the same kind of user as play(), but as an AI sends it, through the tools of a real server on a copy of the fixture's
 * folder. Each move is judged on the folder as loaded from disk afterwards, so the tools' own load, check and save are in what is judged.
 * `makers` and `plant` are for the test of the judge itself: its own moves, and tools added to the server that are wrong on purpose.
 */
export async function playMcp(fixture: Fixture, seed: number, steps: number, makers: Record<string, McpMaker> = MCP_MAKERS, plant?: (server: McpServer, dir: string) => void): Promise<Played> {
  const rng = new Rng(seed)
  const names = Object.keys(makers)
  const played: Played = { findings: [], accepted: {}, refused: {} }
  const trace: string[] = []
  const root = await mkdtemp(join(tmpdir(), 'flowy-scenario-'))
  const dir = join(root, 'flowy')
  await materialise(fixture, dir)
  const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
  const server = createMcpServer(dir)
  plant?.(server, dir)
  await server.connect(serverSide)
  const client = new Client({ name: 'scenario', version: '0.0.0' })
  await client.connect(clientSide)

  const call = async ({ tool, args }: Call): Promise<Answer> => {
    try {
      const result = await client.callTool({ name: tool, arguments: args })
      const [part] = result.content as { text: string }[]
      return { error: result.isError === true, text: part?.text ?? '' }
    } catch (e) {
      // The SDK refuses an argument the schema does not take by throwing; that is a refusal. Anything else thrown is not.
      return { error: true, text: /Input validation|Invalid arguments|-32602/.test(String(e)) ? `Input validation error: ${first(e)}` : `threw ${first(e)}` }
    }
  }

  try {
    const start = await loadReport(dir)
    let before = await reportOf(dir, start.runs)
    if (!isDeepStrictEqual(before.problems, start.problems.filter(p => !p.message.startsWith("can't be saved again")))) played.findings.push({ rule: 'read-wrong', op: 'harness', detail: 'reportOf and loadReport disagree on the starting folder', fixture: fixture.name, seed, step: 0, trace: [] })
    let was = await files(dir)
    for (let step = 1; step <= steps; step++) {
      const move = makers[rng.pick(names)](before, rng)
      if (!move) continue
      const answers: Answer[] = []
      if (move.together) answers.push(...(await Promise.all(move.calls.map(call))))
      else for (const c of move.calls) answers.push(await call(c))
      if (move.kind === 'echo' && !answers[0].error) {
        let back
        try {
          back = move.sendBack?.(answers[0].text)
        } catch {
          back = undefined
        }
        if (back) answers.push(await call(back))
      }
      const failed = answers.every(a => a.error)
      trace.push(`${step}. ${move.label}  -> ${failed ? `refused: ${first(answers[answers.length - 1].text)}` : 'ok'}`)
      played[failed ? 'refused' : 'accepted'][move.op] = (played[failed ? 'refused' : 'accepted'][move.op] ?? 0) + 1
      const found = (v: Violation) => played.findings.push({ ...v, fixture: fixture.name, seed, step, trace: [...trace] })

      let after: Report
      try {
        after = await reportOf(dir, start.runs)
      } catch (e) {
        found({ rule: 'new-problem', op: move.op, detail: `the folder can't be loaded any more: ${first(e)}` })
        break
      }
      const now = await files(dir)
      for (const v of judge(move, answers, before, after, was, now, dir)) found(v)
      before = after
      was = now
    }
  } finally {
    await client.close()
    await rm(root, { recursive: true, force: true })
  }
  return played
}
