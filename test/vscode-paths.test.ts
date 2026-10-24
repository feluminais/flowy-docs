import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { repoFile, repoPath } from '../vscode/src/paths.ts'

const root = resolve('repo-root')

test("a path in the repo, as a shape's code lists it, is a place on disk", () => {
  assert.equal(repoFile(root, 'apps/web/src/cart.ts'), join(root, 'apps', 'web', 'src', 'cart.ts'))
  assert.equal(repoFile(root, 'apps/web/'), join(root, 'apps', 'web')) // a folder
  assert.equal(repoFile(root, 'README.md'), join(root, 'README.md'))
  assert.equal(repoFile(root, '..cache/x.ts'), join(root, '..cache', 'x.ts')) // a name that starts with two dots is not ".."
})

test('anything that is not a plain relative path in the repo is nowhere', () => {
  for (const path of ['', '/', '/etc/passwd', 'C:/Windows', 'c:\\x', 'apps\\web', '../outside', 'apps/../../outside', './here', 'apps//web', 'a/./b'])
    assert.equal(repoFile(root, path), undefined, path)
})

test("a file on disk is a path in the repo, with / between folders, when it is inside the repo", () => {
  assert.equal(repoPath(root, join(root, 'apps', 'web', 'a.ts')), 'apps/web/a.ts')
  assert.equal(repoPath(root, join(root, 'README.md')), 'README.md')
  assert.equal(repoPath(root, join(root, '..cache', 'x.ts')), '..cache/x.ts')
})

test('the repo itself, a sibling folder that starts the same, and anything outside are not in it', () => {
  assert.equal(repoPath(root, root), undefined)
  assert.equal(repoPath(root, `${root}2`), undefined)
  assert.equal(repoPath(root, join(`${root}2`, 'a.ts')), undefined)
  assert.equal(repoPath(root, resolve(root, '..', 'elsewhere', 'a.ts')), undefined)
})

test('a link inside the repo that points out of it leads nowhere', async t => {
  const base = await mkdtemp(join(tmpdir(), 'flowy-vscode-'))
  t.after(() => rm(base, { recursive: true, force: true }))
  const repo = join(base, 'repo')
  await mkdir(join(repo, 'src'), { recursive: true })
  await mkdir(join(base, 'outside'))
  await writeFile(join(base, 'outside', 'secret.txt'), 'x')
  await symlink(join(base, 'outside'), join(repo, 'docs'), 'junction') // a junction on Windows needs no privilege
  assert.equal(repoFile(repo, 'docs/secret.txt'), undefined)
  assert.equal(repoFile(repo, 'docs/'), undefined)
  assert.equal(repoFile(repo, 'src/new.ts'), join(repo, 'src', 'new.ts')) // a file that doesn't exist yet is still in the repo
})
