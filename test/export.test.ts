import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParseError } from '../src/core/model.ts'
import { exportSite, inlineState } from '../src/node/export.ts'
import { loadState } from '../src/node/files.ts'

/** A flowy/ folder with one system, and a stand-in for the built canvas: a page and one asset. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-export-'))
  const dir = join(root, 'flowy')
  const ui = join(root, 'ui')
  const out = join(root, 'site')
  await mkdir(dir)
  await mkdir(join(ui, 'assets'), { recursive: true })
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop: { type: system, name: Shop }\n')
  await writeFile(join(ui, 'index.html'), '<!doctype html>\n<html><head><title>Flowy Docs</title></head><body><div id="root"></div></body></html>\n')
  await writeFile(join(ui, 'assets', 'app.js'), 'console.log("canvas")\n')
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, dir, ui, out }
}

/** The state an exported page carries, found the way a browser ends the element: at the first </script>. */
function stateIn(html: string): unknown {
  const found = /<script type="application\/json" id="flowy-state">(.*?)<\/script>/s.exec(html)
  assert.ok(found, 'no state in the page')
  return JSON.parse(found[1])
}

const exists = (path: string) => access(path).then(() => true, () => false)

test('an export is the built canvas with the state in its page', async t => {
  const { dir, ui, out } = await setup(t)
  assert.deepEqual(await exportSite({ dir, ui, out }), { boxes: 1, flows: 0, problems: 0 })
  assert.equal(await readFile(join(out, 'assets', 'app.js'), 'utf8'), 'console.log("canvas")\n')
  assert.deepEqual(stateIn(await readFile(join(out, 'index.html'), 'utf8')), await loadState(dir))
})

test('text in the model cannot end the state element early', async t => {
  const { dir, ui, out } = await setup(t)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop: { type: system, name: "</script><script>alert(1)</script>" }\n')
  await exportSite({ dir, ui, out })
  const html = await readFile(join(out, 'index.html'), 'utf8')
  assert.doesNotMatch(html, /alert\(1\)<\/script>/)
  const state = stateIn(html) as { model: { objects: { shop: { name: string } } } }
  assert.equal(state.model.objects.shop.name, '</script><script>alert(1)</script>')
})

test('a file that cannot be read stops the export, and nothing is written', async t => {
  const { dir, ui, out } = await setup(t)
  await writeFile(join(dir, 'model.yaml'), 'objects: [\n')
  await assert.rejects(exportSite({ dir, ui, out }), (e: unknown) => e instanceof ParseError && e.file === 'model.yaml')
  assert.equal(await exists(out), false)
})

test('problems do not stop an export', async t => {
  const { dir, ui, out } = await setup(t)
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  web: { type: app, name: Web app }\n')
  assert.deepEqual(await exportSite({ dir, ui, out }), { boxes: 1, flows: 0, problems: 1 })
})

test('a folder with other files in it is left alone', async t => {
  const { dir, ui, out } = await setup(t)
  await mkdir(out)
  await writeFile(join(out, 'notes.txt'), 'mine')
  await assert.rejects(exportSite({ dir, ui, out }), /has other files in it/)
  assert.equal(await readFile(join(out, 'notes.txt'), 'utf8'), 'mine')
})

test('an empty folder is used, and an earlier export is replaced', async t => {
  const { dir, ui, out } = await setup(t)
  await mkdir(out)
  await exportSite({ dir, ui, out })
  await writeFile(join(out, 'assets', 'old.js'), 'stale')
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop: { type: system, name: Shop }\n  mail: { type: system, name: Mail }\n')
  assert.deepEqual(await exportSite({ dir, ui, out }), { boxes: 2, flows: 0, problems: 0 })
  assert.equal(await exists(join(out, 'assets', 'old.js')), false)
})

test('the export folder may not hold the flowy folder', async t => {
  const { root, dir, ui } = await setup(t)
  await assert.rejects(exportSite({ dir, ui, out: root }), /holds the flowy folder/)
  assert.equal(await exists(join(dir, 'model.yaml')), true)
})

test('without a built canvas there is nothing to export', async t => {
  const { root, dir, out } = await setup(t)
  await assert.rejects(exportSite({ dir, ui: join(root, 'missing'), out }), /not built yet/)
  assert.equal(await exists(out), false)
})

test('a page without </head> is refused', () => {
  assert.throws(() => inlineState('<html><body></body></html>', { parseError: { file: 'model.yaml', message: 'x' } }), /no <\/head>/)
})
