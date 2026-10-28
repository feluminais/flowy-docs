import { test } from 'node:test'
import assert from 'node:assert/strict'
import { active, bump, cardBox, cardsAt, cyclePeriod, distance, ease, EFFECT, effectPose, entryPoint, keepsPlaying, labelOffset, LIT_FLOOR, litOpacity, lowerSide, markerSize, markerSpot, noteSpot, pillText, progress, REST, squish, STILL, tileSquash, tintColor, tubeOpacity } from '../ui/src/motion.ts'
import { beatsFor, EFFECTS, TINTS } from '../src/core/animation.ts'
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

test('a dot is stretched along its way, and a label pill is never sheared', () => {
  assert.equal(squish(false, 30, 0), 'rotate(30) scale(1 1) rotate(-30)')
  assert.equal(squish(false, 30, 1), 'rotate(30) scale(1.3 0.85) rotate(-30)')
  // Level, a label gets the whole stretch; running straight up or down, the whole thinning along its way is across its width.
  assert.equal(squish(true, 0, 1), 'scale(1.3 0.85)')
  assert.equal(squish(true, 90, 1), 'scale(0.85 1.3)')
  assert.equal(squish(true, 0, 0), 'scale(1 1)')
  // Slanted, it is only ever a scale along its own axes: no rotation or skew in what comes out, so its sides stay level and upright.
  for (const angle of [20, 45, 63, 135, -70]) {
    const t = squish(true, angle, 1)
    assert.match(t, /^scale\([\d.]+ [\d.]+\)$/, t)
    const [x, y] = t.match(/[\d.]+/g)!.map(Number)
    assert.ok(x >= 0.85 && x <= 1.3 && y >= 0.85 && y <= 1.3, t)
  }
  // The same stretch from either way along a line.
  assert.equal(squish(true, 30, 1), squish(true, 210, 1))
})

test('every effect leaves and lands a blob as it is, keeps its shape whole, and a step with none stays still', () => {
  for (const effect of EFFECTS) for (const label of [true, false]) for (const angle of [0, 20, 90, 200, -70]) {
    for (const p of [0, 1]) {
      const pose = effectPose(effect, label, angle, p)
      for (const key of ['dy', 'turn'] as const) assert.ok(Math.abs(pose[key]) < 1e-9, `${effect} ${key} at ${p}`)
      for (const key of ['grow', 'x', 'y'] as const) assert.ok(Math.abs(pose[key] - 1) < 1e-9, `${effect} ${key} at ${p}`)
    }
  }
  assert.deepEqual(effectPose(undefined, true, 30, 0.5), STILL)
  assert.deepEqual(effectPose('spin' as never, true, 30, 0.5), STILL)
})

test('what each effect does in the middle of a run', () => {
  // A bounce is a hop, upward, of the height it says; a pulse swells evenly; a wiggle turns the whole blob either way.
  assert.equal(effectPose('bounce', true, 0, 1 / 6).dy, -EFFECT.hop)
  assert.ok(effectPose('bounce', true, 0, 0.1).dy < 0)
  const swell = effectPose('pulse', false, 45, 1 / 6)
  assert.ok(Math.abs(swell.grow - (1 + EFFECT.swell)) < 1e-9 && swell.x === 1 && swell.y === 1 && swell.turn === 0)
  assert.ok(Math.abs(effectPose('wiggle', true, 0, 1 / 12).turn - EFFECT.rock) < 1e-9)
  assert.ok(Math.abs(effectPose('wiggle', true, 0, 3 / 12).turn + EFFECT.rock) < 1e-9)
  // Squish is the same stretch squishParts gives, a label's never turned, so its edges stay level on any line.
  for (const angle of [20, 63, 135]) assert.equal(effectPose('squish', true, angle, 0.5).rotate, 0)
  assert.equal(effectPose('squish', false, 63, 0.5).rotate, 63)
  // Only the effect that stretches changes the shape's proportions, and only the one that hops lifts it.
  for (const effect of ['bounce', 'pulse', 'wiggle'] as const) {
    const pose = effectPose(effect, true, 63, 0.37)
    assert.ok(pose.x === 1 && pose.y === 1 && pose.rotate === 0, effect)
  }
})

test('a motion keeps drawing frames until it is over, or for as long as it repeats', () => {
  assert.equal(keepsPlaying(0, 1000, false), true)
  assert.equal(keepsPlaying(999, 1000, false), true)
  assert.equal(keepsPlaying(1000, 1000, false), false)
  assert.equal(keepsPlaying(5000, 1000, false), false)
  assert.equal(keepsPlaying(5000, 1000, true), true)
})

const depth3 = beatsFor({ kind: 'recurse', trigger: 'inside', depth: 3 }, { length: 250, afterLanding: false }).beats

test('the pile of cards slides in and out as the stack beats say, and never goes below nothing', () => {
  const at = (t: number) => cardsAt(depth3, t)
  assert.deepEqual([0, 1319].map(at), [0, 0])
  assert.equal(at(1395), 0.5)
  assert.deepEqual([1470, 2000].map(at), [1, 1])
  assert.deepEqual([2790, 3500].map(at), [2, 2])
  assert.equal(at(4365), 1.5)
  assert.equal(at(4440), 1)
  assert.deepEqual([5760, 99999].map(at), [0, 0])
  const deep = beatsFor({ kind: 'recurse', trigger: 'inside', depth: 5 }, { length: 250, afterLanding: false }).beats
  for (let t = 0; t < 12000; t += 25) assert.ok(cardsAt(deep, t) <= 4 && cardsAt(deep, t) >= 0, String(t))
})

test('a card sits 8 px lower and 7 px narrower on each side than the one above it', () => {
  const box = { x: 10, y: 20, width: 200, height: 72 }
  assert.deepEqual(cardBox(box, 2, 1), { x: 24, y: 36, width: 172, height: 72 })
  assert.deepEqual(cardBox(box, 1, 0.5), { x: 13.5, y: 24, width: 193, height: 72 })
  assert.deepEqual(cardBox(box, 3, 0), box)
})

test('the counter reads the height of the stack while it plays and how deep it was after', () => {
  assert.equal(pillText(true, 0, 3), '↻ 1')
  assert.equal(pillText(true, 1.4, 3), '↻ 2')
  assert.equal(pillText(true, 1.6, 3), '↻ 3')
  assert.equal(pillText(false, 0, 3), '↻ 3 deep')
})

test('with one box at both ends a squash on the first side is not wiped by the empty second side', () => {
  assert.deepEqual(tileSquash(true, { from: 0.6, to: 0 }), { from: 0.6, to: 0 })
  assert.deepEqual(tileSquash(true, { from: 0.2, to: 0.5 }), { from: 0.5, to: 0 })
  assert.deepEqual(tileSquash(false, { from: 0.2, to: 0.5 }), { from: 0.2, to: 0.5 })
})
