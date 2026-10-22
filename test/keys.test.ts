import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeStep, letter, takesEnter, undoesMove } from '../ui/src/keys.ts'

test('shortcuts follow the Latin letter typed, or the key on a US keyboard', () => {
  assert.equal(letter({ key: 'Z', code: 'KeyZ' }), 'z')
  assert.equal(letter({ key: 'я', code: 'KeyZ' }), 'z') // Ukrainian
  assert.equal(letter({ key: 'у', code: 'KeyE' }), 'e')
  assert.equal(letter({ key: 'k', code: 'KeyV' }), 'k') // Dvorak types k there
  assert.equal(letter({ key: 'Escape', code: 'Escape' }), 'Escape')
})

test('Enter stays with a focused button, link or disclosure summary, and goes to the canvas elsewhere', () => {
  // A stand-in element that answers closest() the way the DOM does: itself or an ancestor with one of the tags.
  const element = (...tags: string[]) => ({ closest: (selector: string) => (selector.split(', ').some(tag => tags.includes(tag)) ? {} : null) })
  assert.equal(takesEnter(element('summary')), true)
  assert.equal(takesEnter(element('span', 'button')), true, 'inside a button')
  assert.equal(takesEnter(element('a')), true)
  assert.equal(takesEnter(element('div')), false, 'a box on the canvas')
  assert.equal(takesEnter({}), false, 'the document has no closest()')
  assert.equal(takesEnter(null), false)
})

test('Escape closes one layer per press, then goes up a level', () => {
  const none = { shortcuts: false, navigator: false, flow: false, halfStep: false, panel: false, compare: false, inside: false }
  assert.equal(escapeStep({ ...none, shortcuts: true, navigator: true, flow: true, panel: true, inside: true }), 'shortcuts')
  assert.equal(escapeStep({ ...none, navigator: true, flow: true, panel: true, inside: true }), 'navigator', 'the last click was in the navigator')
  assert.equal(escapeStep({ ...none, flow: true, panel: true, inside: true }), 'flow', 'worked in the diagram: the navigator is left open')
  assert.equal(escapeStep({ ...none, halfStep: true, panel: true, inside: true }), 'step')
  assert.equal(escapeStep({ ...none, panel: true, inside: true }), 'panel')
  assert.equal(escapeStep({ ...none, compare: true, panel: true, inside: true }), 'panel', 'a panel over a comparison closes first')
  assert.equal(escapeStep({ ...none, compare: true, inside: true }), 'compare', 'before going up a level')
  assert.equal(escapeStep({ ...none, inside: true }), 'up')
  assert.equal(escapeStep(none), undefined, 'at the top with nothing open')
})

test('Esc and Backspace take back a box that was just dragged, only while editing and nothing else was done', () => {
  const state = { editing: true, justMoved: true, shortcuts: false, plain: true }
  assert.equal(undoesMove({ key: 'Escape' }, state), true)
  assert.equal(undoesMove({ key: 'Backspace' }, state), true)
  assert.equal(undoesMove({ key: 'z' }, state), false) // Z is for zooming out
  assert.equal(undoesMove({ key: 'Escape' }, { ...state, justMoved: false }), false)
  assert.equal(undoesMove({ key: 'Escape' }, { ...state, editing: false }), false)
  assert.equal(undoesMove({ key: 'Escape' }, { ...state, shortcuts: true }), false) // the shortcut list closes first
  assert.equal(undoesMove({ key: 'Backspace' }, { ...state, plain: false }), false) // Ctrl+Backspace is not it
})
