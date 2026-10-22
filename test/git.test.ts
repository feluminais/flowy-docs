import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { codeBase, codeBaseFrom } from '../src/node/git.ts'

test('a GitHub or GitLab origin gives a link base for the branch and folder', () => {
  for (const remote of ['https://github.com/acme/shop.git', 'git@github.com:acme/shop.git', 'ssh://git@github.com/acme/shop', 'https://token@github.com/acme/shop/'])
    assert.equal(codeBaseFrom(remote, 'main', ''), 'https://github.com/acme/shop/tree/main/', remote)
  assert.equal(codeBaseFrom('git@gitlab.com:group/sub/shop.git', 'dev', 'docs/'), 'https://gitlab.com/group/sub/shop/-/tree/dev/docs/')
  assert.equal(codeBaseFrom('https://github.com/acme/shop', 'feat/a b', ''), 'https://github.com/acme/shop/tree/feat/a%20b/')
  assert.equal(codeBaseFrom('https://github.com/acme/shop', 'fix#12', 'C#/'), 'https://github.com/acme/shop/tree/fix%2312/C%23/')
})

test('other hosts give no link base', () => {
  for (const remote of ['', 'https://example.com/acme/shop.git', 'file:///repos/shop', 'https://github.com.evil.io/acme/shop'])
    assert.equal(codeBaseFrom(remote, 'main', ''), undefined, remote)
})

test('a GIT_DIR passed down by a parent git does not make another folder look like that repo', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'flowy-git-'))
  const before = process.env.GIT_DIR
  process.env.GIT_DIR = execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: import.meta.dirname, encoding: 'utf-8', env: { ...process.env, GIT_DIR: undefined } }).trim()
  t.after(async () => {
    if (before === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = before
    await rm(folder, { recursive: true, force: true })
  })
  assert.equal(await codeBase(folder), undefined)
})
