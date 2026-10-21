import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedMessage, copyMessage, isChanged, openMessage, openUrlMessage, pathToOpen, requestMessage, requestOf, responseMessage, responseOf, revealMessage, revealOf, textToCopy, urlToOpen } from '../src/core/host.ts'

test('a page asks its host to copy text, and the host reads it back', () => {
  assert.equal(textToCopy(copyMessage('```mermaid\ngraph TD\n```\n')), '```mermaid\ngraph TD\n```\n')
  assert.equal(textToCopy(copyMessage('')), '')
})

test('any other message asks for nothing to be copied', () => {
  for (const data of [undefined, null, 'flowy-copy', 3, [], {}, { type: 'other', text: 'x' }, { type: 'flowy-copy' }, { type: 'flowy-copy', text: 5 }])
    assert.equal(textToCopy(data), undefined, JSON.stringify(data))
})

test('a page asks for the state or for a write, and the host reads the request back', () => {
  assert.deepEqual(requestOf(requestMessage(0, { op: 'state' })), { id: 0, request: { op: 'state' } })
  const write = { op: 'write', method: 'PUT', file: 'model.yaml', body: { version: null, data: { objects: {} } } } as const
  assert.deepEqual(requestOf(requestMessage(7, write)), { id: 7, request: write })
  const del = { op: 'write', method: 'DELETE', file: 'flows/tour.yaml', body: { version: 'abc' } } as const
  assert.deepEqual(requestOf(requestMessage(8, del)), { id: 8, request: del })
})

test('what is not a well-formed request is not one', () => {
  const ok = { type: 'flowy-request', id: 1, request: { op: 'state' } }
  assert.ok(requestOf(ok))
  for (const data of [
    undefined, null, 'x', [], {}, { type: 'other', id: 1, request: { op: 'state' } },
    { ...ok, id: -1 }, { ...ok, id: 1.5 }, { ...ok, id: '1' }, { type: 'flowy-request', request: { op: 'state' } },
    { ...ok, request: null }, { ...ok, request: { op: 'delete-everything' } },
    { ...ok, request: { op: 'write', method: 'PATCH', file: 'model.yaml', body: {} } },
    { ...ok, request: { op: 'write', method: 'PUT', file: 3, body: {} } },
    { ...ok, request: { op: 'write', method: 'PUT', body: {} } },
  ])
    assert.equal(requestOf(data), undefined, JSON.stringify(data))
})

test('the host answers a request with a value or an error, and the page reads the answer back', () => {
  assert.deepEqual(responseOf(responseMessage(3, { value: { status: 200, body: { version: 'abc' } } })), { id: 3, outcome: { value: { status: 200, body: { version: 'abc' } } } })
  assert.deepEqual(responseOf(responseMessage(4, { error: "can't read it" })), { id: 4, outcome: { error: "can't read it" } })
  for (const data of [undefined, null, {}, { type: 'flowy-response', id: 1 }, { type: 'flowy-response', value: 1 }, { type: 'flowy-response', id: 1, error: 5 }, { type: 'other', id: 1, value: 1 }])
    assert.equal(responseOf(data), undefined, JSON.stringify(data))
})

test('the host tells the page the folder changed', () => {
  assert.equal(isChanged(changedMessage()), true)
  for (const data of [undefined, null, {}, 'flowy-changed', { type: 'flowy-request' }])
    assert.equal(isChanged(data), false, JSON.stringify(data))
})

test('a page asks its host to open a path in the editor, and the host reads it back', () => {
  assert.equal(pathToOpen(openMessage('apps/web/src/cart.ts')), 'apps/web/src/cart.ts')
  assert.equal(pathToOpen(openMessage('apps/web/')), 'apps/web/')
  for (const data of [undefined, null, 'flowy-open', {}, { type: 'other', path: 'a' }, { type: 'flowy-open' }, { type: 'flowy-open', path: 3 }, { type: 'flowy-open', path: '' }])
    assert.equal(pathToOpen(data), undefined, JSON.stringify(data))
})

test('the host tells the page to show a shape or a flow, and the page reads it back', () => {
  assert.deepEqual(revealOf(revealMessage({ shape: 'cart' })), { shape: 'cart' })
  assert.deepEqual(revealOf(revealMessage({ flow: 'buy' })), { flow: 'buy' })
  for (const data of [undefined, null, {}, { type: 'other', target: { shape: 'a' } }, { type: 'flowy-reveal' }, { type: 'flowy-reveal', target: null },
    { type: 'flowy-reveal', target: {} }, { type: 'flowy-reveal', target: { shape: 3 } }, { type: 'flowy-reveal', target: { shape: '' } }, { type: 'flowy-reveal', target: { flow: [] } }])
    assert.equal(revealOf(data), undefined, JSON.stringify(data))
})

test('a page asks its host to open a web address, and the host reads back only http(s) ones', () => {
  assert.equal(urlToOpen(openUrlMessage('https://github.com/o/r/blob/main/a%20b.ts')), 'https://github.com/o/r/blob/main/a%20b.ts')
  assert.equal(urlToOpen(openUrlMessage('http://localhost:3000/x')), 'http://localhost:3000/x')
  for (const data of [undefined, null, 'flowy-open-url', {}, { type: 'other', url: 'https://a.b' }, { type: 'flowy-open-url' }, { type: 'flowy-open-url', url: 3 },
    { type: 'flowy-open-url', url: '' }, { type: 'flowy-open-url', url: 'file:///etc/passwd' }, { type: 'flowy-open-url', url: 'command:workbench.action.reloadWindow' },
    { type: 'flowy-open-url', url: 'javascript:alert(1)' }, { type: 'flowy-open-url', url: 'https://a.b c' }])
    assert.equal(urlToOpen(data), undefined, JSON.stringify(data))
})
