import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParseError } from '../src/core/model.ts'
import { hashText, isAllowedPath, loadDir, loadState, missingPaths, saveFile, VersionConflict } from '../src/node/files.ts'

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
