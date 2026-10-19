import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { State } from '../src/core/state.ts'

/** A child's environment with its history kept in a folder of its own, so a test never writes into the real application data. */
const withStateDir = (stateDir: string) => ({ ...process.env, FLOWY_STATE_DIR: stateDir })

test('flowy serves the given folder and prints its URL', { timeout: 10_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-'))
  const stateDir = await mkdtemp(join(tmpdir(), 'flowy-cli-state-'))
  const child = spawn(process.execPath, ['src/cli.ts', '--dir', dir, '--port', '0', '--no-open'], { stdio: ['ignore', 'pipe', 'inherit'], env: withStateDir(stateDir) })
  t.after(async () => {
    if (child.exitCode === null && child.kill()) await once(child, 'exit')
    await rm(dir, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  })
  const [printed] = await once(child.stdout, 'data')
  const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(printed))?.[0]
  assert.ok(url, String(printed))
  const state = (await (await fetch(`${url}api/state`)).json()) as State
  assert.ok('versions' in state)
  assert.deepEqual(state.versions, { 'model.yaml': null, 'layout.yaml': null })
})

test('flowy keeps the folder\'s history in the state folder and adds nothing to the folder', { timeout: 10_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-'))
  const stateDir = await mkdtemp(join(tmpdir(), 'flowy-cli-state-'))
  await writeFile(join(dir, 'model.yaml'), 'objects: {}\nconnections: []\n')
  const child = spawn(process.execPath, ['src/cli.ts', '--dir', dir, '--port', '0', '--no-open'], { stdio: ['ignore', 'pipe', 'inherit'], env: withStateDir(stateDir) })
  t.after(async () => {
    if (child.exitCode === null && child.kill()) await once(child, 'exit')
    await rm(dir, { recursive: true, force: true })
    await rm(stateDir, { recursive: true, force: true })
  })
  const [printed] = await once(child.stdout, 'data')
  const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(printed))?.[0]
  assert.ok(url, String(printed))
  const history = (await (await fetch(`${url}api/history`)).json()) as { saving: boolean; steps: { label: string }[] }
  assert.deepEqual([history.saving, history.steps.map(s => s.label)], [true, ['First seen']])
  assert.deepEqual(await readdir(dir), ['model.yaml'])
  assert.equal((await readdir(join(stateDir, 'history'))).length, 1)
})

test('flowy that cannot start says why in one line, not with a stack trace, and exits 1', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = join(dir, 'not-a-folder')
  await writeFile(file, '')
  const run = spawnSync(process.execPath, ['src/cli.ts', '--dir', file, '--port', '0', '--no-open'], { encoding: 'utf8', env: withStateDir(join(dir, 'state')) })
  assert.equal(run.status, 1, run.stderr)
  assert.match(run.stderr, /not-a-folder/)
  assert.doesNotMatch(run.stderr, /\n\s+at /)
})

test('flowy shows the usage line for unknown commands, flags and ports', () => {
  for (const args of [['serve'], ['--port', 'abc'], ['--port', '70000'], ['--bogus'], ['export', 'more'], ['--flow', 'checkout'], ['export', '--view', 'shop']]) {
    const run = spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' })
    assert.equal(run.status, 1, args.join(' '))
    assert.match(run.stderr, /^Usage: flowy/, args.join(' '))
  }
})

test('flowy export names the file it cannot read, and exits 1', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'model.yaml'), 'objects: [\n')
  const run = spawnSync(process.execPath, ['src/cli.ts', 'export', '--dir', dir, '--out', join(dir, 'site')], { encoding: 'utf8' })
  assert.equal(run.status, 1, run.stderr)
  assert.match(run.stderr, /^model\.yaml(:\d+)?: /)
})

test('flowy mermaid prints a flow or a view, and wants exactly one', () => {
  const flow = spawnSync(process.execPath, ['src/cli.ts', 'mermaid', '--dir', 'example', '--flow', 'checkout'], { encoding: 'utf8' })
  assert.equal(flow.status, 0, flow.stderr)
  assert.match(flow.stdout, /^sequenceDiagram\n {2}actor n0 as Customer\n/)
  const view = spawnSync(process.execPath, ['src/cli.ts', 'mermaid', '--dir', 'example', '--view', 'shop'], { encoding: 'utf8' })
  assert.match(view.stdout, /^flowchart TB\n/)
  for (const args of [[], ['--flow', 'checkout', '--view', 'shop']]) {
    const run = spawnSync(process.execPath, ['src/cli.ts', 'mermaid', '--dir', 'example', ...args], { encoding: 'utf8' })
    assert.match(run.stderr, /^Usage: flowy/, args.join(' '))
  }
  const unknown = spawnSync(process.execPath, ['src/cli.ts', 'mermaid', '--dir', 'example', '--flow', 'nope'], { encoding: 'utf8' })
  assert.equal(unknown.status, 1)
  assert.match(unknown.stderr, /unknown flow "nope"/)
})
