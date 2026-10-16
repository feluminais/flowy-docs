import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeBaseFrom } from '../src/node/git.ts'

test('a GitHub or GitLab origin gives a link base for the branch and folder', () => {
  for (const remote of ['https://github.com/acme/shop.git', 'git@github.com:acme/shop.git', 'ssh://git@github.com/acme/shop', 'https://token@github.com/acme/shop/'])
    assert.equal(codeBaseFrom(remote, 'main', ''), 'https://github.com/acme/shop/tree/main/', remote)
  assert.equal(codeBaseFrom('git@gitlab.com:group/sub/shop.git', 'dev', 'docs/'), 'https://gitlab.com/group/sub/shop/-/tree/dev/docs/')
  assert.equal(codeBaseFrom('https://github.com/acme/shop', 'feat/a b', ''), 'https://github.com/acme/shop/tree/feat/a%20b/')
})

test('other hosts give no link base', () => {
  for (const remote of ['', 'https://example.com/acme/shop.git', 'file:///repos/shop', 'https://github.com.evil.io/acme/shop'])
    assert.equal(codeBaseFrom(remote, 'main', ''), undefined, remote)
})
