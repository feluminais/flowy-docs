import { test } from 'node:test'
import assert from 'node:assert/strict'
import { animationOf, animationProblem, beatsFor, followsLanding, travelMs } from '../src/core/animation.ts'
import type { Animation } from '../src/core/animation.ts'

const plain = (kind: Animation['kind'], more: Partial<Animation> = {}): Animation => ({ kind, trigger: 'inside', ...more })

test('a kind alone and a mapping with a kind read the same', () => {
  assert.deepEqual(animationOf({ to: 'b', animation: 'call' }), { kind: 'call', trigger: 'inside' })
  assert.deepEqual(animationOf({ to: 'b', animation: { kind: 'call' } }), { kind: 'call', trigger: 'inside' })
  assert.deepEqual(
    animationOf({ to: 'b', animation: { kind: 'callback', trigger: 'outside', carries: 'receipt' } }),
    { kind: 'callback', trigger: 'outside', carries: 'receipt' },
  )
})

test('no tag, a blank tag, a bad one, or a step with no "to" reads as nothing', () => {
  assert.equal(animationOf({ to: 'b' }), undefined)
  assert.equal(animationOf({ to: 'b', animation: '' }), undefined)
  assert.equal(animationOf({ to: 'b', animation: 'zoom' }), undefined)
  assert.equal(animationOf({ animation: 'send' }), undefined)
})

test('an outcome reads after the carried word, and a wrong one reads as nothing', () => {
  assert.deepEqual(animationOf({ to: 'b', animation: { kind: 'call', outcome: 'timeout' } }), { kind: 'call', trigger: 'inside', outcome: 'timeout' })
  assert.deepEqual(
    animationOf({ to: 'b', animation: { kind: 'send', carries: 'x', outcome: 'fail' } }),
    { kind: 'send', trigger: 'inside', carries: 'x', outcome: 'fail' },
  )
  assert.equal(animationOf({ to: 'b', animation: { kind: 'send', outcome: 'timeout' } }), undefined)
  assert.equal(animationOf({ to: 'b', animation: { kind: 'call', outcome: 'maybe' } }), undefined)
  assert.equal(animationOf({ animation: { kind: 'call', outcome: 'timeout' } }), undefined)
})

test('problems say what to fix', () => {
  const kinds = 'use send, call, callback, event'
  const cases: [unknown, boolean, string | undefined][] = [
    [undefined, true, undefined],
    ['', true, undefined],
    ['send', true, undefined],
    [{ kind: 'callback', trigger: 'outside', carries: 'x' }, true, undefined],
    ['sned', true, `unknown animation "sned" (${kinds})`],
    ['Send', true, `unknown animation "Send" (${kinds})`],
    [{}, true, `animation needs a kind (${kinds})`],
    [{ kind: '' }, true, `animation needs a kind (${kinds})`],
    [{ kind: ['send'] }, true, 'animation kind must be text'],
    [['send'], true, 'animation must be a kind or a mapping with a kind'],
    [{ kind: 'send', speed: 'fast' }, true, 'unknown animation option "speed" (use kind, trigger, carries, outcome)'],
    [{ kind: 'callback', trigger: 'sideways' }, true, 'animation trigger must be inside or outside'],
    [{ kind: 'send', trigger: 'outside' }, true, 'animation trigger only applies to callback'],
    [{ kind: 'send', carries: ' ' }, true, 'animation carries must be a word'],
    [{ kind: 'send', carries: ['x'] }, true, 'animation carries must be a word'],
    ['call', false, 'animation "call" needs a "to"'],
    [{ kind: 'send', outcome: 'fail' }, true, undefined],
    [{ kind: 'call', outcome: 'fail' }, true, undefined],
    [{ kind: 'call', outcome: 'timeout' }, true, undefined],
    [{ kind: 'send', outcome: 'timeout' }, true, 'animation outcome timeout only applies to call'],
    [{ kind: 'event', outcome: 'timeout' }, true, 'animation outcome timeout only applies to call'],
    [{ kind: 'callback', outcome: 'timeout' }, true, 'animation outcome timeout only applies to call'],
    [{ kind: 'event', outcome: 'fail' }, true, 'animation outcome fail only applies to send and call'],
    [{ kind: 'callback', outcome: 'fail' }, true, 'animation outcome fail only applies to send and call'],
    [{ kind: 'call', outcome: 'maybe' }, true, 'animation outcome must be fail or timeout'],
    [{ kind: 'call', outcome: '' }, true, 'animation outcome must be fail or timeout'],
    [{ kind: 'call', outcome: ['fail'] }, true, 'animation outcome must be fail or timeout'],
    [{ kind: 'call', outcome: 'timeout' }, false, 'animation "call" needs a "to"'],
  ]
  for (const [raw, hasTo, expected] of cases) assert.equal(animationProblem(raw, hasTo), expected, JSON.stringify(raw))
})

