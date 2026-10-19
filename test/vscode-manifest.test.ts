import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
const manifest = JSON.parse(await read('vscode/package.json')) as {
  name: string; publisher: string; version: string; main: string; icon: string; private?: boolean
  engines: { vscode: string }; devDependencies: Record<string, string>
  activationEvents: string[]; scripts: Record<string, string>
  contributes: { commands: { command: string; title: string }[]; menus: Record<string, { command: string }[]> }
}

const numbers = (version: string) => version.replace(/^[^\d]*/, '').split('.').map(Number)
const compare = (a: number[], b: number[]) => a.reduce((diff, n, i) => diff || n - b[i], 0)

test('every command the manifest offers is registered, and every command registered is offered', async () => {
  const registered = [...(await read('vscode/src/extension.ts')).matchAll(/registerCommand\('([^']+)'/g)].map(m => m[1]).sort()
  const offered = manifest.contributes.commands.map(c => c.command).sort()
  assert.deepEqual(offered, registered)
})

test('every menu entry is for a command the manifest offers', () => {
  const offered = new Set(manifest.contributes.commands.map(c => c.command))
  for (const [menu, entries] of Object.entries(manifest.contributes.menus))
    for (const { command } of entries) assert.ok(offered.has(command), `${menu} names ${command}, which is not contributed`)
})

test('the extension wakes for the panels it makes, so VS Code can restore them', async () => {
  const viewType = /export const VIEW_TYPE = '([^']+)'/.exec(await read('vscode/src/panel.ts'))?.[1]
  assert.ok(viewType, 'no VIEW_TYPE in panel.ts')
  assert.ok(manifest.activationEvents.includes(`onWebviewPanel:${viewType}`))
})

test("the manifest's main is the file the build writes", async () => {
  const outfile = /outfile: here\('([^']+)'\)/.exec(await read('vscode/build.ts'))?.[1]
  assert.equal(`./${outfile}`, manifest.main)
})

test('the icon is a PNG of at least 128 by 128, as the Marketplace asks', async () => {
  const bytes = await readFile(new URL(`../vscode/${manifest.icon}`, import.meta.url))
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG')
  assert.ok(bytes.readUInt32BE(16) >= 128 && bytes.readUInt32BE(20) >= 128, `${bytes.readUInt32BE(16)} by ${bytes.readUInt32BE(20)}`)
})

test('what the package carries is what the extension needs, and nothing else', async () => {
  const lines = (await read('vscode/.vscodeignore')).split(/\r?\n/).filter(Boolean)
  assert.equal(lines[0], '**', 'everything is left out unless a line below lets it in')
  const kept = lines.slice(1)
  assert.ok(kept.every(line => line.startsWith('!')))
  for (const needed of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', manifest.icon, manifest.main.replace(/^\.\//, ''), 'dist/THIRD-PARTY-LICENSES.md', 'media/**'])
    assert.ok(kept.includes(`!${needed}`), `${needed} is left out of the package`)
  assert.ok(!kept.some(line => /node_modules|\.map|src/.test(line)))
})

test("the manifest can be published: it names a publisher, a name and a version, and is not private", () => {
  assert.ok(manifest.publisher && manifest.name && /^\d+\.\d+\.\d+$/.test(manifest.version))
  assert.notEqual(manifest.private, true)
})

test("the engine VS Code must be is at least the one the types are for", () => {
  assert.ok(compare(numbers(manifest.engines.vscode), numbers(manifest.devDependencies['@types/vscode'])) >= 0, `${manifest.engines.vscode} against ${manifest.devDependencies['@types/vscode']}`)
})

test("the extension's licence and changelog are in step with the repo's", async () => {
  assert.equal((await read('vscode/LICENSE')).replace(/\r\n/g, '\n'), (await read('LICENSE')).replace(/\r\n/g, '\n'))
  assert.match(await read('vscode/CHANGELOG.md'), new RegExp(`^## ${manifest.version.replace(/\./g, '\\.')}$`, 'm'))
})

test("the README's pictures are in the extension's folder, and the package script says where they will be on GitHub", async () => {
  const readme = await read('vscode/README.md')
  const pictures = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map(m => m[1])
  assert.ok(pictures.length > 0)
  for (const picture of pictures.filter(p => !/^https?:/.test(p)))
    assert.ok((await readFile(new URL(`../vscode/${picture}`, import.meta.url))).length > 0, `${picture} is missing`)
  // vsce reads a relative picture as if the extension were the whole repo, which it is not: vscode/ is a folder of it.
  assert.match(manifest.scripts.package, /--baseImagesUrl https:\/\/github\.com\/[^/]+\/[^/]+\/raw\/HEAD\/vscode(\s|$)/)
})
