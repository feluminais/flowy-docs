import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findObjects } from '../ui/src/search.ts'
import { shop } from './fixtures.ts'

test('search finds boxes by name or id, names that start with it first', () => {
  const m = shop()
  assert.deepEqual(findObjects(m, 'a'), ['api', 'auth', 'web', 'mail'])
  assert.deepEqual(findObjects(m, 'or'), ['db', 'orders'])
  assert.deepEqual(findObjects(m, 'WEB'), ['web'])
  assert.deepEqual(findObjects(m, 'db'), ['db'])
  assert.deepEqual(findObjects(m, 'mail serv'), ['mail'])
})

test('an empty query finds nothing, and the list stops at the limit', () => {
  assert.deepEqual(findObjects(shop(), '  '), [])
  assert.deepEqual(findObjects(shop(), 'a', 2), ['api', 'auth'])
  assert.deepEqual(findObjects(shop(), 'zzz'), [])
})
