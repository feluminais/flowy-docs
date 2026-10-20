import { test } from 'node:test'
import assert from 'node:assert/strict'
import { active, bump, cyclePeriod, distance, ease, labelOffset, progress, REST, tubeOpacity } from '../ui/src/motion.ts'

const beat = { at: 100, dur: 400 }

test('progress is how far through a beat a moment is, held at the ends', () => {
  assert.equal(progress(beat, 0), 0)
  assert.equal(progress(beat, 100), 0)
  assert.equal(progress(beat, 300), 0.5)
  assert.equal(progress(beat, 500), 1)
  assert.equal(progress(beat, 9000), 1)
})

test('a beat is active from its start up to, but not including, its end', () => {
  assert.equal(active(beat, 99), false)
  assert.equal(active(beat, 100), true)
  assert.equal(active(beat, 499), true)
  assert.equal(active(beat, 500), false)
})

test('ease is slow at both ends and fair in the middle', () => {
  assert.equal(ease(0), 0)
  assert.equal(ease(1), 1)
  assert.equal(ease(0.5), 0.5)
  assert.ok(ease(0.1) < 0.1)
  assert.ok(ease(0.9) > 0.9)
})

test('bump is 0 at the ends and 1 in the middle', () => {
  assert.equal(bump(0), 0)
  assert.ok(Math.abs(bump(1)) < 1e-9)
  assert.equal(bump(0.5), 1)
})

test('the tube fades in over 150 ms and out over 250 ms', () => {
  const tube = { at: 0, dur: 1000 }
  assert.equal(tubeOpacity(tube, 0), 0)
  assert.equal(tubeOpacity(tube, 75), 0.5)
  assert.equal(tubeOpacity(tube, 500), 1)
  assert.equal(tubeOpacity(tube, 875), 0.5)
  assert.equal(tubeOpacity(tube, 1000), 0)
  assert.equal(tubeOpacity(tube, 2000), 0)
})

test('a blob runs forward from the start of the line and back from its end', () => {
  assert.equal(distance('fwd', 0, 200), 0)
  assert.equal(distance('fwd', 1, 200), 200)
  assert.equal(distance('fwd', 0.5, 200), 100)
  assert.equal(distance(undefined, 1, 200), 200)
  assert.equal(distance('back', 0, 200), 200)
  assert.equal(distance('back', 1, 200), 0)
})

test('steps that play together loop together: the longest one, then a rest', () => {
  assert.equal(cyclePeriod([1900]), 1900 + REST)
  assert.equal(cyclePeriod([1900, 3550, 2250]), 3550 + REST)
  assert.equal(cyclePeriod([]), REST)
})

test('a label moves off the pipe, to the upper side of the line and further for a long label on a steep one', () => {
  const flat = labelOffset(300, 0, 5)
  assert.equal(flat.x, 0)
  assert.equal(flat.y, -(15 + 6 + 10))
  assert.deepEqual(labelOffset(-300, 0, 5), flat) // a line drawn the other way has the same upper side
  const steep = labelOffset(0, 300, 5)
  assert.equal(steep.y, 0) // a vertical line's label goes to its right
  assert.equal(steep.x, 15 + 6 + 5 * 3 + 6)
  assert.ok(labelOffset(0, 300, 20).x > steep.x)
  assert.ok(labelOffset(100, 100, 10).y < 0) // up, on any slope
  assert.deepEqual(labelOffset(0, 0, 4), { x: 0, y: -31 })
})
