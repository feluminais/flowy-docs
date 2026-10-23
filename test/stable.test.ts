import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keepSame, nothingKept, sameInside } from '../ui/src/stable.ts'

test('plain values say the same when their parts do, a few levels down', () => {
  assert.equal(sameInside({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } }), true)
  assert.equal(sameInside({ a: 1 }, { a: 2 }), false)
  assert.equal(sameInside({ a: 1 }, { a: 1, b: undefined }), false)
  assert.equal(sameInside([1, 2], [1, 2, 3]), false)
  const f = () => 1
  assert.equal(sameInside({ f }, { f }), true)
  assert.equal(sameInside({ f }, { f: () => 1 }), false, 'two functions are two')
  assert.equal(sameInside(new Date(0), new Date(0)), false, 'an instance is only itself')
})

test('an item that says the same keeps the object it was, and a changed one is the new one', () => {
  const first = keepSame(nothingKept, [{ id: 'a', x: { n: 1 } }, { id: 'b', x: { n: 2 } }])
  const [a, b] = first.list
  const next = keepSame(first, [{ id: 'a', x: { n: 1 } }, { id: 'b', x: { n: 3 } }])
  assert.equal(next.list[0], a)
  assert.notEqual(next.list[1], b)
  assert.deepEqual(next.list[1], { id: 'b', x: { n: 3 } })
})

test('a list in which nothing changed is the list it was; a shorter or longer one is not', () => {
  const first = keepSame(nothingKept, [{ id: 'a' }, { id: 'b' }])
  assert.equal(keepSame(first, [{ id: 'a' }, { id: 'b' }]), first)
  assert.notEqual(keepSame(first, [{ id: 'a' }]), first)
  assert.notEqual(keepSame(first, [{ id: 'b' }, { id: 'a' }]), first, 'the order is part of it')
})

test('an item that went away is not kept for later', () => {
  const first = keepSame(nothingKept, [{ id: 'a', n: 1 }])
  const gone = keepSame(first, [])
  const back = keepSame(gone, [{ id: 'a', n: 1 }])
  assert.notEqual(back.list[0], first.list[0])
})
