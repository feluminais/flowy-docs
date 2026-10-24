import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ParseError } from '../src/core/model.ts'
import { exportSite, inlineState } from '../src/node/export.ts'
import { loadState } from '../src/node/files.ts'
import { readSnapshot, yamlOf } from '../src/node/history.ts'

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

const yamlNow = async (dir: string) => yamlOf(await readSnapshot(dir))
const exists = (path: string) => access(path).then(() => true, () => false)

test('an export is the built canvas with the state in its page', async t => {
  const { dir, ui, out } = await setup(t)
  assert.deepEqual(await exportSite({ dir, ui, out }), { boxes: 1, flows: 0, problems: 0 })
  assert.equal(await readFile(join(out, 'assets', 'app.js'), 'utf8'), 'console.log("canvas")\n')
  assert.deepEqual(stateIn(await readFile(join(out, 'index.html'), 'utf8')), { ...(await loadState(dir)), yaml: await yamlNow(dir) })
})

test('an export carries the files as text, for the YAML tab', async t => {
  const { dir, ui, out } = await setup(t)
  await mkdir(join(dir, 'flows'))
  await writeFile(join(dir, 'flows', 'buy.yaml'), 'steps: []\n')
  await exportSite({ dir, ui, out })
  const { yaml } = stateIn(await readFile(join(out, 'index.html'), 'utf8')) as { yaml: { files: Record<string, unknown>; versions: Record<string, string> } }
  assert.deepEqual(yaml.files, { 'model.yaml': { text: 'objects:\n  shop: { type: system, name: Shop }\n' }, 'flows/buy.yaml': { text: 'steps: []\n' } })
  assert.deepEqual(Object.keys(yaml.versions), ['model.yaml', 'flows/buy.yaml'])
})

test('text in the model cannot end the state element early', async t => {
  const { dir, ui, out } = await setup(t)
  const name = '</script><!--<script>alert(1)</script>'
  await writeFile(join(dir, 'model.yaml'), `objects:\n  shop: { type: system, name: "${name}" }\n`)
  await exportSite({ dir, ui, out })
  const html = await readFile(join(out, 'index.html'), 'utf8')
  assert.doesNotMatch(/id="flowy-state">(.*?)<\/script>/s.exec(html)?.[1] ?? '', /</)
  const state = stateIn(html) as { model: { objects: { shop: { name: string } } } }
  assert.equal(state.model.objects.shop.name, name)
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
  await writeFile(join(root, 'index.html'), '<script type="application/json" id="flowy-state">{}</script>')
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

test('a link to the folder that holds the flowy folder is refused too', async t => {
  const { root, dir, ui } = await setup(t)
  await writeFile(join(root, 'index.html'), '<script type="application/json" id="flowy-state">{}</script>')
  const link = join(root, 'link')
  await symlink(root, link, 'junction')
  await assert.rejects(exportSite({ dir, ui, out: link }), /holds the flowy folder/)
})

test('an export that fails leaves the earlier one as it was', async t => {
  const { dir, ui, out } = await setup(t)
  await exportSite({ dir, ui, out })
  const before = await readFile(join(out, 'index.html'), 'utf8')
  await writeFile(join(dir, 'model.yaml'), 'objects: [\n')
  await assert.rejects(exportSite({ dir, ui, out }), ParseError)
  assert.equal(await readFile(join(out, 'index.html'), 'utf8'), before)
})

test('files added next to an export stay, and a folder with only hidden files counts as empty', async t => {
  const { dir, ui, out } = await setup(t)
  await mkdir(join(out, '.git'), { recursive: true })
  await writeFile(join(out, '.git', 'HEAD'), 'ref: refs/heads/gh-pages\n')
  await exportSite({ dir, ui, out })
  await writeFile(join(out, 'CNAME'), 'docs.example.com\n')
  await exportSite({ dir, ui, out })
  assert.equal(await readFile(join(out, '.git', 'HEAD'), 'utf8'), 'ref: refs/heads/gh-pages\n')
  assert.equal(await readFile(join(out, 'CNAME'), 'utf8'), 'docs.example.com\n')
})

test('a missing or empty flowy folder is refused, so a wrong --dir cannot replace an export', async t => {
  const { root, ui, out } = await setup(t)
  await assert.rejects(exportSite({ dir: join(root, 'nope'), ui, out }), /has no model\.yaml/)
  await mkdir(join(root, 'empty'))
  await assert.rejects(exportSite({ dir: join(root, 'empty'), ui, out }), /has no model\.yaml/)
  assert.equal(await exists(out), false)
})

test('an export carries the failure analyses and what is wrong with the files that could not be read', async t => {
  const { dir, ui, out } = await setup(t)
  await mkdir(join(dir, 'failures'))
  await writeFile(join(dir, 'failures', 'ordering.yaml'), 'name: Ordering\nmodes:\n  down:\n    mode: The shop is down\n    on: shop\n    severity: 10\n')
  await writeFile(join(dir, 'failures', 'bad.yaml'), 'name: [unclosed\n')
  await exportSite({ dir, ui, out })
  const state = stateIn(await readFile(join(out, 'index.html'), 'utf8')) as { failures: { ordering: { name: string } }; failureProblems: { file: string }[] }
  assert.equal(state.failures.ordering.name, 'Ordering')
  assert.deepEqual(state.failureProblems.map(p => p.file), ['failures/bad.yaml'])
  assert.deepEqual(state, { ...(await loadState(dir)), yaml: await yamlNow(dir) })
})

test('a file, or a folder overlapping the built canvas, cannot take an export', async t => {
  const { root, dir, ui } = await setup(t)
  await writeFile(join(root, 'file.txt'), 'x')
  await assert.rejects(exportSite({ dir, ui, out: join(root, 'file.txt') }), /is a file/)
  await assert.rejects(exportSite({ dir, ui, out: ui }), /overlaps the built canvas/)
  await assert.rejects(exportSite({ dir, ui, out: join(ui, 'site') }), /overlaps the built canvas/)
})

test('an exported page carries the server\'s policy, since a static host sends none', () => {
  const page = inlineState('<html><head><title>Flowy</title></head><body></body></html>', { parseError: { file: 'model.yaml', message: 'x' } })
  assert.match(page, /^<html><head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; [^"]*img-src 'self' data:[^"]*"><title>/)
})
