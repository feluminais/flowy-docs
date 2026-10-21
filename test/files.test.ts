import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParseError } from '../src/core/model.ts'
import { hashBytes, hashText, isAllowedPath, loadDir, loadState, missingPaths, saveFile, saveRaw, VersionConflict } from '../src/node/files.ts'

async function tempDir(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'flowy-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('a missing folder loads as an empty model', async t => {
  const { model, versions } = await loadDir(join(await tempDir(t), 'flowy'))
  assert.deepEqual(model.objects, {})
  assert.deepEqual(versions, { 'model.yaml': null, 'layout.yaml': null })
})

test('saveFile writes, leaves no temp file, and loadDir reads it back with the same version', async t => {
  const dir = await tempDir(t)
  const text = 'objects:\n  a: { type: actor, name: A }\n'
  const version = await saveFile(dir, 'model.yaml', text, null)
  assert.equal(version, hashText(text))
  assert.deepEqual(await readdir(dir), ['model.yaml'])
  const { model, versions } = await loadDir(dir)
  assert.equal(model.objects.a.name, 'A')
  assert.equal(versions['model.yaml'], version)
})

test('flows load by file name, in order, skipping anything that is not a .yaml file', async t => {
  const dir = await tempDir(t)
  await saveFile(dir, 'flows/b.yaml', 'name: B\n', null)
  await saveFile(dir, 'flows/a.yaml', 'name: A\n', undefined)
  await writeFile(join(dir, 'flows/c.yml'), 'name: C\n')
  await writeFile(join(dir, 'flows/d.yaml.1234.tmp'), 'name: D\n')
  await mkdir(join(dir, 'flows/e.yaml'))
  const { model, versions } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.flows), ['a', 'b'])
  assert.equal(versions['flows/b.yaml'], hashText('name: B\n'))
})

test('a flow file named __proto__ is a flow with a problem, not the prototype of the flows', async t => {
  const dir = await tempDir(t)
  await mkdir(join(dir, 'flows'))
  await writeFile(join(dir, 'flows/__proto__.yaml'), 'name: P\n')
  const { model } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.flows), ['__proto__'])
  assert.equal(Object.getPrototypeOf(model.flows), Object.prototype)
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.ok(state.problems.some(p => p.file === 'flows/__proto__.yaml' && /not a valid flow id/.test(p.message)))
})

test('a flow file ending in .yml is skipped, and the problems list says so', async t => {
  const dir = await tempDir(t)
  await mkdir(join(dir, 'flows'))
  await writeFile(join(dir, 'flows/checkout.yml'), 'name: C\n')
  const { model, ignored } = await loadDir(dir)
  assert.deepEqual(model.flows, {})
  assert.deepEqual(ignored, ['flows/checkout.yml'])
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, [{ file: 'flows/checkout.yml', message: 'Flowy reads flow files that end in .yaml, so this one is ignored. Rename it to flows/checkout.yaml.' }])
})

test('a stale version is refused and the file is left alone; an empty file is not a missing one', async t => {
  const dir = await tempDir(t)
  await saveFile(dir, 'model.yaml', 'objects: {}\n', null)
  await assert.rejects(saveFile(dir, 'model.yaml', 'objects:\n  x: {}\n', 'not-the-version'), VersionConflict)
  await assert.rejects(saveFile(dir, 'model.yaml', 'x', null), VersionConflict)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects: {}\n')
  await writeFile(join(dir, 'layout.yaml'), '')
  await assert.rejects(saveFile(dir, 'layout.yaml', 'root: {}\n', null), VersionConflict)
  assert.equal(await saveFile(dir, 'layout.yaml', 'root: {}\n', hashText('')), hashText('root: {}\n'))
})

