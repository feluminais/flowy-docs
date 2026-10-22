import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startServer } from '../src/node/server.ts'

async function setup(t: import('node:test').TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-headers-'))
  const dir = join(root, 'flowy')
  const ui = join(root, 'ui')
  await mkdir(dir)
  await mkdir(join(ui, 'assets'), { recursive: true })
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop: { type: system, name: Shop }\n')
  await writeFile(join(ui, 'index.html'), '<!doctype html><title>x</title>')
  await writeFile(join(ui, 'assets', 'app.js'), 'export {}')
  const server = await startServer({ dir, ui, port: 0 })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  return `http://127.0.0.1:${server.port}`
}

test('every kind of answer says what the page may load, that it may not be framed, and not to sniff types', async t => {
  const base = await setup(t)
  for (const path of ['/', '/assets/app.js', '/api/state', '/nothing-here', '/api/nothing']) {
    const res = await fetch(base + path)
    const policy = res.headers.get('content-security-policy') ?? ''
    assert.match(policy, /default-src 'none'/, path)
    assert.match(policy, /img-src 'self' data:/, path)
    assert.match(policy, /connect-src 'self'/, path)
    assert.match(policy, /frame-ancestors 'none'/, path)
    assert.doesNotMatch(policy, /\*|https?:/, `${path} must name no outside source`)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path)
    assert.equal(res.headers.get('x-frame-options'), 'DENY', path)
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer', path)
    await res.arrayBuffer()
  }
})

test('the live-update stream carries the same headers', async t => {
  const base = await setup(t)
  const controller = new AbortController()
  t.after(() => controller.abort())
  const res = await fetch(`${base}/api/events`, { signal: controller.signal })
  assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  controller.abort()
})
