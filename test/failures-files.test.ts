import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ID_RULE } from '../src/core/model.ts'
import { blockedBy, hashText, isAllowedPath, loadDir, loadState } from '../src/node/files.ts'
import { openHistory } from '../src/node/history.ts'
import { applyWrite } from '../src/node/writes.ts'

const SHOP = 'objects:\n  shop: { type: system, name: Shop }\n  db: { type: store, in: shop, name: DB }\n'
const ORDERING = 'name: Ordering\nmodes:\n  db-down:\n    mode: The database is unreachable\n    on: db\n    severity: 10\n'

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-failures-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  const put = async (rel: string, text: string) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), text)
  }
  return { root, dir, put }
}

test('isAllowedPath accepts failures/<id>.yaml and nothing that is not a valid id', () => {
  for (const rel of ['failures/a.yaml', 'failures/orders-2.yaml']) assert.equal(isAllowedPath(rel), true, rel)
  for (const rel of ['failures/A.yaml', 'failures/a.yml', 'failures/a/b.yaml', 'failures/.yaml', 'failures/root.yaml', 'failures/a.yaml.tmp']) assert.equal(isAllowedPath(rel), false, rel)
})

test('a folder with no failures/ loads with no new keys anywhere', async t => {
  const { dir, put } = await setup(t)
  await put('model.yaml', SHOP)
  const { model, versions, failureProblems } = await loadDir(dir)
  assert.deepEqual(model.failures, {})
  assert.deepEqual(versions, { 'model.yaml': hashText(SHOP), 'layout.yaml': null })
  assert.deepEqual(failureProblems, [])
  const state = await loadState(dir)
  assert.ok('model' in state)
  assert.equal('failures' in state, false)
  assert.equal('failureProblems' in state, false)
  assert.equal('failures' in state.model, false)
})

test('analyses load by file name, in order, and their versions are recorded', async t => {
  const { dir, put } = await setup(t)
  await put('model.yaml', SHOP)
  await put('failures/b.yaml', 'name: B\n')
  await put('failures/a.yaml', ORDERING)
  const { model, versions } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.failures), ['a', 'b'])
  assert.equal(model.failures.a.modes['db-down'].severity, '10')
  assert.equal(versions['failures/a.yaml'], hashText(ORDERING))
  const state = await loadState(dir)
  assert.ok('model' in state)
  assert.deepEqual(Object.keys(state.failures ?? {}), ['a', 'b'])
  assert.equal(state.problems.length, 0)
})

test('a failures file with bad YAML is a problem, the model still loads, and the file is not part of it', async t => {
  const { dir, put } = await setup(t)
  await put('model.yaml', SHOP)
  await put('failures/bad.yaml', 'name: [unclosed\n')
  await put('failures/good.yaml', ORDERING)
  const { model, versions, failureProblems } = await loadDir(dir)
  assert.deepEqual(Object.keys(model.objects), ['shop', 'db'])
  assert.deepEqual(Object.keys(model.failures), ['good'])
  assert.equal(failureProblems.length, 1)
  assert.equal(failureProblems[0].file, 'failures/bad.yaml')
  assert.match(failureProblems[0].message, /^line \d+: /)
  assert.equal(versions['failures/bad.yaml'], hashText('name: [unclosed\n'))
  const state = await loadState(dir)
  assert.ok('model' in state)
  assert.deepEqual(state.failureProblems, failureProblems)
})

test('a merge-conflict failures file does the same', async t => {
  const { dir, put } = await setup(t)
  await put('failures/clash.yaml', 'name: A\n<<<<<<< ours\nname: B\n>>>>>>> theirs\n')
  const { failureProblems } = await loadDir(dir)
  assert.deepEqual(failureProblems.map(p => `${p.file}: ${p.message}`), ['failures/clash.yaml: line 2: unresolved merge conflict'])
})

test('a .yml file, a bad id and a file that is not text are problems, not analyses', async t => {
  const { dir, put } = await setup(t)
  await put('failures/old.yml', 'name: Old\n')
  await put('failures/Bad Id.yaml', 'name: Bad\n')
  await put('failures/other.txt', 'notes')
  await mkdir(join(dir, 'failures', 'folder.yaml'))
  await writeFile(join(dir, 'failures', 'binary.yaml'), new Uint8Array([0xff, 0xfe, 0x00]))
  const { model, failureProblems } = await loadDir(dir)
  assert.deepEqual(model.failures, {})
  assert.deepEqual(failureProblems.map(p => `${p.file}: ${p.message}`), [
    `failures/Bad Id.yaml: "Bad Id" is not a valid analysis id: the file name must ${ID_RULE}`,
    'failures/binary.yaml: is not UTF-8 text. Save it as UTF-8 and try again.',
    'failures/old.yml: Flowy reads analysis files that end in .yaml, so this one is ignored. Rename it to old.yaml.',
  ])
})

test('a file named __proto__ is an analysis with a problem, not the prototype of the analyses', async t => {
  const { dir, put } = await setup(t)
  await put('failures/__proto__.yaml', 'name: P\n')
  const { model, failureProblems } = await loadDir(dir)
  assert.equal(Object.getPrototypeOf(model.failures), Object.prototype)
  assert.deepEqual(model.failures, {})
  assert.equal(failureProblems.length, 1)
})

