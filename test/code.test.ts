import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { codePaths, codeProblems, codeRefsOf, codeText, readCodeRef } from '../src/core/code.ts'
import { shapesFor } from '../src/core/finder.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { putFlow, setCode } from '../src/core/ops.ts'

test('a code entry is a path, or a file and the line to open it at', () => {
  assert.deepEqual(readCodeRef('src/api/orders.ts'), { path: 'src/api/orders.ts' })
  assert.deepEqual(readCodeRef('src/api/orders.ts:42'), { path: 'src/api/orders.ts', line: 42 })
  assert.deepEqual(readCodeRef('src/api/'), { path: 'src/api/' })
  for (const bad of ['src/api/:3', 'src/a.ts:0', 'src/a.ts:12345678', '../a.ts:3', '/abs.ts', 'a\\b.ts', 'src/a.ts:3:4', 'C:/x.ts']) assert.equal(readCodeRef(bad), undefined, bad)
  assert.equal(codeText({ path: 'a.ts', line: 7 }), 'a.ts:7')
  assert.deepEqual(codeRefsOf(['a.ts:2', 'bad/:1', 3, 'b/']), [{ path: 'a.ts', line: 2 }, { path: 'b/' }])
})

test('a code list says what is wrong with each entry, and a missing file by its path without the line', () => {
  assert.deepEqual(codeProblems(undefined, new Set()), [])
  assert.deepEqual(codeProblems('a.ts', new Set()), ['code must be a list of paths'])
  assert.deepEqual(codeProblems(['src/:3', 'a.ts:0', '../x', 'gone.ts:9', 'here.ts:9'], new Set(['gone.ts'])), [
    'code path "src/:3" is a folder, which has no lines',
    'code path "a.ts:0": the line must be a whole number from 1 to 9999999',
    'code path "../x" must be relative, with / between folders and no "." or ".." parts',
    'code path "gone.ts:9" doesn\'t exist',
  ])
})

const model = (): Model => {
  const m = emptyModel()
  m.objects = { web: { type: 'system', name: 'Web', code: ['web/:1'] }, api: { type: 'system', name: 'API' } }
  m.connections = [{ from: 'web', to: 'api', label: 'calls', code: ['web/client.ts:10'], payloads: [{ name: 'Order', about: 'x', code: ['types/order.ts'] }] }]
  m.meta = { payloads: { receipt: { about: 'A receipt.', code: ['types/receipt.ts:3'] } } }
  return putFlow(m, { id: 'buy', name: 'Buy', view: 'root', code: ['test/buy.test.ts'], steps: [{ from: 'web', to: 'api', text: 'Asks', code: ['api/orders.ts:5'] }] })
}

test('every part that takes code is checked, and the paths go to the file system once each', () => {
  const m = model()
  m.failures = { pay: { name: 'Pay', modes: { slow: { mode: 'It is slow', on: 'api', code: ['api/orders.ts:5', 'api/retry.ts'] } } } }
  assert.deepEqual(codePaths(m).sort(), ['api/orders.ts', 'api/retry.ts', 'test/buy.test.ts', 'types/order.ts', 'types/receipt.ts', 'web/client.ts'])
  const gone = new Set(['web/client.ts', 'types/order.ts', 'types/receipt.ts', 'test/buy.test.ts', 'api/orders.ts', 'api/retry.ts'])
  assert.deepEqual(check(m, gone).map(p => p.message), [
    'payload receipt: code path "types/receipt.ts:3" doesn\'t exist',
    'web: code path "web/:1" is a folder, which has no lines',
    'connection web → api: payload 1: code path "types/order.ts" doesn\'t exist',
    'connection web → api: code path "web/client.ts:10" doesn\'t exist',
    'code path "test/buy.test.ts" doesn\'t exist',
    'step 1: code path "api/orders.ts:5" doesn\'t exist',
    'slow: code path "api/orders.ts:5" doesn\'t exist',
    'slow: code path "api/retry.ts" doesn\'t exist',
  ])
})

test('setCode puts the list in place on each part, and an empty list takes it off', () => {
  let m = model()
  m = setCode(m, { object: 'web' }, [' web/ ', ''])
  assert.deepEqual(m.objects.web.code, ['web/'])
  m = setCode(m, { line: { from: 'web', to: 'api', label: 'calls' } }, [])
  assert.equal('code' in m.connections[0], false)
  m = setCode(m, { flow: 'buy', step: 0 }, ['api/orders.ts:6'])
  assert.deepEqual(m.flows.buy.steps[0].code, ['api/orders.ts:6'])
  assert.deepEqual(Object.keys(m.flows.buy), ['name', 'view', 'code', 'steps'])
  m = setCode(m, { payload: 'receipt' }, ['types/receipt.ts'])
  assert.deepEqual((m.meta.payloads as Record<string, { code: string[] }>).receipt.code, ['types/receipt.ts'])
  assert.throws(() => setCode(m, { flow: 'buy', step: 3 }, ['a.ts']), /has no step 4/)
})

test('a shape stands for the file a line of its code points into', () => {
  const m = emptyModel()
  m.objects = { api: { type: 'system', name: 'API', code: ['src/api.ts:30'] } }
  assert.deepEqual(shapesFor(m, 'src/api.ts'), ['api'])
})
