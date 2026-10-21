import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { checkRun } from '../../src/core/perf/check.ts'
import { parseRun } from '../../src/core/perf/parse.ts'
import { loadDir } from '../../src/node/files.ts'

// Not part of `npm test`: it starts real servers on real ports and takes about half a minute.
// Run it with `npm run lab:smoke`.
test('the harness writes a run that parses and fits the lab model', { timeout: 120_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'perf-lab-smoke-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const out = join(dir, 'smoke.yaml')
  await promisify(execFile)(process.execPath, [
    join(import.meta.dirname, '../load/run.ts'),
    '--levels', '20,60', '--duration', '2', '--warmup', '1', '--name', 'smoke', '--out', out,
  ], { timeout: 100_000 }) // a harness that hangs is stopped rather than left running
  const { run, problems } = parseRun('smoke', await readFile(out, 'utf8'))
  assert.deepEqual(problems, [])
  assert.deepEqual(run.levels.map(l => l.load), [20, 60])
  assert.ok(run.levels.every(l => (l.overall.rate ?? 0) > 0 && Object.keys(l.objects).length > 0 && l.connections.length > 0))
  const { model } = await loadDir(join(import.meta.dirname, '../flowy'))
  assert.deepEqual(checkRun('smoke', run, model), [])
})