test('travel time follows the length of the line, between 1.2 and 2.2 seconds', () => {
  const cases: [number, number][] = [[0, 1200], [100, 1200], [250, 1200], [400, 1200], [333.3, 1200], [500, 1500], [600, 1800], [1000, 2200], [5000, 2200], [Number.NaN, 1200], [Number.POSITIVE_INFINITY, 1200]]
  for (const [length, ms] of cases) assert.equal(travelMs(length), ms, String(length))
})

test('a step follows a landing when the step before ended where it starts', () => {
  assert.equal(followsLanding(['a', 'b'], ['b', 'c']), true)
  assert.equal(followsLanding(['a', 'a'], ['a', 'c']), true)
  assert.equal(followsLanding(['a', 'b'], ['a', 'c']), false)
  assert.equal(followsLanding(null, ['a', 'b']), false)
  assert.equal(followsLanding(['a', 'b'], undefined), false)
})

test('send: a squeeze, a blob along the line, a gulp where it lands', () => {
  const { beats, total } = beatsFor(plain('send'), { length: 400, afterLanding: false })
  assert.equal(total, 1750)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 1750 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1200, dir: 'fwd', glyph: 'envelope' },
    { do: 'gulp', on: 'to', at: 1450, dur: 300 },
  ])
})

test('call: the sender waits, then a reply comes back the same way', () => {
  const { beats, total } = beatsFor(plain('call'), { length: 250, afterLanding: false })
  assert.equal(total, 3550)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 3550 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1200, dir: 'fwd', glyph: 'envelope' },
    { do: 'gulp', on: 'to', at: 1450, dur: 300 },
    { do: 'wait', on: 'from', at: 1450, dur: 600 },
    { do: 'blob', on: 'line', at: 2050, dur: 1200, dir: 'back', glyph: 'envelope', tone: 'reply' },
    { do: 'gulp', on: 'from', at: 3250, dur: 300 },
  ])
})

test('event: a bolt, and a flash instead of a gulp', () => {
  const { beats, total } = beatsFor(plain('event'), { length: 250, afterLanding: false })
  assert.equal(total, 1900)
  assert.deepEqual(beats.slice(1), [
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1200, dir: 'fwd', glyph: 'bolt' },
    { do: 'flash', on: 'to', at: 1450, dur: 450 },
  ])
})

test('callback triggered inside: a ring at the source first, because nothing came in', () => {
  const { beats, total } = beatsFor(plain('callback'), { length: 250, afterLanding: true })
  assert.equal(total, 2250)
  assert.deepEqual(beats.slice(1), [
    { do: 'ring', on: 'from', at: 0, dur: 600 },
    { do: 'blob', on: 'line', at: 450, dur: 1200, dir: 'fwd', glyph: 'bell' },
    { do: 'ring', on: 'to', at: 1650, dur: 600 },
  ])
})

