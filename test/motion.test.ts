import { test } from 'node:test'
import assert from 'node:assert/strict'
import { animationOf } from '../src/core/animation.ts'
import { active, bump, dashAround, distance, drawable, ease, progress, tubeOpacity } from '../ui/src/motion.ts'

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

test('a kind the browser does not draw yet reads as no animation', () => {
  for (const kind of ['send', 'call', 'callback', 'event']) assert.deepEqual(drawable(animationOf({ to: 'b', animation: kind })), { kind, trigger: 'inside' })
  assert.equal(drawable(animationOf({ animation: 'recurse' })), undefined)
  assert.equal(drawable(undefined), undefined)
})
