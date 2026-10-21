import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyModel } from '../src/core/model.ts'
import { serializeFile } from '../src/core/modelfiles.ts'
import { blockedMessage, firstBlocked, firstUnreadable } from '../src/node/commit.ts'
import type { Loaded } from '../src/node/files.ts'

const loaded = (...skipped: string[]): Loaded => ({
  model: emptyModel(),
  versions: {},
  ignored: [],
  failureProblems: skipped.map(file => ({ file, message: 'x' })),
})

test('a write is blocked by the skipped analysis file of the same name, in any letter case', () => {
  const l = loaded('failures/Orders.yaml')
  assert.deepEqual(firstBlocked(l, ['model.yaml', 'failures/orders.yaml']), { rel: 'failures/orders.yaml', blocking: 'failures/Orders.yaml' })
  assert.equal(firstBlocked(l, ['model.yaml', 'failures/other.yaml']), undefined)
  assert.equal(firstBlocked(loaded(), ['failures/orders.yaml']), undefined)
})

test('the refusal names the file in the way', () => {
  assert.match(blockedMessage('failures/a.yaml', 'failures/a.yaml'), /can't be read/)
  assert.match(blockedMessage('failures/A.yaml', 'failures/a.yaml'), /in the way/)
})

test('text that would not read back is found, and a deletion is never checked', () => {
  const good = serializeFile('model.yaml', { objects: {}, connections: [] })
  assert.equal(firstUnreadable([['model.yaml', good], ['flows/gone.yaml', null]]), undefined)
  const bad = firstUnreadable([['model.yaml', good], ['flows/broken.yaml', 'name: [unclosed']])
  assert.equal(bad?.rel, 'flows/broken.yaml')
  assert.ok(bad?.error instanceof Error)
})
