import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { clearOutcome, httpHistory } from '../ui/src/historyclient.ts'

/** Runs the test with `fetch` answering as `answer` says, and puts the real one back after. */
function stubFetch(t: TestContext, answer: () => Promise<Response>) {
  const real = globalThis.fetch
  globalThis.fetch = (() => answer()) as typeof fetch
  t.after(() => { globalThis.fetch = real })
}

test('a cleared history says nothing', async t => {
  stubFetch(t, async () => new Response('{}', { status: 200 }))
  assert.equal(await clearOutcome(httpHistory('http://x')), undefined)
})

test('a refused clear says what failed and what the server answered', async t => {
  stubFetch(t, async () => new Response('{}', { status: 500 }))
  assert.equal(await clearOutcome(httpHistory('http://x')), "Couldn't clear history: the server answered 500")
})

test('a clear that cannot reach the server says so instead of rejecting', async t => {
  stubFetch(t, async () => { throw new TypeError('fetch failed') })
  assert.equal(await clearOutcome(httpHistory('http://x')), "Couldn't clear history: fetch failed")
})

test('the client itself rejects on a refused clear, which is what clearOutcome catches', async t => {
  stubFetch(t, async () => new Response('{}', { status: 409 }))
  await assert.rejects(httpHistory('http://x').clear(), /the server answered 409/)
})
