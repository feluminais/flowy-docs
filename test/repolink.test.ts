import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opensEditor, repoLink } from '../ui/src/repolink.ts'
import type { Modifiers } from '../ui/src/repolink.ts'

const BASE = 'https://github.com/o/r/blob/main/'
const plain: Modifiers = { ctrlKey: false, metaKey: false }
const ctrl: Modifiers = { ctrlKey: true, metaKey: false }
const cmd: Modifiers = { ctrlKey: false, metaKey: true }

/** Where a click on a path goes: the editor, the repo host's page (its address), or nowhere. */
function destination(path: string, codeBase: string | undefined, editor: boolean, mods: Modifiers): string {
  const link = repoLink(path, codeBase, editor)
  if (!link) return 'text'
  return opensEditor(link, mods) ? 'editor' : link.href ?? 'nowhere'
}

test('in the editor, a plain click opens the file there and the tooltip says so, and says what Ctrl or Cmd does', () => {
  const link = repoLink('src/a b.ts', BASE, true)
  assert.equal(link?.href, `${BASE}src/a%20b.ts`)
  assert.match(link!.title, /^Open in the editor/)
  assert.match(link!.title, /Ctrl\/Cmd-click: open the repository page/)
  assert.equal(destination('src/a b.ts', BASE, true, plain), 'editor')
  assert.equal(destination('src/a b.ts', BASE, true, ctrl), `${BASE}src/a%20b.ts`)
  assert.equal(destination('src/a b.ts', BASE, true, cmd), `${BASE}src/a%20b.ts`)
})

test('in the editor with no repository page, every click opens the editor and the tooltip promises nothing else', () => {
  const link = repoLink('src/', undefined, true)
  assert.equal(link?.href, undefined)
  assert.equal(link?.title, 'Open in the editor')
  for (const mods of [plain, ctrl, cmd]) assert.equal(destination('src/', undefined, true, mods), 'editor')
  assert.equal(destination('src/', '', true, ctrl), 'editor') // an empty origin is none
})

test('outside the editor the link is the repository page, whatever is held, and never claims to open the editor', () => {
  const link = repoLink('src/core/', BASE, false)
  assert.equal(link?.editor, false)
  assert.equal(link?.title, 'Open the repository page')
  assert.doesNotMatch(link!.title, /editor/i)
  for (const mods of [plain, ctrl, cmd]) assert.equal(destination('src/core/', BASE, false, mods), `${BASE}src/core/`)
})

test('with neither an editor nor a repository page a path is plain text', () => {
  assert.equal(repoLink('src/a.ts', undefined, false), undefined)
  assert.equal(repoLink('src/a.ts', '', false), undefined)
  for (const mods of [plain, ctrl, cmd]) assert.equal(destination('src/a.ts', undefined, false, mods), 'text')
})
