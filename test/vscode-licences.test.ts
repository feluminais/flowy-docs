import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { licencesOf, packageRoot } from '../vscode/licences.ts'

test("a file under node_modules belongs to the package whose folder holds it, scoped or not", () => {
  assert.equal(packageRoot(join('..', 'node_modules', 'yaml', 'dist', 'index.js')), join('..', 'node_modules', 'yaml'))
  assert.equal(packageRoot(join('a', 'node_modules', '@scope', 'pkg', 'lib', 'x.js')), join('a', 'node_modules', '@scope', 'pkg'))
  assert.equal(packageRoot(join('a', 'node_modules', 'outer', 'node_modules', 'inner', 'x.js')), join('a', 'node_modules', 'outer', 'node_modules', 'inner'))
})

test('a file that is not in a package belongs to none', () => {
  assert.equal(packageRoot(join('src', 'core', 'model.ts')), undefined)
  assert.equal(packageRoot(join('a', 'node_modules')), undefined)
  assert.equal(packageRoot(join('a', 'node_modules', '@scope')), undefined)
})

test('the notices list each bundled package once, with its licence text, and say when a package has none', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-licences-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const pkg = async (dir: string, manifest: object, files: Record<string, string> = {}) => {
    await mkdir(join(root, 'node_modules', dir), { recursive: true })
    await writeFile(join(root, 'node_modules', dir, 'package.json'), JSON.stringify(manifest))
    for (const [name, text] of Object.entries(files)) await writeFile(join(root, 'node_modules', dir, name), text)
  }
  await pkg('alpha', { name: 'alpha', version: '1.2.3', license: 'ISC' }, { LICENSE: 'Alpha licence text', 'index.js': '' })
  await pkg('@scope/beta', { name: '@scope/beta', version: '0.4.0', license: 'MIT' }, { 'LICENSE.md': 'Beta licence text' })
  await pkg('gamma', { name: 'gamma', version: '2.0.0', license: 'Apache-2.0' })

  const text = await licencesOf([
    join('node_modules', 'gamma', 'index.js'),
    join('node_modules', 'alpha', 'index.js'),
    join('node_modules', 'alpha', 'lib', 'more.js'), // a second file of the same package
    join('node_modules', '@scope', 'beta', 'x.js'),
    join('src', 'mine.ts'), // not a package
  ], root)

  assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map(m => m[1]), ['@scope/beta 0.4.0 (MIT)', 'alpha 1.2.3 (ISC)', 'gamma 2.0.0 (Apache-2.0)'])
  assert.ok(text.includes('Alpha licence text') && text.includes('Beta licence text'))
  assert.match(text, /## gamma 2\.0\.0 \(Apache-2\.0\)\n+No licence file came with this package/)
})
