import { test } from 'node:test'
import assert from 'node:assert/strict'
import { beatsFor } from '../src/core/animation.ts'
import { active, bump, cardBox, cardsAt, dashAround, distance, ease, pillText, progress, tileSquash, tubeOpacity } from '../ui/src/motion.ts'

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

test('dashAround leaves one stretch of the path drawn, centred on a point', () => {
  assert.deepEqual(dashAround(100, 300, 40), { array: '40 640', offset: -80 })
  assert.deepEqual(dashAround(0, 300, 40), { array: '40 640', offset: 20 })
})

const depth3 = beatsFor({ kind: 'recurse', trigger: 'inside', depth: 3 }, { length: 250, afterLanding: false }).beats

test('the pile of cards slides in and out as the stack beats say, and never goes below nothing', () => {
  const at = (t: number) => cardsAt(depth3, t)
  assert.deepEqual([0, 619].map(at), [0, 0])
  assert.equal(at(695), 0.5)
  assert.deepEqual([770, 1000].map(at), [1, 1])
  assert.deepEqual([1390, 1800].map(at), [2, 2])
  assert.equal(at(2265), 1.5)
  assert.equal(at(2340), 1)
  assert.deepEqual([2960, 9999].map(at), [0, 0])
  const deep = beatsFor({ kind: 'recurse', trigger: 'inside', depth: 5 }, { length: 250, afterLanding: false }).beats
  for (let t = 0; t < 6000; t += 25) assert.ok(cardsAt(deep, t) <= 4 && cardsAt(deep, t) >= 0, String(t))
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
