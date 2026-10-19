import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react'
import { flatten, pointAt } from '../ui/src/pathpoints.ts'

const near = (actual: number, expected: number, within = 0.01) => assert.ok(Math.abs(actual - expected) <= within, `expected ${expected}, got ${actual}`)

test('a straight line is two points, and a particle halfway is in the middle', () => {
  const line = flatten('M 10,20L 110,20')
  assert.deepEqual(line.xs, [10, 110])
  assert.equal(line.total, 100)
  assert.deepEqual(pointAt(line, 0), [10, 20])
  assert.deepEqual(pointAt(line, 0.5), [60, 20])
  assert.deepEqual(pointAt(line, 1), [110, 20])
  assert.equal(flatten('M0,0L3,4').total, 5)
})

test('pointAt stops at the ends of the line', () => {
  const line = flatten('M0,0L100,0')
  assert.deepEqual(pointAt(line, -3), [0, 0])
  assert.deepEqual(pointAt(line, 7), [100, 0])
})

test('the paths React Flow writes for a line in each style are read: curves are flattened and the ends stay exact', () => {
  const ends = { sourceX: 0, sourceY: 0, sourcePosition: Position.Bottom, targetX: 100, targetY: 100, targetPosition: Position.Top }
  const [straight] = getStraightPath({ sourceX: 0, sourceY: 0, targetX: 100, targetY: 100 })
  const [curved] = getBezierPath(ends)
  const [angled] = getSmoothStepPath({ ...ends, borderRadius: 8 })
  near(flatten(straight).total, Math.hypot(100, 100))
  for (const d of [straight, curved, angled]) {
    const line = flatten(d)
    assert.deepEqual(pointAt(line, 0), [0, 0], d)
    const [x, y] = pointAt(line, 1)
    near(x, 100)
    near(y, 100)
  }
  const bend = flatten(curved)
  assert.ok(bend.total > Math.hypot(100, 100) && bend.total < 200) // longer than the straight line, shorter than going round two sides
  const [mx, my] = pointAt(bend, 0.5)
  near(mx, 50, 0.5)
  near(my, 50, 0.5)
  const steps = flatten(angled)
  assert.equal(steps.total > 200 - 20, true) // down, across and down again, with rounded corners
  let last = -Infinity
  for (let s = 0; s <= 1; s += 0.05) {
    const [, py] = pointAt(steps, s)
    assert.ok(py >= last - 1e-9, 'a right-angled line never goes back up')
    last = py
  }
})

test('a quadratic curve is flattened through its midpoint', () => {
  const line = flatten('M0,0Q50,0 100,100')
  assert.ok(line.xs.some((x, i) => Math.abs(x - 50) < 1e-9 && Math.abs(line.ys[i] - 25) < 1e-9))
})

test('an empty path is a point at the origin, and one it cannot read is skipped', () => {
  assert.deepEqual(pointAt(flatten(''), 0.5), [0, 0])
  assert.equal(flatten('Z').xs.length, 1)
})
