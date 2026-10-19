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

test('problems say what to fix', () => {
  const kinds = 'use send, call, callback, event, recurse'
  const depth = 'animation depth must be a whole number from 2 to 5'
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
    [{ kind: 'send', speed: 'fast' }, true, 'unknown animation option "speed" (use kind, trigger, carries)'],
    [{ kind: 'callback', trigger: 'sideways' }, true, 'animation trigger must be inside or outside'],
    [{ kind: 'send', trigger: 'outside' }, true, 'animation trigger only applies to callback'],
    [{ kind: 'send', carries: ' ' }, true, 'animation carries must be a word'],
    [{ kind: 'send', carries: ['x'] }, true, 'animation carries must be a word'],
    ['call', false, 'animation "call" needs a "to"'],
    ['recurse', false, undefined],
    [{ kind: 'recurse', depth: 3 }, false, undefined],
    [{ kind: 'recurse', depth: '4', carries: 'CNAME', returns: 'A record' }, false, undefined],
    [{ kind: 'recurse', depth: '2' }, false, undefined],
    [{ kind: 'recurse', depth: '5' }, false, undefined],
    ['recurse', true, 'animation "recurse" is a shape calling itself: leave out "to"'],
    ...['1', '6', '3.5', '3x', '', 1, 6, 3.5, true, '99999999999999999999'].map((d): [unknown, boolean, string] => [{ kind: 'recurse', depth: d }, false, depth]),
    [{ kind: 'send', depth: 3 }, true, 'animation depth only applies to recurse'],
    [{ kind: 'send', returns: 'x' }, true, 'animation returns only applies to recurse'],
    [{ kind: 'recurse', returns: ' ' }, false, 'animation returns must be a word'],
    [{ kind: 'recurse', trigger: 'outside' }, false, 'animation trigger only applies to callback'],
    [{ kind: 'recurse', speed: 'fast' }, false, 'unknown animation option "speed" (use kind, carries, depth, returns)'],
  ]
  for (const [raw, hasTo, expected] of cases) assert.equal(animationProblem(raw, hasTo), expected, JSON.stringify(raw))
})

test('recurse reads with its depth, and only recurse has one', () => {
  assert.deepEqual(animationOf({ animation: 'recurse' }), { kind: 'recurse', trigger: 'inside', depth: 3 })
  assert.deepEqual(
    animationOf({ animation: { kind: 'recurse', depth: '4', carries: 'CNAME', returns: 'A record' } }),
    { kind: 'recurse', trigger: 'inside', carries: 'CNAME', depth: 4, returns: 'A record' },
  )
  assert.equal(animationOf({ to: 'b', animation: 'recurse' }), undefined)
  assert.equal(animationOf({ animation: 'call' }), undefined)
  assert.deepEqual(animationOf({ to: 'b', animation: 'send' }), { kind: 'send', trigger: 'inside' })
})

test('travel time follows the length of the line, between half a second and a bit over one', () => {
  const cases: [number, number][] = [[0, 500], [100, 500], [250, 500], [400, 800], [333.3, 667], [1000, 1100], [5000, 1100], [Number.NaN, 500], [Number.POSITIVE_INFINITY, 500]]
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
  assert.equal(total, 1150)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 1150 },
    { do: 'gulp', on: 'from', at: 0, dur: 150 },
    { do: 'blob', on: 'line', at: 150, dur: 800, dir: 'fwd', glyph: 'envelope' },
    { do: 'gulp', on: 'to', at: 950, dur: 200 },
  ])
})

test('call: the sender waits, then a reply comes back the same way', () => {
  const { beats, total } = beatsFor(plain('call'), { length: 250, afterLanding: false })
  assert.equal(total, 1650)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 1650 },
    { do: 'gulp', on: 'from', at: 0, dur: 150 },
    { do: 'blob', on: 'line', at: 150, dur: 500, dir: 'fwd', glyph: 'envelope' },
    { do: 'gulp', on: 'to', at: 650, dur: 200 },
    { do: 'wait', on: 'from', at: 650, dur: 300 },
    { do: 'blob', on: 'line', at: 950, dur: 500, dir: 'back', glyph: 'envelope', tone: 'reply' },
    { do: 'gulp', on: 'from', at: 1450, dur: 200 },
  ])
})

test('event: a bolt, and a flash instead of a gulp', () => {
  const { beats, total } = beatsFor(plain('event'), { length: 250, afterLanding: false })
  assert.equal(total, 900)
  assert.deepEqual(beats.slice(1), [
    { do: 'gulp', on: 'from', at: 0, dur: 150 },
    { do: 'blob', on: 'line', at: 150, dur: 500, dir: 'fwd', glyph: 'bolt' },
    { do: 'flash', on: 'to', at: 650, dur: 250 },
  ])
})

test('callback triggered inside: a ring at the source first, because nothing came in', () => {
  const { beats, total } = beatsFor(plain('callback'), { length: 250, afterLanding: true })
  assert.equal(total, 1200)
  assert.deepEqual(beats.slice(1), [
    { do: 'ring', on: 'from', at: 0, dur: 400 },
    { do: 'blob', on: 'line', at: 300, dur: 500, dir: 'fwd', glyph: 'bell' },
    { do: 'ring', on: 'to', at: 800, dur: 400 },
  ])
})

