import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/system'
import { endsOfPath, HEAD_HALF_WIDTH, HEAD_LENGTH, HEAD_PATH, headMatrix, headScale } from '../src/core/heads.ts'
import type { Matrix, Point } from '../src/core/heads.ts'

const close = (a: number, b: number, what = '') => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} is not ${b}`)
const closePoint = (a: Point, b: Point, what = '') => {
  close(a.x, b.x, `${what} x`)
  close(a.y, b.y, `${what} y`)
}

/** Where the matrix puts a point of the head's own frame. */
const apply = ([a, b, c, d, e, f]: Matrix, x: number, y: number): Point => ({ x: a * x + c * y + e, y: b * x + d * y + f })

test('the head is a filled triangle 10 long and 9 wide, with its tip at the origin', () => {
  assert.equal(HEAD_PATH, `M0 0L-${HEAD_LENGTH} -${HEAD_HALF_WIDTH}L-${HEAD_LENGTH} ${HEAD_HALF_WIDTH}Z`)
})

test('the matrix puts the tip on the line end and the body behind it, whichever way the line points', () => {
  for (const dir of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: 0.6, y: 0.8 }]) {
    const end = { x: 123.5, y: -40.25 }
    const m = headMatrix(end, dir)
    closePoint(apply(m, 0, 0), end, 'tip')
    closePoint(apply(m, -HEAD_LENGTH, 0), { x: end.x - dir.x * HEAD_LENGTH, y: end.y - dir.y * HEAD_LENGTH }, 'middle of the back')
    const [left, right] = [apply(m, -HEAD_LENGTH, -HEAD_HALF_WIDTH), apply(m, -HEAD_LENGTH, HEAD_HALF_WIDTH)]
    close(Math.hypot(left.x - right.x, left.y - right.y), 2 * HEAD_HALF_WIDTH, 'the back stays 9 wide')
  }
})

test('a bigger scale grows the head from its tip', () => {
  const m = headMatrix({ x: 50, y: 50 }, { x: 1, y: 0 }, 1.5)
  closePoint(apply(m, 0, 0), { x: 50, y: 50 })
  closePoint(apply(m, -HEAD_LENGTH, HEAD_HALF_WIDTH), { x: 35, y: 50 + 1.5 * HEAD_HALF_WIDTH })
})

test('a head is its usual size up to a line 2.5 thick and grows with the square root of the width after that', () => {
  for (const width of [0.5, 1, 1.5, 2, 2.5]) assert.equal(headScale(width), 1, `width ${width}`)
  assert.equal(headScale(6), 1.549)
  assert.equal(headScale(10), 2)
  assert.ok(headScale(3) > 1 && headScale(3) < headScale(4))
})

test('a straight path ends where it ends and points along itself', () => {
  const [d] = getStraightPath({ sourceX: 0, sourceY: 36, targetX: 400, targetY: 36 })
  assert.deepEqual(endsOfPath(d), { start: { x: 0, y: 36 }, startDir: { x: -1, y: 0 }, end: { x: 400, y: 36 }, endDir: { x: 1, y: 0 } })
})

test('a curved path points along its last control point, and a right-angled one along its last piece', () => {
  const ends = { sourceX: 100, sourceY: 72, sourcePosition: Position.Bottom, targetX: 450, targetY: 230, targetPosition: Position.Top }
  const curved = endsOfPath(getBezierPath(ends)[0])!
  closePoint(curved.end, { x: 450, y: 230 })
  closePoint(curved.endDir, { x: 0, y: 1 }, 'a curve into the top side') // leaves a bottom side downwards and arrives at a top side downwards
  closePoint(curved.startDir, { x: 0, y: -1 }, 'a curve out of the bottom side points back up')
  const angled = endsOfPath(getSmoothStepPath({ ...ends, borderRadius: 8 })[0])!
  closePoint(angled.end, { x: 450, y: 230 })
  closePoint(angled.endDir, { x: 0, y: 1 })
  closePoint(angled.startDir, { x: 0, y: -1 })
})

test('a curve with its control point on its end points along the chord, and a line of no length points down', () => {
  closePoint(endsOfPath('M0,0 C0,0 10,0 10,10')!.startDir, { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }, 'from the chord')
  closePoint(endsOfPath('M0,0 C0,10 10,10 10,10')!.endDir, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 'from the start of the curve') // the desktop does the same
  assert.deepEqual(endsOfPath('M5 5L5 5')?.endDir, { x: 0, y: 1 })
})

test('a coordinate JavaScript prints with an exponent is a number, not a command', () => {
  const noise = endsOfPath('M5.5e-17,36 L400,3.6e1')
  assert.ok(noise, 'float noise must not hide the head')
  close(noise.start.x, 5.5e-17, 'start x')
  assert.deepEqual(noise.end, { x: 400, y: 36 })
  assert.deepEqual(endsOfPath('M0 0L1E+2 -2.5e-3')?.end, { x: 100, y: -0.0025 })
  assert.deepEqual(endsOfPath('M0 0C1e-7 0 10 0 10 1e1')?.end, { x: 10, y: 10 })
  assert.equal(endsOfPath('M0 0 e5 5L10 10'), undefined, 'a lone e is still not a command')
})

test('anything that is not lines and curves in absolute coordinates has no ends', () => {
  assert.equal(endsOfPath(''), undefined)
  assert.equal(endsOfPath('M0 0'), undefined)
  assert.equal(endsOfPath('M0 0 l10 10'), undefined)
  assert.equal(endsOfPath('M0 0L10'), undefined)
  assert.equal(endsOfPath('L0 0L10 10'), undefined)
})
