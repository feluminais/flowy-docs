import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadReport, saveFile, saveRaw } from '../src/node/files.ts'
import { openHistory } from '../src/node/history.ts'
import { historyKey, openStore } from '../src/node/history-store.ts'

const MODEL = 'objects:\n  shop: { type: system, name: Shop }\n'
const FLOW = 'name: Evil\nsteps:\n  - { from: shop, to: shop, text: hi }\n'

/** A model folder, and a folder beside it that is not part of the model. A directory link is a junction on Windows, which needs no privilege. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-links-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  const outside = join(root, 'outside')
  await mkdir(dir)
  await mkdir(outside)
  await writeFile(join(dir, 'model.yaml'), MODEL)
  await writeFile(join(outside, 'evil.yaml'), FLOW)
  const link = async (target: string, path: string) => {
    try {
      await symlink(target, path, 'junction')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return t.skip('this system does not allow links')
      throw e
    }
  }
  return { root, dir, outside, link }
}

test('a folder of flows that is a link to somewhere else is not read: the load stops and names the file', async t => {
  const { dir, link } = await setup(t)
  await link(join(dir, '..', 'outside'), join(dir, 'flows'))
  await assert.rejects(loadReport(dir), /flows\/evil\.yaml: points outside the folder/)
})

test('a folder of failure analyses that is a link to somewhere else is not read, and the file is named as a problem', async t => {
  const { dir, outside, link } = await setup(t)
  await writeFile(join(outside, 'leak.yaml'), 'name: Leak\nmodes: {}\n')
  await link(outside, join(dir, 'failures'))
  const { model, problems } = await loadReport(dir)
  assert.deepEqual(Object.keys(model.failures), [])
  assert.ok(problems.some(p => p.file === 'failures/leak.yaml' && /points outside the folder/.test(p.message)), JSON.stringify(problems))
})

test('nothing is saved or deleted through a link that leaves the folder', async t => {
  const { dir, outside, link } = await setup(t)
  await link(outside, join(dir, 'flows'))
  await assert.rejects(saveFile(dir, 'flows/new.yaml', 'name: New\nsteps: []\n', null), /"flows\/new\.yaml" points outside the folder|flows\/new\.yaml: points outside the folder/)
  await assert.rejects(saveFile(dir, 'flows/evil.yaml', null, null), /points outside the folder/)
  await assert.rejects(saveRaw(dir, 'flows/raw.yaml', new TextEncoder().encode('x'), null), /points outside the folder/)
  assert.deepEqual((await readdir(outside)).sort(), ['evil.yaml'])
})

test('a link that stays inside the folder still works', async t => {
  const { dir, link } = await setup(t)
  await mkdir(join(dir, 'real-flows'))
  await writeFile(join(dir, 'real-flows', 'tour.yaml'), 'name: Tour\nsteps:\n  - { from: shop, to: shop, text: hi }\n')
  await link(join(dir, 'real-flows'), join(dir, 'flows'))
  assert.deepEqual(Object.keys((await loadReport(dir)).model.flows), ['tour'])
  await saveFile(dir, 'flows/other.yaml', 'name: Other\nsteps: []\n', null)
  assert.deepEqual((await readdir(join(dir, 'real-flows'))).sort(), ['other.yaml', 'tour.yaml'])
})

test('a model folder that is itself reached through a link still works', async t => {
  const { root, dir, link } = await setup(t)
  await link(dir, join(root, 'via-link'))
  assert.deepEqual(Object.keys((await loadReport(join(root, 'via-link'))).model.objects), ['shop'])
  await saveFile(join(root, 'via-link'), 'model.yaml', MODEL + '  db: { type: store, name: DB }\n', (await loadReportVersion(join(root, 'via-link'))))
})

async function loadReportVersion(dir: string): Promise<string | null> {
  const { loadDir } = await import('../src/node/files.ts')
  return (await loadDir(dir)).versions['model.yaml'] ?? null
}

test('the history of a folder does not copy what a link points at outside it', async t => {
  const { root, dir, outside, link } = await setup(t)
  await link(outside, join(dir, 'flows'))
  const stateDir = join(root, 'state')
  const history = openHistory(dir, { app: 'browser', stateDir, log: () => undefined })
  await history.ensureCurrent('open')
  const steps = await openStore(join(stateDir, 'history', historyKey(resolve(dir)))).steps()
  assert.ok(steps.length > 0)
  for (const step of steps) assert.deepEqual(Object.keys(step.files).filter(f => f.startsWith('flows/')), [])
})
