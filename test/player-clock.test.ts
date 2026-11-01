import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PlayerClock, SPEEDS } from '../ui/src/clock.ts'

/** A clock on a time the test moves by hand. */
function handClock() {
  let now = 0
  const clock = new PlayerClock(() => now)
  return { clock, move: (ms: number) => (now += ms) }
}

test('the speeds are half, normal and double', () => {
  assert.deepEqual(SPEEDS, [0.5, 1, 2])
})

test('elapsed runs at the rate', () => {
  const { clock, move } = handClock()
  clock.setRate(2)
  move(100)
  assert.equal(clock.elapsed(), 200)
})

test('pause freezes and play carries on from the same moment', () => {
  const { clock, move } = handClock()
  move(300)
  clock.pause()
  move(500)
  assert.equal(clock.elapsed(), 300)
  clock.play()
  move(100)
  assert.equal(clock.elapsed(), 400)
})

test('a new rate takes over from the moment it is set', () => {
  const { clock, move } = handClock()
  move(100)
  clock.setRate(0.5)
  move(100)
  assert.equal(clock.elapsed(), 150)
})

test('restart keeps paused', () => {
  const { clock, move } = handClock()
  move(300)
  clock.pause()
  clock.restart()
  assert.equal(clock.elapsed(), 0)
  assert.equal(clock.paused, true)
  move(400)
  assert.equal(clock.elapsed(), 0)
})

test('seek clamps to the length', () => {
  const { clock } = handClock()
  clock.declare(1000)
  clock.seek(5000)
  assert.equal(clock.elapsed(), 1000)
  clock.seek(-1)
  assert.equal(clock.elapsed(), 0)
})

test('seekFraction waits for the length', () => {
  const { clock } = handClock()
  clock.pause()
  clock.seekFraction(0.5)
  assert.equal(clock.elapsed(), 0)
  clock.declare(800)
  assert.equal(clock.elapsed(), 400)
})

test('a restart forgets a seek still waiting for the length', () => {
  const { clock } = handClock()
  clock.pause()
  clock.seekFraction(0.5)
  clock.restart()
  clock.declare(800)
  assert.equal(clock.elapsed(), 0)
})

test('the length is the longest motion', () => {
  const { clock } = handClock()
  clock.declare(500)
  const undeclare = clock.declare(900)
  assert.equal(clock.length, 900)
  undeclare()
  assert.equal(clock.length, 500)
})

test('after counts running time only', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { clock, move } = handClock()
  let calls = 0
  clock.after(900, () => calls++)
  move(400)
  t.mock.timers.tick(400)
  clock.pause()
  move(5000)
  t.mock.timers.tick(5000)
  assert.equal(calls, 0)
  clock.play()
  move(500)
  t.mock.timers.tick(500)
  assert.equal(calls, 1)
})

test('after follows the rate', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { clock, move } = handClock()
  let calls = 0
  clock.setRate(2)
  clock.after(900, () => calls++)
  move(450)
  t.mock.timers.tick(450)
  assert.equal(calls, 1)
})

test('a cancelled wait never comes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { clock, move } = handClock()
  let calls = 0
  const cancel = clock.after(900, () => calls++)
  cancel()
  clock.pause()
  clock.play()
  move(1000)
  t.mock.timers.tick(1000)
  assert.equal(calls, 0)
})

test('subscribe hears every change', () => {
  const { clock } = handClock()
  let heard = 0
  const stop = clock.subscribe(() => heard++)
  clock.pause()
  clock.play()
  clock.setRate(2)
  clock.seek(10)
  clock.restart()
  clock.declare(100)
  assert.equal(heard, 6)
  stop()
  clock.pause()
  assert.equal(heard, 6)
})
