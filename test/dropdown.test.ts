import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepRow, typedRow, typesCharacter } from '../ui/src/dropdown.ts'
import { keepsKeys } from '../ui/src/keys.ts'

test('the arrows move over the rows and stop at the ends', () => {
  assert.equal(stepRow(0, 1, 3), 1)
  assert.equal(stepRow(2, 1, 3), 2, 'the last row stays')
  assert.equal(stepRow(0, -1, 3), 0, 'the first row stays')
})

test('typing goes to the next row that starts with the letters', () => {
  const rows = ['None', 'Dispatch', 'Courier app', 'Fleet DB', 'Notifications']
  assert.equal(typedRow(rows, 'd', 0), 1)
  assert.equal(typedRow(rows, 'n', 0), 4, 'the next one after the row it is on')
  assert.equal(typedRow(rows, 'n', 4), 0, 'and round to the first')
  assert.equal(typedRow(rows, 'fl', 0), 3, 'several letters narrow it down')
  assert.equal(typedRow(rows, 'z', 0), -1)
})

test('a character is a letter or digit, not a command', () => {
  const press = (key: string, extra = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...extra })
  assert.equal(typesCharacter(press('p')), true)
  assert.equal(typesCharacter(press('Escape')), false)
  assert.equal(typesCharacter(press('p', { ctrlKey: true })), false)
})

test('a text field keeps its keys, and a checkbox, colour or slider that was clicked does not', () => {
  assert.equal(keepsKeys({ tagName: 'INPUT', type: 'text' }), true)
  assert.equal(keepsKeys({ tagName: 'INPUT', type: 'search' }), true)
  assert.equal(keepsKeys({ tagName: 'TEXTAREA' }), true)
  assert.equal(keepsKeys({ tagName: 'SELECT' }), true)
  assert.equal(keepsKeys({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(keepsKeys({ tagName: 'INPUT', type: 'checkbox' }), false)
  assert.equal(keepsKeys({ tagName: 'INPUT', type: 'color' }), false)
  assert.equal(keepsKeys({ tagName: 'INPUT', type: 'range' }), false)
  assert.equal(keepsKeys({ tagName: 'BUTTON' }), false)
  assert.equal(keepsKeys(null), false)
})
