import { test } from 'node:test'
import assert from 'node:assert/strict'
import { active, bump, cyclePeriod, distance, ease, entryPoint, labelOffset, LIT_FLOOR, litOpacity, lowerSide, markerSize, markerSpot, noteSpot, progress, REST, tintColor, tubeOpacity } from '../ui/src/motion.ts'
import { beatsFor, TINTS } from '../src/core/animation.ts'
import { COLORS } from '../src/core/look.ts'

const beat = { at: 100, dur: 400 }

test('a timeout dims the lit line to a quarter over its fade and leaves it there', () => {
  const { beats } = beatsFor({ kind: 'call', trigger: 'inside', outcome: 'timeout' }, { length: 250, afterLanding: false })
  assert.equal(LIT_FLOOR, 0.25)
  for (const t of [0, 1000, 3250]) assert.equal(litOpacity(beats, t), 1, String(t))
  assert.equal(litOpacity(beats, 3550), 0.625)
  for (const t of [3850, 9000]) assert.equal(litOpacity(beats, t), 0.25, String(t))
})

test('beats with no fade leave the lit line at full strength', () => {
  const { beats } = beatsFor({ kind: 'call', trigger: 'inside', outcome: 'fail' }, { length: 250, afterLanding: false })
  for (const t of [0, 1000, 9000]) assert.equal(litOpacity(beats, t), 1, String(t))
})

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

test('a blob runs between the fractions of the line it is given, and waits where start is end', () => {
  assert.equal(distance('fwd', 0, 200, { end: 0.4 }), 0)
  assert.equal(distance('fwd', 1, 200, { end: 0.4 }), 80)
  assert.equal(distance('fwd', 0.5, 200, { end: 0.4 }), 40)
  assert.equal(distance('fwd', 1, 200, { start: 0.4 }), 200)
  assert.equal(distance('fwd', 0, 200, { start: 0.4 }), 80)
  // Back runs from the end of the span to its start, as a rejected request returns from the door.
  assert.equal(distance('back', 0, 200, { end: 0.92 }), 184)
  assert.equal(distance('back', 1, 200, { end: 0.92 }), 0)
  for (const p of [0, 0.3, 0.5, 1]) assert.equal(distance('fwd', p, 200, { start: 0.4, end: 0.4 }), 80, 'it waits')
  // No span is the whole line, exactly as before.
  for (const p of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
    assert.equal(distance('fwd', p, 333.3, {}), distance('fwd', p, 333.3))
    assert.equal(distance('fwd', p, 333.3), ease(p) * 333.3)
  }
})

test('a request that meets an outcome in a burst takes the colour of a shape colour name, for either theme', () => {
  assert.equal(tintColor(0), `light-dark(${COLORS[TINTS[0]][0]}, ${COLORS[TINTS[0]][1]})`)
  assert.equal(tintColor(TINTS.length), tintColor(0))
  assert.equal(tintColor(-1), tintColor(TINTS.length - 1))
  assert.equal(new Set(TINTS.map((_, i) => tintColor(i))).size, TINTS.length, 'every slot is a colour of its own')
  for (const taken of ['blue', 'red', 'amber', 'gray']) assert.equal(TINTS.some(t => t === taken), false, `${taken} is the ordinary dot, a refusal, a warning or the muted tone`)
})

test('a note sits on the lower side of the line, where the label is not', () => {
  assert.deepEqual(lowerSide(300, 0), { x: 0, y: 1 })
  assert.deepEqual(lowerSide(-300, 0), { x: 0, y: 1 })
  assert.deepEqual(lowerSide(0, 300), { x: -1, y: 0 }) // the label of a vertical line goes to its right
  assert.deepEqual(lowerSide(0, 0), { x: 0, y: 1 })
  for (const [dx, dy] of [[100, 100], [100, -100], [-50, 200], [300, 20]]) {
    const up = labelOffset(dx, dy, 6)
    const down = lowerSide(dx, dy)
    assert.ok(up.x * down.x + up.y * down.y < 0, `${dx},${dy}`)
    assert.ok(Math.abs(Math.hypot(down.x, down.y) - 1) < 1e-9)
  }
  const flat = noteSpot(300, 0, 10)
  assert.equal(flat.x, 0)
  assert.ok(flat.y > 26, 'clear of a puff or a clock')
  assert.ok(noteSpot(0, 300, 30).x < noteSpot(0, 300, 5).x, 'a long note on a steep line sits further left')
  assert.ok(Math.abs(noteSpot(0, 300, 5).x) > 26)
})

test('a marker hangs below the line, further for a wide one on a steep line, and is as wide as its name', () => {
  const small = markerSize('Tap')
  const wide = markerSize('Café wifi proxy')
  assert.equal(small.height, 28)
  assert.ok(wide.width > small.width)
  const flat = markerSpot(300, 0, wide)
  assert.equal(flat.x, 0)
  assert.equal(flat.y, 26 + 14)
  const steep = markerSpot(0, 300, wide)
  assert.equal(steep.y, 0)
  assert.equal(steep.x, -(26 + wide.width / 2))
  assert.ok(Math.abs(steep.x) > Math.abs(markerSpot(0, 300, small).x))
})

test('a blob taken in by a box stops at its edge, and from inside it goes to the middle', () => {
  const box = { x: 100, y: 100, width: 200, height: 72 }
  assert.deepEqual(entryPoint({ x: 200, y: 0 }, box), { x: 200, y: 100 }) // straight down onto the top edge
  assert.deepEqual(entryPoint({ x: 0, y: 136 }, box), { x: 100, y: 136 }) // straight across onto the left edge
  assert.deepEqual(entryPoint({ x: 200, y: 400 }, box), { x: 200, y: 172 })
  assert.deepEqual(entryPoint({ x: 150, y: 120 }, box), { x: 200, y: 136 })
  const slanted = entryPoint({ x: 0, y: 0 }, box)
  assert.ok(slanted.x >= 100 && slanted.y >= 100 && (slanted.x === 100 || slanted.y === 100))
  assert.ok(slanted.x <= 300 && slanted.y <= 172)
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