test('two saves of the same file at once: one wins, the other gets VersionConflict', async t => {
  const dir = await tempDir(t)
  const results = await Promise.allSettled([
    saveFile(dir, 'model.yaml', 'objects: {}\n# a\n', null),
    saveFile(dir, 'model.yaml', 'objects: {}\n# b\n', null),
  ])
  assert.deepEqual(results.map(r => r.status).sort(), ['fulfilled', 'rejected'])
  const failed = results.find(r => r.status === 'rejected') as PromiseRejectedResult
  assert.ok(failed.reason instanceof VersionConflict)
  assert.match(await readFile(join(dir, 'model.yaml'), 'utf8'), /^objects: \{\}\n# [ab]\n$/)
  assert.deepEqual(await readdir(dir), ['model.yaml'])
})

test('a refused save does not block the one queued behind it', async t => {
  const dir = await tempDir(t)
  const [stale, fresh] = await Promise.allSettled([
    saveFile(dir, 'model.yaml', 'objects: {}\n# stale\n', 'not-the-version'),
    saveFile(dir, 'model.yaml', 'objects: {}\n', null),
  ])
  assert.equal(stale.status, 'rejected')
  assert.equal(fresh.status, 'fulfilled')
})

test('only the flowy files themselves can be written', async t => {
  for (const ok of ['model.yaml', 'layout.yaml', 'flows/a.yaml', 'flows/checkout-2.yaml']) assert.equal(isAllowedPath(ok), true, ok)
  const bad: unknown[] = ['../model.yaml', '/model.yaml', 'x/flows/a.yaml', 'flows\\a.yaml', 'Model.yaml', 'model.yaml\n',
    'flows/a/b.yaml', 'flows/a.yaml.', 'flows/-a.yaml', 'flows/A.yaml', 'flows/root.yaml', 'flows/../../evil.yaml', ['model.yaml']]
  for (const rel of bad) assert.equal(isAllowedPath(rel), false, JSON.stringify(rel))
  const dir = await tempDir(t)
  await assert.rejects(saveFile(dir, '../evil.yaml', 'x', null), /refusing/)
})

test('null deletes', async t => {
  const dir = await tempDir(t)
  const version = await saveFile(dir, 'flows/a.yaml', 'name: A\n', null)
  assert.equal(await saveFile(dir, 'flows/a.yaml', null, version), null)
  assert.equal((await loadDir(dir)).model.flows.a, undefined)
})

test('saveRaw writes bytes, leaves no temp file, and returns hashBytes', async t => {
  const dir = await tempDir(t)
  const bytes = new TextEncoder().encode('objects: {}\n')
  assert.equal(await saveRaw(dir, 'model.yaml', bytes, null), hashBytes(bytes))
  assert.deepEqual(await readFile(join(dir, 'model.yaml')), Buffer.from(bytes))
  assert.deepEqual(await readdir(dir), ['model.yaml'])
})

test('saveRaw replaces a file that is not UTF-8', async t => {
  const dir = await tempDir(t)
  const broken = new Uint8Array([0xff, 0xfe, 0x00])
  await writeFile(join(dir, 'model.yaml'), broken)
  const next = new TextEncoder().encode('objects: {}\n')
  assert.equal(await saveRaw(dir, 'model.yaml', next, hashBytes(broken)), hashBytes(next))
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects: {}\n')
})

test('saveRaw with null removes the file', async t => {
  const dir = await tempDir(t)
  const version = await saveRaw(dir, 'layout.yaml', new TextEncoder().encode('{}\n'), null)
  assert.equal(await saveRaw(dir, 'layout.yaml', null, version), null)
  assert.deepEqual(await readdir(dir), [])
})

test('saveRaw refuses a stale version and tells the version the file has', async t => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'model.yaml'), 'objects: {}\n')
  await assert.rejects(saveRaw(dir, 'model.yaml', new Uint8Array([1]), 'not-the-version'), (e: unknown) => e instanceof VersionConflict && e.version === hashText('objects: {}\n'))
  await assert.rejects(saveRaw(dir, 'model.yaml', new Uint8Array([1]), null), VersionConflict)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects: {}\n')
})

test('saveRaw writes only the flowy files', async t => {
  const dir = await tempDir(t)
  await assert.rejects(saveRaw(dir, '../evil.yaml', new Uint8Array([1]), null), /refusing/)
  await assert.rejects(saveRaw(dir, 'flows/Bad_Flow.yaml', new Uint8Array([1]), null), /refusing/)
})

test('broken files are reported with their name, and never overwritten', async t => {
  for (const [rel, text] of [['model.yaml', 'objects:\n  a: { type: actor\n'], ['layout.yaml', 'root:\n  a: [1]\n'], ['flows/x.yaml', 'steps: nope\n']]) {
    const dir = await tempDir(t)
    await mkdir(join(dir, 'flows'))
    await writeFile(join(dir, rel), text)
    await assert.rejects(loadDir(dir), (e: unknown) => e instanceof ParseError && e.file === rel, rel)
  }
  const dir = await tempDir(t)
  const ansi = Buffer.from([0x6f, 0x3a, 0x20, 0xcf, 0xf0, 0x0a])
  await writeFile(join(dir, 'model.yaml'), ansi)
  await assert.rejects(loadDir(dir), /model\.yaml: is not UTF-8 text/)
  await assert.rejects(saveFile(dir, 'model.yaml', 'objects: {}\n', hashText('o: ??\n')), ParseError)
  assert.deepEqual(await readFile(join(dir, 'model.yaml')), ansi)
})

test('a UTF-8 file with a BOM loads', async t => {
  const dir = await tempDir(t)
  const bom = String.fromCharCode(0xfeff) // built in code so no copy or paste step can drop it
  await writeFile(join(dir, 'model.yaml'), `${bom}objects:\n  a: { type: actor, name: A }\n`)
  assert.equal((await loadDir(dir)).model.objects.a.name, 'A')
})

test('missing code paths are the well-formed ones that are not next to the flowy folder', async t => {
  const root = await tempDir(t)
  const dir = join(root, 'flowy')
  await mkdir(join(root, 'src', 'api'), { recursive: true })
  await writeFile(join(root, 'src', 'api', 'server.ts'), '')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  api: { type: system, name: API, code: [src/api/, src/api/server.ts, gone.ts, ../x] }\n')
  const { model } = await loadDir(dir)
  assert.deepEqual([...missingPaths(dir, model)], ['gone.ts'])
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.deepEqual(state.problems.map(p => p.message), [
    'api: code path "gone.ts" doesn\'t exist',
    'api: code path "../x" must be relative, with / between folders and no "." or ".." parts',
  ])
})

