import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { State } from '../src/core/state.ts'

test('flowy serves the given folder and prints its URL', { timeout: 10_000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-'))
  const child = spawn(process.execPath, ['src/cli.ts', '--dir', dir, '--port', '0', '--no-open'], { stdio: ['ignore', 'pipe', 'inherit'] })
  t.after(async () => {
    if (child.exitCode === null && child.kill()) await once(child, 'exit')
    await rm(dir, { recursive: true, force: true })
  })
  const [printed] = await once(child.stdout, 'data')
  const url = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(printed))?.[0]
  assert.ok(url, String(printed))
  const state = (await (await fetch(`${url}api/state`)).json()) as State
  assert.ok('versions' in state)
  assert.deepEqual(state.versions, { 'model.yaml': null, 'layout.yaml': null })
})

test('flowy shows the usage line for unknown commands, flags and ports', () => {
  for (const args of [['serve'], ['--port', 'abc'], ['--port', '70000'], ['--bogus']]) {
    const run = spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' })
    assert.equal(run.status, 1, args.join(' '))
    assert.match(run.stderr, /^Usage: flowy/, args.join(' '))
  }
})
