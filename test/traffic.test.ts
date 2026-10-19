import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advance, MOST, newStream, visibility } from '../ui/src/traffic.ts'

/** Run a stream for `ms` in frames of 16 ms, like a screen would. */
function run(stream: ReturnType<typeof newStream>, line: { perSecond: number; travelMs: number; failed: number }, ms: number, rand: () => number = () => 0.99) {
  for (let t = 0; t < ms; t += 16) advance(stream, line, 16, rand)
}

test('a line with traffic holds about as many particles as calls in flight: a rate times how long a call takes', () => {
  const stream = newStream()
  run(stream, { perSecond: 10, travelMs: 2000, failed: 0 }, 5000)
  assert.ok(stream.motes.length >= 18 && stream.motes.length <= 22, `got ${stream.motes.length}`)
  assert.ok(stream.motes.every(m => m.s >= 0 && m.s < 1 && m.fails === 0))
  const ages = stream.motes.map(m => m.s)
  assert.deepEqual([...ages].sort((a, b) => b - a), ages) // the oldest is first
})

test('a particle that has got to the end is gone, and a line with no traffic has none', () => {
  const stream = newStream()
  run(stream, { perSecond: 5, travelMs: 500, failed: 0 }, 1000)
  assert.ok(stream.motes.length > 0)
  run(stream, { perSecond: 0, travelMs: 500, failed: 0 }, 600)
  assert.equal(stream.motes.length, 0)
})

test('a slower line moves its particles less in the same time, and a change in speed applies to the ones already on it', () => {
  const stream = newStream()
  advance(stream, { perSecond: 100, travelMs: 1000, failed: 0 }, 16, () => 0.99)
  const before = stream.motes[0].s
  advance(stream, { perSecond: 0, travelMs: 1000, failed: 0 }, 100, () => 0.99)
  const slow = stream.motes[0].s - before
  const other = newStream()
  advance(other, { perSecond: 100, travelMs: 1000, failed: 0 }, 16, () => 0.99)
  advance(other, { perSecond: 0, travelMs: 250, failed: 0 }, 100, () => 0.99)
  assert.ok(other.motes[0].s - before > slow * 3.9)
})

test('a share of the particles, the share of calls that fail, are marked to give out between 30% and 80% of the way', () => {
  const stream = newStream()
  const values = [0.1, 0.5, 0.9, 0.0, 0.7] // a particle takes one number to say whether it fails, and another to say where
  let i = 0
  advance(stream, { perSecond: 3, travelMs: 1000, failed: 0.5 }, 1000, () => values[i++ % values.length])
  assert.equal(stream.motes.length, 3)
  const failing = stream.motes.filter(m => m.fails > 0)
  assert.ok(failing.length >= 1 && failing.every(m => m.fails >= 0.3 && m.fails <= 0.8))
  assert.ok(stream.motes.some(m => m.fails === 0))
})

test('a failing particle is gone once it reaches where it gives out, not at the end', () => {
  const stream = newStream()
  stream.motes.push({ s: 0.5, fails: 0.6 })
  advance(stream, { perSecond: 0, travelMs: 1000, failed: 0 }, 50, () => 0.5)
  assert.equal(stream.motes.length, 1)
  advance(stream, { perSecond: 0, travelMs: 1000, failed: 0 }, 100, () => 0.5)
  assert.equal(stream.motes.length, 0)
})

test('a busy, slow line holds no more than MOST particles', () => {
  const stream = newStream()
  run(stream, { perSecond: 1000, travelMs: 4000, failed: 0 }, 3000)
  assert.equal(stream.motes.length, MOST)
})

test('a particle is fully visible until it is nearly out, then fades, and one that arrives never fades', () => {
  assert.equal(visibility({ s: 0.9, fails: 0 }), 1)
  assert.equal(visibility({ s: 0.1, fails: 0.5 }), 1)
  assert.ok(Math.abs(visibility({ s: 0.45, fails: 0.5 }) - 1 / 3) < 1e-9)
  assert.equal(visibility({ s: 0.6, fails: 0.5 }), 0)
})
