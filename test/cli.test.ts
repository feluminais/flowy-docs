import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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

const SHOP = 'objects:\n  shop: { type: system, name: Shop }\n  db: { type: store, in: shop, name: Orders DB }\n'
const ORDERING = 'name: Ordering\nmodes:\n  down:\n    mode: The database is unreachable\n    on: db\n    severity: 10\n    occurrence: 2\n    detection: 2\n'

/** A flowy/ folder holding the shop and the given files under failures/. */
async function failuresFolder(t: TestContext, files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-failures-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'model.yaml'), SHOP)
  await mkdir(join(dir, 'failures'))
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, 'failures', name), text)
  const flowy = (...args: string[]) => spawnSync(process.execPath, ['src/cli.ts', ...args, '--dir', dir], { encoding: 'utf8' })
  return { dir, flowy }
}

test('flowy failures prints each analysis as a table and exits 0', async t => {
  const { flowy } = await failuresFolder(t, { 'ordering.yaml': ORDERING, 'other.yaml': 'name: Other\n' })
  const run = flowy('failures')
  assert.equal(run.status, 0, run.stderr)
  assert.equal(run.stderr, '')
  assert.ok(run.stdout.startsWith('## Ordering (ordering)\n\nAnalysed 1 of 1 shape\n\n| Risk band | Part |'), run.stdout)
  assert.match(run.stdout, /\n\n## Other \(other\)\n/)
  assert.match(run.stdout, /\| High \| Shop > Orders DB \| The database is unreachable \|/)
})

test('flowy failures --format csv prints csv, and --analysis picks one', async t => {
  const { flowy } = await failuresFolder(t, { 'ordering.yaml': ORDERING, 'other.yaml': 'name: Other\n' })
  const csv = flowy('failures', '--analysis', 'ordering', '--format', 'csv')
  assert.equal(csv.status, 0, csv.stderr)
  assert.equal(csv.stdout, 'Risk band,Part,Mode,Effect,Cause,Severity,Likelihood,Hard to spot,Risk,Controls,Next action,Owner,Status\nHigh,Shop > Orders DB,The database is unreachable,,,10,2,2,40,,,,open\n')
  const other = flowy('failures', '--analysis', 'other')
  assert.doesNotMatch(other.stdout, /Ordering/)
  assert.match(other.stdout, /^## Other \(other\)/)
})

test('flowy failures prints a problem to stderr and exits 1, with the table still printed', async t => {
  const { flowy } = await failuresFolder(t, { 'ordering.yaml': `${ORDERING}  bad:\n    mode: x\n    on: gone\n` })
  const run = flowy('failures')
  assert.equal(run.status, 1)
  assert.match(run.stdout, /The database is unreachable/)
  assert.equal(run.stderr, 'failures/ordering.yaml: bad: unknown object "gone"\n')
})

test('flowy failures reports a file it could not read, and an analysis, a format or a folder that is not there', async t => {
  const { flowy, dir } = await failuresFolder(t, { 'bad.yaml': 'name: [unclosed\n' })
  const unreadable = flowy('failures')
  assert.equal(unreadable.status, 1)
  assert.equal(unreadable.stdout, '')
  assert.match(unreadable.stderr, /^failures\/bad\.yaml: line \d+: /)
  const unknown = flowy('failures', '--analysis', 'nope')
  assert.deepEqual([unknown.status, unknown.stdout, unknown.stderr], [1, '', 'unknown analysis "nope"\n'])
  const format = flowy('failures', '--format', 'xml')
  assert.deepEqual([format.status, format.stderr], [1, 'The format must be markdown or csv, not "xml".\n'])
  await rm(join(dir, 'failures', 'bad.yaml'))
  const none = flowy('failures')
  assert.equal(none.status, 1)
  assert.equal(none.stderr, `No failure analyses in ${dir}.\n`)
  await writeFile(join(dir, 'model.yaml'), 'objects: [\n')
  const broken = flowy('failures')
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /^model\.yaml(:\d+)?: /)
})

test('--analysis and --format belong to flowy failures, and anywhere else print the usage line', async t => {
  const { flowy } = await failuresFolder(t, { 'ordering.yaml': ORDERING })
  for (const args of [['--analysis', 'ordering'], ['export', '--format', 'csv'], ['mermaid', '--view', 'shop', '--format', 'csv'], ['failures', '--flow', 'x']]) {
    const run = flowy(...args)
    assert.equal(run.status, 1, args.join(' '))
    assert.match(run.stderr, /^Usage: flowy/, args.join(' '))
    assert.match(run.stderr, /flowy failures \[--analysis <id>\] \[--format markdown\|csv\]/, args.join(' '))
  }
})

test('flowy check says a sound model has no problems, and exits 0', () => {
  for (const dir of ['example', 'docs/demo/flowy', 'flowy']) {
    const run = spawnSync(process.execPath, ['src/cli.ts', 'check', '--dir', dir], { encoding: 'utf8' })
    assert.equal(run.status, 0, `${dir}: ${run.stderr}`)
    assert.match(run.stdout, /^No problems in \d+ shapes?, \d+ flows?, \d+ failure analys[ie]s?e? and \d+ load-test runs? in /, dir)
    assert.equal(run.stderr, '', dir)
  }
})

test('flowy check lists every problem, a file that loads but cannot be saved included, and exits 1', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'flows'))
  await mkdir(join(dir, 'failures'))
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  a: { type: actor, name: A }\n  s: { type: system, name: S }\nconnections:\n  - { from: a, to: s, label: reads }\n')
  // A comma in unquoted flow text leaves a key with no value: the file loads, and saving it again would throw.
  await writeFile(join(dir, 'flows', 'comma.yaml'), 'name: Comma\nview: root\nsteps:\n  - { from: a, to: s, text: Sets the time zone, if asked }\n')
  await writeFile(join(dir, 'flows', 'ghost.yaml'), 'name: Ghost\nview: root\nsteps:\n  - { from: a, to: nope, text: Calls }\n')
  await writeFile(join(dir, 'flows', 'old.yml'), 'name: Old\nview: root\nsteps: []\n')
  await writeFile(join(dir, 'failures', 'f.yaml'), 'name: F\nmodes:\n  m:\n    mode: It breaks\n    on: s\n    run: no-such-run\n')
  const run = spawnSync(process.execPath, ['src/cli.ts', 'check', '--dir', dir], { encoding: 'utf8' })
  assert.equal(run.status, 1)
  assert.equal(run.stdout, '')
  const lines = run.stderr.trim().split('\n')
  assert.deepEqual(lines.slice(0, -1).sort(), [
    'failures/f.yaml: m: run "no-such-run" doesn\'t exist',
    'flows/comma.yaml: step 1: "if asked" has no value (a comma ends unquoted text: put text that has a comma in double quotes)',
    'flows/ghost.yaml: step 1: unknown object "nope"',
    'flows/old.yml: Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to flows/old.yaml.',
  ])
  assert.match(lines.at(-1)!, /^4 problems in 2 shapes, 2 flows, 1 failure analysis and 0 load-test runs in /)
})

