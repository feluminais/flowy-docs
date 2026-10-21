import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeDetailsPanel, closePerfPanel, openDetailsPanel, openPerfPanel, rightPanel } from '../ui/src/rightpanel.ts'
import type { Right } from '../ui/src/rightpanel.ts'

const free = { perfAvailable: true, sidePicked: false }

test('the right side shows one panel: opening one takes the other\'s place', () => {
  assert.equal(openPerfPanel(), 'perf')
  assert.equal(openDetailsPanel(), 'details')
})

test('closing a panel leaves the other one alone', () => {
  assert.equal(closeDetailsPanel('details'), undefined)
  assert.equal(closeDetailsPanel('perf'), 'perf', 'a click that closes Details must not close Performance')
  assert.equal(closeDetailsPanel(undefined), undefined)
  assert.equal(closePerfPanel('perf'), undefined)
  assert.equal(closePerfPanel('details'), 'details')
})

test('what shows: Performance only where there is a run to show and editing allows it', () => {
  assert.deepEqual(rightPanel('perf', free), { perf: true, details: false, open: true })
  assert.deepEqual(rightPanel('perf', { ...free, perfAvailable: false }), { perf: false, details: false, open: false })
  assert.deepEqual(rightPanel('details', free), { perf: false, details: true, open: true })
  assert.deepEqual(rightPanel(undefined, free), { perf: false, details: false, open: false })
})

test('a picked shape opens Details, but Performance keeps the place while it is open', () => {
  const picked = { perfAvailable: true, sidePicked: true }
  assert.deepEqual(rightPanel(undefined, picked), { perf: false, details: true, open: true })
  assert.deepEqual(rightPanel('perf', picked), { perf: true, details: false, open: true })
  assert.deepEqual(rightPanel('perf', { perfAvailable: false, sidePicked: true }), { perf: false, details: true, open: true }, 'Performance cannot show, so Details does')
})

test('exclusion holds for every value and availability', () => {
  for (const right of ['details', 'perf', undefined] as Right[])
    for (const perfAvailable of [true, false])
      for (const sidePicked of [true, false]) {
        const shown = rightPanel(right, { perfAvailable, sidePicked })
        assert.equal(shown.perf && shown.details, false)
        assert.equal(shown.open, shown.perf || shown.details)
      }
})