test('callback triggered outside: kicked if the step before landed here, otherwise a bolt drops in first', () => {
  const outside = plain('callback', { trigger: 'outside' })
  const after = beatsFor(outside, { length: 250, afterLanding: true })
  assert.equal(after.total, 2100)
  assert.deepEqual(after.beats.slice(1), [
    { do: 'flash', on: 'from', at: 0, dur: 450 },
    { do: 'blob', on: 'line', at: 300, dur: 1200, dir: 'fwd', glyph: 'bell' },
    { do: 'ring', on: 'to', at: 1500, dur: 600 },
  ])
  const alone = beatsFor(outside, { length: 250, afterLanding: false })
  assert.equal(alone.total, 2650)
  assert.deepEqual(alone.beats.slice(1), [
    { do: 'drop', on: 'from', at: 0, dur: 600, glyph: 'bolt' },
    { do: 'flash', on: 'from', at: 600, dur: 450 },
    { do: 'blob', on: 'line', at: 850, dur: 1200, dir: 'fwd', glyph: 'bell' },
    { do: 'ring', on: 'to', at: 2050, dur: 600 },
  ])
})

test('carries labels the blob going out, and not the reply', () => {
  const { beats } = beatsFor(plain('call', { carries: 'order' }), { length: 250, afterLanding: false })
  const blobs = beats.filter(b => b.do === 'blob')
  assert.deepEqual(blobs.map(b => b.label), ['order', undefined])
})

test('send that fails: the blob and the flash where it lands are the danger tone', () => {
  const { beats, total } = beatsFor(plain('send', { outcome: 'fail' }), { length: 400, afterLanding: false })
  assert.equal(total, 1900)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 1900 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1200, dir: 'fwd', glyph: 'envelope', tone: 'fail' },
    { do: 'gulp', on: 'to', at: 1450, dur: 300 },
    { do: 'flash', on: 'to', at: 1450, dur: 450, tone: 'fail' },
  ])
})

test('call that fails: the request, the flash and the reply are all the danger tone', () => {
  const { beats, total } = beatsFor(plain('call', { outcome: 'fail' }), { length: 250, afterLanding: false })
  assert.equal(total, 3550)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 3550 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1200, dir: 'fwd', glyph: 'envelope', tone: 'fail' },
    { do: 'gulp', on: 'to', at: 1450, dur: 300 },
    { do: 'flash', on: 'to', at: 1450, dur: 450, tone: 'fail' },
    { do: 'wait', on: 'from', at: 1450, dur: 600 },
    { do: 'blob', on: 'line', at: 2050, dur: 1200, dir: 'back', glyph: 'envelope', tone: 'fail' },
    { do: 'gulp', on: 'from', at: 3250, dur: 300 },
  ])
})

test('call that times out: the sender keeps waiting, nothing comes back, the line fades', () => {
  const { beats, total } = beatsFor(plain('call', { outcome: 'timeout' }), { length: 250, afterLanding: false })
  assert.equal(total, 3850)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 3850 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1200, dir: 'fwd', glyph: 'envelope' },
    { do: 'gulp', on: 'to', at: 1450, dur: 300 },
    { do: 'wait', on: 'from', at: 1450, dur: 1800 },
    { do: 'fade', on: 'line', at: 3250, dur: 600 },
  ])
})

test('a failing blob that carries a word has its tone before its label', () => {
  const { beats } = beatsFor(plain('send', { carries: 'declined', outcome: 'fail' }), { length: 400, afterLanding: false })
  const blob = beats.find(b => b.do === 'blob')!
  assert.deepEqual(Object.keys(blob), ['do', 'on', 'at', 'dur', 'dir', 'glyph', 'tone', 'label'])
  assert.equal(blob.tone, 'fail')
  assert.equal(blob.label, 'declined')
})

test('a longer line takes longer, up to the cap', () => {
  assert.equal(beatsFor(plain('send'), { length: 5000, afterLanding: false }).total, 550 + 2200)
  assert.equal(beatsFor(plain('send'), { length: 0, afterLanding: false }).total, 550 + 1200)
})