test('callback triggered outside: kicked if the step before landed here, otherwise a bolt drops in first', () => {
  const outside = plain('callback', { trigger: 'outside' })
  const after = beatsFor(outside, { length: 250, afterLanding: true })
  assert.equal(after.total, 1100)
  assert.deepEqual(after.beats.slice(1), [
    { do: 'flash', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 200, dur: 500, dir: 'fwd', glyph: 'bell' },
    { do: 'ring', on: 'to', at: 700, dur: 400 },
  ])
  const alone = beatsFor(outside, { length: 250, afterLanding: false })
  assert.equal(alone.total, 1450)
  assert.deepEqual(alone.beats.slice(1), [
    { do: 'drop', on: 'from', at: 0, dur: 350, glyph: 'bolt' },
    { do: 'flash', on: 'from', at: 350, dur: 250 },
    { do: 'blob', on: 'line', at: 550, dur: 500, dir: 'fwd', glyph: 'bell' },
    { do: 'ring', on: 'to', at: 1050, dur: 400 },
  ])
})

test('carries labels the blob going out, and not the reply', () => {
  const { beats } = beatsFor(plain('call', { carries: 'order' }), { length: 250, afterLanding: false })
  const blobs = beats.filter(b => b.do === 'blob')
  assert.deepEqual(blobs.map(b => b.label), ['order', undefined])
})

test('a longer line takes longer, up to the cap', () => {
  assert.equal(beatsFor(plain('send'), { length: 5000, afterLanding: false }).total, 350 + 1100)
  assert.equal(beatsFor(plain('send'), { length: 0, afterLanding: false }).total, 350 + 500)
})

const recurse = (depth: number, more: Partial<Animation> = {}): Animation => ({ kind: 'recurse', trigger: 'inside', depth, ...more })

test('recurse, depth 3: the stack climbs, a flag lands, the answers unwind', () => {
  const { beats, total } = beatsFor(recurse(3), { length: 250, afterLanding: false })
  assert.equal(total, 3230)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 3230 },
    { do: 'gulp', on: 'from', at: 0, dur: 120 },
    { do: 'blob', on: 'line', at: 120, dur: 500, dir: 'fwd', glyph: 'envelope' },
    { do: 'stack', on: 'from', at: 620, dur: 150, level: 1 },
    { do: 'gulp', on: 'from', at: 620, dur: 120 },
    { do: 'blob', on: 'line', at: 740, dur: 500, dir: 'fwd', glyph: 'envelope' },
    { do: 'stack', on: 'from', at: 1240, dur: 150, level: 2 },
    { do: 'drop', on: 'from', at: 1240, dur: 350, glyph: 'flag' },
    { do: 'flash', on: 'from', at: 1440, dur: 250 },
    { do: 'blob', on: 'line', at: 1690, dur: 500, dir: 'back', glyph: 'envelope', tone: 'reply' },
    { do: 'gulp', on: 'from', at: 2190, dur: 120 },
    { do: 'stack', on: 'from', at: 2190, dur: 150, level: 1 },
    { do: 'blob', on: 'line', at: 2310, dur: 500, dir: 'back', glyph: 'envelope', tone: 'reply' },
    { do: 'gulp', on: 'from', at: 2810, dur: 120 },
    { do: 'stack', on: 'from', at: 2810, dur: 150, level: 0 },
    { do: 'ring', on: 'from', at: 2930, dur: 300 },
  ])
})

test('recurse: the depth and the length of the pipe set how long it takes', () => {
  assert.equal(beatsFor(recurse(2), { length: 250, afterLanding: false }).total, 1990)
  assert.equal(beatsFor(recurse(5), { length: 250, afterLanding: false }).total, 5710)
  assert.equal(beatsFor(recurse(3), { length: 5000, afterLanding: false }).total, 5630)
  assert.equal(beatsFor(recurse(3), { length: 0, afterLanding: false }).total, 3230)
})

test('recurse: the stack levels climb then fall to nothing', () => {
  const stack = beatsFor(recurse(5), { length: 250, afterLanding: false }).beats.filter(b => b.do === 'stack')
  assert.deepEqual(stack.map(b => b.level), [1, 2, 3, 4, 3, 2, 1, 0])
  assert.ok(stack.every(b => b.on === 'from' && b.dur === 150))
})

test('recurse: carries labels the blobs going in and returns the blobs coming back', () => {
  const labelled = beatsFor(recurse(3, { carries: 'CNAME', returns: 'A record' }), { length: 250, afterLanding: false }).beats.filter(b => b.do === 'blob')
  assert.deepEqual(labelled.map(b => [b.dir, b.label]), [['fwd', 'CNAME'], ['fwd', 'CNAME'], ['back', 'A record'], ['back', 'A record']])
  const bare = beatsFor(recurse(3), { length: 250, afterLanding: false }).beats.filter(b => b.do === 'blob')
  assert.ok(bare.every(b => !('label' in b)))
})

test('recurse: every beat is on the box or on its pipe, never on a second box', () => {
  const { beats } = beatsFor(recurse(4, { carries: 'x', returns: 'y' }), { length: 300, afterLanding: true })
  assert.ok(beats.every(b => b.on === 'from' || b.on === 'line'))
})
