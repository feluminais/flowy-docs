import { test } from 'node:test'
import assert from 'node:assert/strict'
import { advance, BACK, ghost, GHOST, HOLD, howBehind, moteLook, MOST, newStream, POP, REJECTED_END, visibility } from '../ui/src/traffic.ts'
import type { Failure } from '../src/core/perf.ts'

/** Run a stream for `ms` in frames of 16 ms, like a screen would. */
function run(stream: ReturnType<typeof newStream>, line: { perSecond: number; travelMs: number; failed: number; failure?: Failure }, ms: number, rand: () => number = () => 0.99) {
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

test('a particle goes from clear to well behind over the ramp either side of an outline, never in a step', () => {
  assert.equal(howBehind(-6, 6), 0) // a ramp outside: clear
  assert.equal(howBehind(-20, 6), 0)
  assert.equal(howBehind(0, 6), 0.5) // on the outline: half way
  assert.equal(howBehind(6, 6), 1) // a ramp inside: well behind
  assert.equal(howBehind(40, 6), 1)
  assert.ok(howBehind(-3, 6) > 0 && howBehind(-3, 6) < howBehind(3, 6) && howBehind(3, 6) < 1)
})

test('a particle behind something is a fainter, smaller one, and in front it is as always', () => {
  assert.deepEqual(ghost(0), { alpha: 1, scale: 1 })
  assert.deepEqual(ghost(1), { alpha: GHOST, scale: 0.75 })
  const half = ghost(0.5)
  assert.ok(half.alpha < 1 && half.alpha > GHOST && half.scale < 1 && half.scale > 0.75)
})

// ---- A source's numbers drawn: dots at once, the cap, and how a failing share fails

test('a line holds the number of dots its numbers promise, and ten times the dots reads ten to one', () => {
  const held = (dots: number, travelMs: number) => {
    const stream = newStream()
    run(stream, { perSecond: dots / (travelMs / 1000), travelMs, failed: 0 }, 12_000)
    return stream.motes.length
  }
  assert.ok(Math.abs(held(2, 800) - 2) <= 1 && Math.abs(held(20, 800) - 20) <= 1, `${held(2, 800)} and ${held(20, 800)}`)
  assert.ok(Math.abs(held(20, 3000) - 20) <= 1) // the same count at a slower speed: equal dots, different speed
  assert.ok(Math.abs(held(24, 500) - 24) <= 1)
})

test('a line whose count is far past the cap still holds no more than MOST', () => {
  for (const failure of [undefined, 'lost', 'rejected'] as const) {
    const stream = newStream()
    run(stream, { perSecond: 1e9, travelMs: 4000, failed: 0.5, failure }, 3000, () => 0.4)
    assert.ok(stream.motes.length <= MOST, `${failure}: ${stream.motes.length}`)
  }
})

test('a lost call is an ordinary particle until it pops, a ring that grows and is gone', () => {
  const rolls = [0.1, 0.5] // fails, and gives out at 0.3 + 0.5 * 0.5 = 0.55
  let i = 0
  const stream = newStream()
  advance(stream, { perSecond: 1, travelMs: 1000, failed: 1, failure: 'lost' }, 1000, () => rolls[i++ % 2])
  assert.equal(stream.motes.length, 1)
  const [m] = stream.motes
  assert.ok(Math.abs(m.fails - (0.55 + POP)) < 1e-9)
  assert.deepEqual(moteLook({ s: 0.2, fails: m.fails }, 'lost'), { at: 0.2, bad: false, alpha: 1 })
  const pop = moteLook({ s: 0.55 + POP / 2, fails: m.fails }, 'lost')
  assert.ok(Math.abs(pop.at - 0.55) < 1e-9 && pop.bad && pop.alpha === 0 && Math.abs(pop.pop! - 0.5) < 1e-9)
  assert.ok(Math.abs(moteLook({ s: 0.55, fails: m.fails }, 'lost').pop!) < 1e-9)
  assert.ok(Math.abs(moteLook({ s: 0.55 + POP, fails: m.fails }, 'lost').pop! - 1) < 1e-9)
  stream.motes[0].s = 0.55 + POP + 0.001
  advance(stream, { perSecond: 0, travelMs: 1000, failed: 0, failure: 'lost' }, 16, () => 0.5)
  assert.equal(stream.motes.length, 0) // once the pop is over it is gone
})

test('a rejected call runs to the end of the line, stops at a bar, and comes back in the danger tone', () => {
  const stream = newStream()
  advance(stream, { perSecond: 1, travelMs: 1000, failed: 1, failure: 'rejected' }, 1000, () => 0.2)
  assert.equal(stream.motes[0].fails, REJECTED_END)
  const at = (s: number) => moteLook({ s, fails: REJECTED_END }, 'rejected')
  assert.deepEqual(at(0.4), { at: 0.4, bad: false, alpha: 1, bar: 0 })
  assert.ok(at(0.95).bar! > 0 && at(0.95).bar! < 1 && !at(0.95).bad) // the bar starts to show as it nears
  assert.deepEqual(at(1), { at: 1, bad: false, alpha: 1, bar: 1 })
  assert.deepEqual(at(1 + HOLD / 2), { at: 1, bad: true, alpha: 1, bar: 1 }) // stopped at the bar, now red
  const back = at(1 + HOLD + BACK / 2)
  assert.ok(Math.abs(back.at - (1 - BACK / 2)) < 1e-9 && back.bad && Math.abs(back.alpha - 0.5) < 1e-9) // half way back, half faded
  assert.ok(Math.abs(at(REJECTED_END).at - (1 - BACK)) < 1e-9 && at(REJECTED_END).alpha === 0)
  stream.motes[0].s = REJECTED_END - 0.001
  advance(stream, { perSecond: 0, travelMs: 1000, failed: 0, failure: 'rejected' }, 16, () => 0.5)
  assert.equal(stream.motes.length, 0)
})

test('a rejected call that gets to the end is not gone at the end, as one that arrives is', () => {
  const stream = newStream()
  stream.motes.push({ s: 0.99, fails: REJECTED_END }, { s: 0.99, fails: 0 })
  advance(stream, { perSecond: 0, travelMs: 1000, failed: 0, failure: 'rejected' }, 50, () => 0.5)
  assert.deepEqual(stream.motes.map(m => m.fails), [REJECTED_END]) // the one that arrives is gone; the rejected one is still on the line, past its end
})

test('without a style a failing particle is danger-toned from the start and fades, and one that arrives is ordinary', () => {
  assert.deepEqual(moteLook({ s: 0.3, fails: 0 }, undefined), { at: 0.3, bad: false, alpha: 1 })
  assert.deepEqual(moteLook({ s: 0.3, fails: 0.6 }, undefined), { at: 0.3, bad: true, alpha: 1 })
  const fading = moteLook({ s: 0.45, fails: 0.5 }, undefined)
  assert.ok(Math.abs(fading.alpha - 1 / 3) < 1e-9 && fading.bad && fading.pop === undefined && fading.bar === undefined)
  for (const failure of ['lost', 'rejected'] as const) assert.deepEqual(moteLook({ s: 0.7, fails: 0 }, failure), { at: 0.7, bad: false, alpha: 1 }) // arriving particles look alike in every style
})

test('the number of random draws does not change with the style, so a test that fixes them draws the same dots', () => {
  const draws = (failure?: Failure) => {
    let n = 0
    const stream = newStream()
    advance(stream, { perSecond: 10, travelMs: 1000, failed: 1, failure }, 1000, () => (n++, 0.4))
    return n
  }
  assert.equal(draws(undefined), draws('lost'))
  assert.ok(draws('rejected') < draws('lost')) // a rejected call goes the whole way, so there is no place to draw
})