test('loadState carries failures, and a run link to a run that is not there is a failureProblem, not a problem', async t => {
  const { dir, put } = await setup(t)
  await put('model.yaml', SHOP)
  await put('failures/ordering.yaml', `${ORDERING}    run: ramp\n`)
  const state = await loadState(dir)
  assert.ok('model' in state)
  assert.equal(state.failures?.ordering.name, 'Ordering')
  assert.deepEqual(state.problems, [])
  assert.deepEqual(state.failureProblems?.map(p => p.message), ['db-down: run "ramp" doesn\'t exist'])
})

test('applyWrite writes and deletes failures/x.yaml with version checks', async t => {
  const { dir } = await setup(t)
  const data = { name: 'X', modes: {} }
  const made = await applyWrite(dir, 'PUT', 'failures/x.yaml', { version: null, data })
  assert.equal(made.status, 200)
  const text = await readFile(join(dir, 'failures', 'x.yaml'), 'utf8')
  assert.deepEqual(made.body, { version: hashText(text) })
  assert.deepEqual(await applyWrite(dir, 'PUT', 'failures/x.yaml', { version: null, data }), { status: 409, body: { version: hashText(text) } })
  assert.deepEqual(await applyWrite(dir, 'DELETE', 'failures/x.yaml', { version: null }), { status: 409, body: { version: hashText(text) } })
  assert.deepEqual(await applyWrite(dir, 'DELETE', 'failures/x.yaml', { version: hashText(text) }), { status: 200, body: { version: null } })
  assert.deepEqual(await applyWrite(dir, 'DELETE', 'layout.yaml', { version: null }), { status: 400, body: { error: 'can\'t write "layout.yaml"' } })
})

test('applyWrite refuses a failures file that is not a valid analysis, and writes nothing', async t => {
  const { dir } = await setup(t)
  const reply = await applyWrite(dir, 'PUT', 'failures/x.yaml', { version: null, data: { name: 'X', modes: ['no'] } })
  assert.equal(reply.status, 400)
  assert.match((reply.body as { error: string }).error, /^not a valid failures\/x\.yaml: "modes" must map ids to mappings/)
})

test('applyWrite will not overwrite or delete a failures file that could not be read, but other files still write', async t => {
  const { dir, put } = await setup(t)
  const broken = 'name: [unclosed\n'
  await put('failures/bad.yaml', broken)
  const version = hashText(broken)
  for (const method of ['PUT', 'DELETE']) {
    const reply = await applyWrite(dir, method, 'failures/bad.yaml', { version, data: { name: 'Fixed', modes: {} } })
    assert.deepEqual(reply, { status: 409, body: { error: "failures/bad.yaml can't be read, so it isn't replaced. Fix or delete it by hand." } }, method)
  }
  assert.equal(await readFile(join(dir, 'failures', 'bad.yaml'), 'utf8'), broken)
  assert.equal((await applyWrite(dir, 'PUT', 'model.yaml', { version: null, data: { objects: {}, connections: [] } })).status, 200)
  const loaded = await loadDir(dir)
  assert.equal(blockedBy(loaded, 'failures/bad.yaml'), 'failures/bad.yaml')
  assert.equal(blockedBy(loaded, 'failures/good.yaml'), undefined)
  assert.equal(blockedBy(loaded, 'model.yaml'), undefined)
})

test('a skipped file is in the way of a write to the same name in other letters, because Windows and macOS see one file', async t => {
  const { dir, put } = await setup(t)
  await put('failures/Ordering.yaml', ORDERING) // not a valid id, so skipped
  const reply = await applyWrite(dir, 'PUT', 'failures/ordering.yaml', { version: null, data: { name: 'O', modes: {} } })
  assert.deepEqual(reply, { status: 409, body: { error: "failures/Ordering.yaml is in the way (the same file name in other letters), so failures/ordering.yaml isn't written. Rename or delete it by hand." } })
  assert.equal(await readFile(join(dir, 'failures', 'Ordering.yaml'), 'utf8'), ORDERING)
  assert.equal(blockedBy(await loadDir(dir), 'failures/ordering.yaml'), 'failures/Ordering.yaml')
})

test('the history snapshot takes failures files that Flowy may write and nothing else in that folder', async t => {
  const { root, dir, put } = await setup(t)
  await put('model.yaml', SHOP)
  await put('failures/ordering.yaml', ORDERING)
  await put('failures/Bad_Id.yaml', 'name: Bad\n')
  await put('failures/old.yml', 'name: Old\n')
  await put('failures/notes.txt', 'notes')
  const history = openHistory(dir, { app: 'browser', stateDir: join(root, 'state'), log: () => undefined })
  const { files, bytes } = await history.snapshot()
  assert.deepEqual(Object.keys(files).sort(), ['failures/ordering.yaml', 'model.yaml'])
  assert.deepEqual(bytes.get(files['failures/ordering.yaml']), new TextEncoder().encode(ORDERING))
})
