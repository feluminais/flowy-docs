import { test } from 'node:test'
import assert from 'node:assert/strict'
import { largest, squashTile } from '../ui/src/motion.ts'

const tile = () => ({ style: { transform: '' } })

test('the largest of the squashes on a box wins, and none at all is none', () => {
  assert.equal(largest([]), 0)
  assert.equal(largest([0.2, 0.5, 0.1]), 0.5)
})

test('a box that two steps squash keeps the larger squash, whichever step writes last', () => {
  const el = tile()
  const [a, b] = [Symbol('a'), Symbol('b')]
  squashTile(el, a, 0.4)
  const big = el.style.transform
  assert.notEqual(big, '')
  squashTile(el, b, 0) // a step with nothing to squash must not clear the other's
  assert.equal(el.style.transform, big)
  squashTile(el, b, 0.1)
  assert.equal(el.style.transform, big)
  squashTile(el, a, 0)
  assert.notEqual(el.style.transform, '')
  assert.notEqual(el.style.transform, big)
  squashTile(el, b, 0)
  assert.equal(el.style.transform, '')
})

test('a squash scales wider and flatter in proportion', () => {
  const el = tile()
  squashTile(el, Symbol(), 1)
  assert.equal(el.style.transform, 'scale(1.07, 0.9)')
})
