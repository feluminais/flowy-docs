import { test } from 'node:test'
import assert from 'node:assert/strict'
import { letter } from '../ui/src/keys.ts'

test('shortcuts follow the Latin letter typed, or the key on a US keyboard', () => {
  assert.equal(letter({ key: 'Z', code: 'KeyZ' }), 'z')
  assert.equal(letter({ key: 'я', code: 'KeyZ' }), 'z') // Ukrainian
  assert.equal(letter({ key: 'у', code: 'KeyE' }), 'e')
  assert.equal(letter({ key: 'k', code: 'KeyV' }), 'k') // Dvorak types k there
  assert.equal(letter({ key: 'Escape', code: 'Escape' }), 'Escape')
})