test('flowy check reports a file that cannot be saved again only when nothing else says why', async t => {
  const { saveProblems } = await import('../src/node/files.ts')
  const { emptyModel } = await import('../src/core/model.ts')
  const { parseFlowFile } = await import('../src/core/modelfiles.ts')
  const model = { ...emptyModel(), flows: { x: parseFlowFile('x', 'name: X\nview: root\nsteps: []\n') } }
  assert.deepEqual(saveProblems(model), [])
  // A model the parser never makes: a number where only text is written.
  ;(model.flows.x as unknown as { name: unknown }).name = 5
  assert.deepEqual(saveProblems(model).map(p => p.file), ['flows/x.yaml'])
  assert.match(saveProblems(model)[0].message, /^can't be saved again: /)
})

test('flowy check names the file it cannot read, and belongs to no flags of the other commands', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-check-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'model.yaml'), 'objects: [\n')
  const broken = spawnSync(process.execPath, ['src/cli.ts', 'check', '--dir', dir], { encoding: 'utf8' })
  assert.equal(broken.status, 1)
  assert.match(broken.stderr, /^model\.yaml(:\d+)?: /)
  for (const args of [['check', 'more'], ['check', '--flow', 'x'], ['check', '--format', 'csv']]) {
    const run = spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' })
    assert.equal(run.status, 1, args.join(' '))
    assert.match(run.stderr, /^Usage: flowy[^]*flowy check \[--dir flowy\]/, args.join(' '))
  }
})

test('flowy tidy puts neighbours on the side they have in the view above, and --check only lists them', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-cli-tidy-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, 'model.yaml'), `objects:
  ordering: { type: system, name: Ordering }
  backoffice: { type: system, name: Back office }
  api: { type: app, name: Order API, in: ordering }
  web: { type: app, name: Website, in: ordering }
  admin: { type: app, name: Admin, in: backoffice }
  console: { type: app, name: Console, in: backoffice }
connections:
  - { from: web, to: api }
  - { from: admin, to: api }
  - { from: console, to: api }
  - { from: api, to: admin }
`)
  const flowy = (...args: string[]) => spawnSync(process.execPath, ['src/cli.ts', ...args, '--dir', dir], { encoding: 'utf8' })
  const found = flowy('tidy', '--check')
  assert.equal(found.status, 1)
  assert.match(found.stderr, /^Found \d views?:\n- /)
  assert.equal(found.stdout, '')
  assert.deepEqual(await readdir(dir), ['model.yaml'], '--check writes nothing')

  const tidied = flowy('tidy')
  assert.equal(tidied.status, 0, tidied.stderr)
  assert.match(tidied.stdout, /^Tidied \d views?:\n- /)
  assert.ok((await readdir(dir)).includes('layout.yaml'))
  const clean = flowy('tidy', '--check')
  assert.equal(clean.status, 0, clean.stderr)
  assert.match(clean.stdout, /^Every neighbour is on the side it has in the view above\./)
})

test('--check belongs to flowy tidy, and anywhere else prints the usage line', () => {
  for (const args of [['check', '--check'], ['export', '--check'], ['--check'], ['failures', '--check'], ['mermaid', '--view', 'shop', '--check'], ['tidy', '--flow', 'x'], ['tidy', 'more']]) {
    const run = spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8' })
    assert.equal(run.status, 1, args.join(' '))
    assert.match(run.stderr, /^Usage: flowy[^]*flowy tidy \[--check\] \[--dir flowy\]/, args.join(' '))
  }
})
