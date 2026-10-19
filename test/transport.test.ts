import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestOf, responseMessage } from '../src/core/host.ts'
import type { Outcome, Request } from '../src/core/host.ts'
import type { State } from '../src/core/state.ts'
import { hostTransport } from '../ui/src/transport.ts'

const state: State = { model: { objects: {}, connections: [], meta: {} }, layout: {}, flows: {}, problems: [], versions: {} }

/** A page and a host wired to each other: `answer` is what the host makes of each request, and its replies reach the page after `delay` ms. */
function wire(answer: (request: Request) => Outcome | undefined, delay = 0) {
  const seen: Request[] = []
  let deliver: (data: unknown) => void = () => undefined
  const transport = hostTransport(
    message => {
      const asked = requestOf(message)
      if (!asked) return
      seen.push(asked.request)
      const outcome = answer(asked.request)
      if (outcome) setTimeout(() => deliver(responseMessage(asked.id, outcome)), delay)
    },
    handler => { deliver = handler },
    50,
  )
  return { transport, seen, deliver: (data: unknown) => deliver(data) }
}

test("the page gets the folder's state from its host", async () => {
  const { transport, seen } = wire(() => ({ value: state }))
  assert.deepEqual(await transport.state(), state)
  assert.deepEqual(seen, [{ op: 'state' }])
})

test('a write goes to the host as it would go to the server, and its status and body come back', async () => {
  const { transport, seen } = wire(() => ({ value: { status: 409, body: { version: 'abc' } } }))
  const body = { version: null, data: { objects: {} } }
  assert.deepEqual(await transport.write('PUT', 'model.yaml', body), { status: 409, body: { version: 'abc' } })
  assert.deepEqual(seen, [{ op: 'write', method: 'PUT', file: 'model.yaml', body }])
})

test("a host that can't do it says why, and that is the error", async () => {
  const { transport } = wire(() => ({ error: "can't read model.yaml" }))
  await assert.rejects(transport.state(), { message: "can't read model.yaml" })
})

test('answers are matched to their requests whatever order they arrive in', async () => {
  const pending: Array<(outcome: Outcome) => void> = []
  let deliver: (data: unknown) => void = () => undefined
  const ids: number[] = []
  const transport = hostTransport(
    message => { const asked = requestOf(message)!; ids.push(asked.id); pending.push(outcome => deliver(responseMessage(asked.id, outcome))) },
    handler => { deliver = handler },
  )
  const first = transport.write('PUT', 'a.yaml', {})
  const second = transport.write('PUT', 'b.yaml', {})
  assert.equal(new Set(ids).size, 2)
  pending[1]({ value: { status: 200, body: 'second' } })
  pending[0]({ value: { status: 200, body: 'first' } })
  assert.deepEqual(await first, { status: 200, body: 'first' })
  assert.deepEqual(await second, { status: 200, body: 'second' })
})

test('messages that are not answers to a request are ignored', async () => {
  const { transport, deliver } = wire(() => ({ value: state }), 5)
  const asked = transport.state()
  for (const data of [undefined, { type: 'flowy-changed' }, responseMessage(999, { value: 'someone else' }), 'noise']) deliver(data)
  assert.deepEqual(await asked, state)
})

test("a host that never answers fails the request instead of leaving the edit queue stuck", async () => {
  const { transport } = wire(() => undefined)
  await assert.rejects(transport.state(), { message: "VS Code didn't answer" })
})
