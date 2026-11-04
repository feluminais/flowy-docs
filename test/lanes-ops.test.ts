import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEdit } from '../src/core/editlabel.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Connection, Model } from '../src/core/model.ts'
import { OpError, reorderConnections } from '../src/core/ops.ts'
import { computeView } from '../src/core/views.ts'

// Move up and Move down in the panel of a pair of lines side by side: the order of the connections in the file is the order of the lines, and this is how a reader changes it.

const labels = (m: Model) => m.connections.map(c => c.label)
const wlan = (): Model => ({
  ...emptyModel(),
  meta: { pairs: 'separate' },
  objects: { ui: { type: 'system', name: 'UI' }, management: { type: 'system', name: 'Management' }, linux: { type: 'system', name: 'Linux' } },
  connections: [
    { from: 'ui', to: 'management', label: 'one' }, { from: 'ui', to: 'management', label: 'two' }, { from: 'management', to: 'linux', label: 'apply' },
    { from: 'ui', to: 'management', label: 'three' }, { from: 'management', to: 'ui', label: 'four' },
  ] satisfies Connection[],
})

test('reorderConnections puts the connections before the one at the place, in the order they had', () => {
  const m = wlan()
  assert.deepEqual(labels(reorderConnections(m, [1], 0)), ['two', 'one', 'apply', 'three', 'four']) // up
  assert.deepEqual(labels(reorderConnections(m, [1], 4)), ['one', 'apply', 'three', 'two', 'four']) // down, before the one after the next
  assert.deepEqual(labels(reorderConnections(m, [0], 5)), ['two', 'apply', 'three', 'four', 'one']) // to the end
  assert.deepEqual(labels(reorderConnections(m, [3, 0], 2)), ['two', 'one', 'three', 'apply', 'four']) // two together keep their order, whatever order they are named in
  assert.deepEqual(labels(reorderConnections(m, [0, 1], 4)), ['apply', 'three', 'one', 'two', 'four'])
})

test('a move that leaves the order as it is gives back the model itself', () => {
  const m = wlan()
  assert.equal(reorderConnections(m, [1], 1), m)
  assert.equal(reorderConnections(m, [1], 2), m)
  assert.equal(reorderConnections(m, [0, 1], 2), m)
  assert.equal(reorderConnections(m, [4], 5), m)
})

test('reorderConnections changes nothing but the order, and refuses places that are not there', () => {
  const m = wlan()
  const moved = reorderConnections(m, [3], 1)
  assert.deepEqual([...moved.connections].sort((a, b) => String(a.label).localeCompare(String(b.label))), [...m.connections].sort((a, b) => String(a.label).localeCompare(String(b.label))))
  assert.equal(moved.objects, m.objects)
  assert.equal(moved.flows, m.flows)
  assert.equal(m.connections[1].label, 'two') // the model it was given is not changed
  for (const [indexes, before] of [[[], 0], [[5], 0], [[-1], 0], [[1, 1], 0], [[1.5], 0], [[1], -1], [[1], 6], [[1], 0.5]] as [number[], number][]) {
    assert.throws(() => reorderConnections(m, indexes, before), OpError, `${indexes} before ${before}`)
  }
})

test('the lanes of a pair follow the order of the connections', () => {
  const lanesOf = (m: Model) => computeView(m, 'root').strands!.filter(s => s.pair === 'management ui').map(s => s.label)
  // ui is the later id of the pair, so the lines that run from it come first, then the one that runs from management; each group in the order of the file.
  assert.deepEqual(lanesOf(wlan()), ['one', 'two', 'three', 'four'])
  assert.deepEqual(lanesOf(reorderConnections(wlan(), [3], 0)), ['three', 'one', 'two', 'four'])
  assert.deepEqual(lanesOf(reorderConnections(wlan(), [1], 0)), ['two', 'one', 'three', 'four'])
  // Moving the one that runs the other way in front of the rest does not change which direction comes first.
  assert.deepEqual(lanesOf(reorderConnections(wlan(), [4], 0)), ['one', 'two', 'three', 'four'])
})

test('the history says the connections were reordered, and only when only their order changed', () => {
  const m = wlan()
  assert.equal(describeEdit(m, reorderConnections(m, [1], 0)), 'Reordered connections')
  assert.equal(describeEdit(m, reorderConnections(m, [4], 0)), 'Reordered connections')
  assert.equal(describeEdit(m, m), undefined)
  // Another change alongside it is named first and counted.
  const renamed = reorderConnections({ ...m, objects: { ...m.objects, ui: { type: 'system', name: 'Screen' } } }, [1], 0)
  assert.equal(describeEdit(m, renamed), 'Renamed UI to Screen and 1 other change')
  // Two identical connections swapped are the same model.
  const twins: Model = { ...m, connections: [{ from: 'ui', to: 'management', label: 'x' }, { from: 'ui', to: 'management', label: 'x' }] }
  assert.equal(describeEdit(twins, reorderConnections(twins, [1], 0)), undefined)
})
