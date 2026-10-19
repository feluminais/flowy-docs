import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addsToSelection, banded, keepsSelection, toggled } from '../ui/src/selection.ts'

const none = { ctrlKey: false, metaKey: false, shiftKey: false }

test('Ctrl, Cmd and Shift add to a selection, a plain click replaces it', () => {
  assert.equal(addsToSelection(none), false)
  assert.equal(addsToSelection({ ...none, ctrlKey: true }), true)
  assert.equal(addsToSelection({ ...none, metaKey: true }), true)
  assert.equal(addsToSelection({ ...none, shiftKey: true }), true)
})

test('clicking with the key adds a shape, and clicking a picked one takes it out', () => {
  assert.deepEqual(toggled([], 'web'), ['web'])
  assert.deepEqual(toggled(['web'], 'api'), ['web', 'api'])
  assert.deepEqual(toggled(['web', 'api'], 'web'), ['api'])
  assert.deepEqual(toggled(['web'], 'web'), [])
})

test('drawing a box round shapes selects the ones it takes in and drops the ones it lets go', () => {
  const boxes = new Set(['web', 'api', 'db'])
  assert.deepEqual(banded([], [{ type: 'select', id: 'web', selected: true }, { type: 'select', id: 'api', selected: true }], boxes), ['web', 'api'])
  assert.deepEqual(banded(['web', 'api'], [{ type: 'select', id: 'web', selected: false }], boxes), ['api'])
})

test('a box drawn round shapes ignores the frame, outsiders, and changes that are not selections', () => {
  const boxes = new Set(['web', 'api'])
  const changes = [
    { type: 'select', id: 'frame', selected: true },
    { type: 'select', id: 'customer', selected: true }, // an outsider: drawn in the view, but not one of its own
    { type: 'dimensions', id: 'web' },
    { type: 'position', id: 'api' },
    { type: 'select', id: 'web', selected: true },
  ]
  assert.deepEqual(banded([], changes, boxes), ['web'])
})

test('pressing on one of several picked shapes keeps them, so a drag moves them all', () => {
  assert.equal(keepsSelection(['web', 'api'], 'web', false), true)
  assert.equal(keepsSelection(['web', 'api'], 'db', false), false, 'another shape starts over, or it would carry the others along')
  assert.equal(keepsSelection(['web', 'api'], 'db', true), true, 'with Ctrl held it is about to be added')
  assert.equal(keepsSelection(['web'], 'db', false), false, 'one shape is not several')
})