test('missing link paths count like missing code paths, and web addresses are not looked up', async t => {
  const root = await tempDir(t)
  const dir = join(root, 'flowy')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'runbook.md'), '')
  await mkdir(dir)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  api:\n    type: system\n    name: API\n    links:\n      - { title: Runbook, url: docs/runbook.md }\n      - { title: Gone, url: docs/gone.md }\n      - { title: Status, url: "https://status.example.com" }\n')
  const { model } = await loadDir(dir)
  assert.deepEqual([...missingPaths(dir, model)], ['docs/gone.md'])
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.deepEqual(state.problems.map(p => p.message), ['api: link path "docs/gone.md" doesn\'t exist'])
})

const RUN_MODEL = 'objects:\n  web: { type: actor, name: Web }\n  api: { type: actor, name: API }\nconnections:\n  - { from: web, to: api, label: calls }\n'
const RUN_GOOD = 'name: Ramp\nunit: req/s\nlevels:\n  - { load: 10, objects: { api: { util: 0.2 } }, connections: [{ from: web, to: api, rate: 10 }] }\n  - { load: 20, objects: { api: { util: 0.4 } } }\n'

test('a folder with no perf folder has no runs in its state', async t => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'model.yaml'), RUN_MODEL)
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.equal('runs' in state, false)
  assert.equal('runProblems' in state, false)
})

test('runs load from perf/, and a file that cannot be used becomes a run problem and never stops the model', async t => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'model.yaml'), RUN_MODEL)
  await mkdir(join(dir, 'perf'))
  await writeFile(join(dir, 'perf/ramp.yaml'), RUN_GOOD)
  await writeFile(join(dir, 'perf/bad.yaml'), '<<<<<<< HEAD\nname: x\n')
  await writeFile(join(dir, 'perf/ghost.yaml'), 'name: Ghost\nlevels:\n  - { load: 1, objects: { nope: { util: 0.1 } } }\n  - { load: 2, objects: { nope: { util: 0.2 } } }\n')
  await writeFile(join(dir, 'perf/old.yml'), RUN_GOOD)
  await writeFile(join(dir, 'perf/Not Valid.yaml'), RUN_GOOD)
  await writeFile(join(dir, 'perf/ramp.yaml.1234.tmp'), RUN_GOOD)
  await writeFile(join(dir, 'perf/binary.yaml'), Buffer.from([0xff, 0xfe, 0x00]))
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.deepEqual(state.problems, []) // the model's own problems are untouched
  assert.deepEqual(Object.keys(state.runs ?? {}), ['ghost', 'ramp'])
  assert.equal(state.runs?.ramp.levels[1].objects.api.util, 0.4)
  assert.deepEqual(state.runProblems?.map(p => `${p.file} ${p.message}`), [
    'perf/Not Valid.yaml "Not Valid" is not a valid run id: the file name must use lowercase letters, digits and dashes, not starting with a dash ("root" is reserved)',
    'perf/bad.yaml line 1: unresolved merge conflict',
    'perf/binary.yaml is not UTF-8 text. Save it as UTF-8 and try again.',
    'perf/ghost.yaml unknown object "nope"',
    'perf/old.yml Flowy reads run files that end in .yaml, so this one is ignored. Rename it to old.yaml.',
  ])
})

test('a run that adds others loads when it has two runs to add, and is left out with a problem when it has fewer', async t => {
  const dir = await tempDir(t)
  await writeFile(join(dir, 'model.yaml'), RUN_MODEL)
  await mkdir(join(dir, 'perf'))
  await writeFile(join(dir, 'perf/ramp.yaml'), RUN_GOOD)
  await writeFile(join(dir, 'perf/ramp-too.yaml'), RUN_GOOD.replace('name: Ramp', 'name: Ramp too'))
  await writeFile(join(dir, 'perf/both.yaml'), 'name: Both\nadds: [ramp, ramp-too, ghost]\n')
  await writeFile(join(dir, 'perf/lonely.yaml'), 'name: Lonely\nadds: [ramp, ghost]\n')
  const state = await loadState(dir)
  assert.ok('problems' in state)
  assert.deepEqual(Object.keys(state.runs ?? {}), ['both', 'ramp-too', 'ramp'])
  assert.deepEqual(state.runProblems?.map(p => `${p.file} ${p.message}`), [
    'perf/both.yaml adds "ghost", which is not a run',
    'perf/lonely.yaml adds "ghost", which is not a run',
    "perf/lonely.yaml can't be played: fewer than two of the runs it adds can be added",
  ])
})

test('runs are read, never written: perf/ is not a path the server or MCP may save', () => {
  assert.equal(isAllowedPath('perf/ramp.yaml'), false)
})
