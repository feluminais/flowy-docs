import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EDITORS, editorOf, editorUrl } from '../ui/src/editors.ts'
import { remoteOf } from '../ui/src/repolink.ts'

const BASE = 'https://github.com/o/r/tree/main/'

test('the GitHub button opens the path on the repository page, at its line when it has one', () => {
  const remote = remoteOf(BASE)
  assert.equal(remote?.name, 'GitHub')
  assert.equal(remote?.page('src/a b.ts'), `${BASE}src/a%20b.ts`)
  assert.equal(remote?.page('src/#x.ts', 42), `${BASE}src/%23x.ts#L42`)
  assert.equal(remote?.page('src/core/'), `${BASE}src/core/`)
})

test('a repo on GitLab gets a GitLab button, and a repo on neither gets none', () => {
  assert.equal(remoteOf('https://gitlab.com/g/p/-/tree/main/')?.name, 'GitLab')
  assert.equal(remoteOf(undefined), undefined)
  assert.equal(remoteOf(''), undefined)
})

test('an editor opens a file by its address, from where the repo is on disk, at its line', () => {
  const code = editorOf('vscode')
  assert.equal(editorUrl(code, String.raw`M:\Projects\Flowy Docs`, 'src/a.ts', 3), 'vscode://file/M:/Projects/Flowy%20Docs/src/a.ts:3')
  assert.equal(editorUrl(code, '/home/me/shop/', 'libs/x#y.ts'), 'vscode://file/home/me/shop/libs/x%23y.ts')
  assert.equal(editorUrl(editorOf('zed'), '/r', 'a.ts', 9), 'zed://file/r/a.ts:9')
  assert.equal(editorOf('nope'), EDITORS[0])
  assert.deepEqual(EDITORS.map(e => e.name), ['VS Code', 'Cursor', 'Windsurf', 'VSCodium', 'Zed'])
})
