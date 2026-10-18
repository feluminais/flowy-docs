import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeStep, letter } from '../ui/src/keys.ts'

test('shortcuts follow the Latin letter typed, or the key on a US keyboard', () => {
  assert.equal(letter({ key: 'Z', code: 'KeyZ' }), 'z')
  assert.equal(letter({ key: 'я', code: 'KeyZ' }), 'z') // Ukrainian
  assert.equal(letter({ key: 'у', code: 'KeyE' }), 'e')
  assert.equal(letter({ key: 'k', code: 'KeyV' }), 'k') // Dvorak types k there
  assert.equal(letter({ key: 'Escape', code: 'Escape' }), 'Escape')
})

test('Escape closes one layer per press, then goes up a level', () => {
  const none = { shortcuts: false, flow: false, halfStep: false, panel: false, inside: false }
  assert.equal(escapeStep({ ...none, shortcuts: true, flow: true, panel: true, inside: true }), 'shortcuts')
  assert.equal(escapeStep({ ...none, flow: true, panel: true, inside: true }), 'flow')
  assert.equal(escapeStep({ ...none, halfStep: true, panel: true, inside: true }), 'step')
  assert.equal(escapeStep({ ...none, panel: true, inside: true }), 'panel')
  assert.equal(escapeStep({ ...none, inside: true }), 'up')
  assert.equal(escapeStep(none), undefined, 'at the top with nothing open')
})
