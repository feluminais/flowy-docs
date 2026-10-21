import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ANIMATION_KINDS, animationOf, DEFAULT_TAKER, animationProblem, animationWith, beatsFor, burstOf, followsLanding, interceptorProblem, KIND_SKETCHES, LABEL_MAX, lostAtOf, OUTCOME_SKETCHES, OUTCOMES, outcomeBlock, outcomeLine, shareOf, shortLabel, TINTS, travelMs } from '../src/core/animation.ts'
import type { Animation, Beat } from '../src/core/animation.ts'

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
  const every = 'animation outcome must be fail, timeout, lost, rejected, intercepted, duplicated or delayed'
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
    [{ kind: 'send', speed: 'fast' }, true, 'unknown animation option "speed" (use kind, trigger, carries, outcome, share, reason, by, at)'],
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
    [{ kind: 'call', outcome: 'maybe' }, true, every],
    [{ kind: 'call', outcome: '' }, true, every],
    [{ kind: 'call', outcome: ['fail'] }, true, every],
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

const sent = (more: Record<string, unknown>) => ({ kind: 'send', ...more })

test('the five outcomes after fail and timeout are valid on a send, a call and an event, and never on a callback', () => {
  for (const outcome of ['lost', 'rejected', 'duplicated', 'delayed']) {
    for (const kind of ['send', 'call', 'event']) assert.equal(animationProblem({ kind, outcome }, true), undefined, `${kind} ${outcome}`)
    assert.equal(animationProblem({ kind: 'callback', outcome }, true), `animation outcome ${outcome} only applies to send, call and event`)
  }
  for (const kind of ['send', 'call', 'event']) assert.equal(animationProblem({ kind, outcome: 'intercepted', by: 'proxy' }, true), undefined, kind)
  assert.equal(animationProblem({ kind: 'callback', outcome: 'intercepted', by: 'proxy' }, true), 'animation outcome intercepted only applies to send, call and event')
  assert.equal(animationProblem(sent({ outcome: 'lost' }), false), 'animation "send" needs a "to"')
})

test('share is a whole percent from 1 to 100, as a number or as the text a file holds, and needs an outcome', () => {
  for (const ok of [1, 30, 99, 100, '1', '30', '100']) assert.equal(animationProblem(sent({ outcome: 'lost', share: ok }), true), undefined, String(ok))
  const why = 'animation share must be a whole number from 1 to 100'
  for (const bad of [0, 101, 30.5, -3, Number.NaN, '0', '101', '30.5', '30%', ' 30', '', 'a third', null, [30], { n: 30 }, true])
    assert.equal(animationProblem(sent({ outcome: 'lost', share: bad }), true), why, JSON.stringify(bad))
  assert.equal(animationProblem(sent({ share: 30 }), true), 'animation share needs an outcome')
  assert.equal(animationProblem({ kind: 'call', outcome: 'timeout', share: 50 }, true), undefined)
  assert.equal(animationProblem(sent({ outcome: 'fail', share: 50 }), true), undefined)
})

test('a reason is one line of plain text, at most 40 characters, and needs an outcome', () => {
  assert.equal(animationProblem(sent({ outcome: 'rejected', reason: 'Rate limit' }), true), undefined)
  assert.equal(animationProblem(sent({ outcome: 'rejected', reason: 'x'.repeat(40) }), true), undefined)
  assert.equal(animationProblem(sent({ outcome: 'rejected', reason: 'x'.repeat(41) }), true), 'animation reason can be at most 40 characters')
  const why = 'animation reason must be plain text on one line'
  for (const bad of ['', '   ', 'two\nlines', 'tab\there', 'bell\u0007', 'line' + String.fromCharCode(0x2028) + 'break', ['Rate limit'], 3, null, { text: 'x' }])
    assert.equal(animationProblem(sent({ outcome: 'rejected', reason: bad }), true), why, JSON.stringify(bad))
  assert.equal(animationProblem(sent({ reason: 'Rate limit' }), true), 'animation reason needs an outcome')
  for (const outcome of ['fail', 'timeout', 'lost', 'duplicated', 'delayed']) assert.equal(animationProblem({ kind: 'call', outcome, reason: 'Why' }, true), undefined, outcome)
})

test('by names who takes an intercepted request: a shape id or a name, and nothing else', () => {
  const take = (by: unknown) => animationProblem(sent({ outcome: 'intercepted', by }), true)
  assert.equal(take('proxy'), undefined)
  assert.equal(take({ name: 'Café wifi proxy' }), undefined)
  assert.equal(take({ name: 'x'.repeat(24) }), undefined)
  assert.equal(take({ name: 'x'.repeat(25) }), 'animation by name can be at most 24 characters')
  const hint = 'animation by must be a shape id or { name: ... }'
  for (const bad of ['', '  ', ['proxy'], 7, null, true, { name: 'ok', color: 'red' }, { shape: 'proxy' }]) assert.equal(take(bad), hint, JSON.stringify(bad))
  const nameWhy = 'animation by name must be plain text on one line'
  for (const bad of [{}, { name: '' }, { name: '  ' }, { name: 'a\nb' }, { name: ['x'] }, { name: 3 }]) assert.equal(take(bad), nameWhy, JSON.stringify(bad))
  assert.equal(animationProblem(sent({ outcome: 'intercepted' }), true), 'animation outcome intercepted needs a "by" (a shape id, or { name: ... })')
  assert.equal(animationProblem(sent({ outcome: 'lost', by: 'proxy' }), true), 'animation by only applies to outcome intercepted')
  assert.equal(animationProblem(sent({ by: { name: 'x' } }), true), 'animation by only applies to outcome intercepted')
})

test('at is how far along the line a lost request vanishes, 0.1 to 0.9, and only for lost', () => {
  for (const ok of [0.1, 0.55, 0.9, '0.1', '0.55', '.5', '0.90']) assert.equal(animationProblem(sent({ outcome: 'lost', at: ok }), true), undefined, String(ok))
  const why = 'animation at must be a number from 0.1 to 0.9'
  for (const bad of [0, 0.09, 0.91, 1, -0.5, Number.NaN, '0', '1', '0.05', '50%', '', 'half', null, [0.5]]) assert.equal(animationProblem(sent({ outcome: 'lost', at: bad }), true), why, JSON.stringify(bad))
  assert.equal(animationProblem(sent({ outcome: 'delayed', at: 0.5 }), true), 'animation at only applies to outcome lost')
  assert.equal(animationProblem(sent({ at: 0.5 }), true), 'animation at only applies to outcome lost')
  assert.equal(lostAtOf('0.5'), 0.5)
  assert.equal(shareOf('30'), 30)
  assert.equal(shareOf(' 30'), undefined)
})

test('an interception that names a shape needs a shape that exists and is not an end of the step', () => {
  const exists = (id: string) => ['web', 'api', 'proxy'].includes(id)
  const step = { from: 'web', to: 'api' }
  const by = (b: unknown) => interceptorProblem(sent({ outcome: 'intercepted', by: b }), step, exists)
  assert.equal(by('proxy'), undefined)
  assert.equal(by(' proxy '), undefined)
  assert.equal(by('ghost'), 'animation by: unknown object "ghost"')
  assert.equal(by('web'), 'animation by "web" is an end of the step (name another shape, or use { name: ... })')
  assert.equal(by('api'), 'animation by "api" is an end of the step (name another shape, or use { name: ... })')
  // A name is never checked against the model, and nothing else is this check's business.
  assert.equal(by({ name: 'web' }), undefined)
  assert.equal(by(''), undefined)
  assert.equal(by(['web']), undefined)
  assert.equal(interceptorProblem(sent({ outcome: 'lost', by: 'web' }), step, exists), undefined)
  assert.equal(interceptorProblem('send', step, exists), undefined)
  assert.equal(interceptorProblem(undefined, step, exists), undefined)
})

test('the new keys read after the old ones, with text becoming numbers and names trimmed', () => {
  assert.deepEqual(
    animationOf({ to: 'b', animation: { kind: 'send', carries: 'ping', outcome: 'lost', share: '30', reason: ' Packet dropped ', at: '0.4' } }),
    { kind: 'send', trigger: 'inside', carries: 'ping', outcome: 'lost', share: 30, reason: 'Packet dropped', at: 0.4 },
  )
  assert.deepEqual(
    animationOf({ to: 'b', animation: { kind: 'call', outcome: 'intercepted', by: ' proxy ' } }),
    { kind: 'call', trigger: 'inside', outcome: 'intercepted', by: { shape: 'proxy' } },
  )
  assert.deepEqual(
    animationOf({ to: 'b', animation: { kind: 'call', outcome: 'intercepted', by: { name: ' Café wifi proxy ' }, share: 100 } }),
    { kind: 'call', trigger: 'inside', outcome: 'intercepted', share: 100, by: { name: 'Café wifi proxy' } },
  )
  assert.equal(animationOf({ to: 'b', animation: { kind: 'send', outcome: 'lost', share: 0 } }), undefined)
  assert.equal(animationOf({ to: 'b', animation: { kind: 'send', outcome: 'intercepted' } }), undefined)
  // A plain step is read exactly as before, with none of the new keys.
  assert.deepEqual(animationOf({ to: 'b', animation: 'call' }), { kind: 'call', trigger: 'inside' })
  assert.deepEqual(animationOf({ to: 'b', animation: { kind: 'send', outcome: 'fail' } }), { kind: 'send', trigger: 'inside', outcome: 'fail' })
})

test('a share plays 10 requests for a multiple of 10, 20 for a multiple of 5, else 100, with the hits spread evenly', () => {
  const at = (hit: boolean[]) => hit.flatMap((h, i) => (h ? [i] : []))
  const thirty = burstOf(30)
  assert.equal(thirty.count, 10)
  // Request i is hit when floor((i+1)*30/100) passes floor(i*30/100): the 4th, 7th and 10th request (0-based 3, 6, 9).
  assert.deepEqual(at(thirty.hit), [3, 6, 9])
  const half = burstOf(50)
  assert.equal(half.count, 10)
  assert.equal(half.hit.filter(Boolean).length, 5)
  assert.deepEqual(at(half.hit), [1, 3, 5, 7, 9])
  const five = burstOf(5)
  assert.deepEqual([five.count, at(five.hit)], [20, [19]])
  const one = burstOf(1)
  assert.deepEqual([one.count, at(one.hit)], [100, [99]])
  const all = burstOf(100)
  assert.deepEqual([all.count, all.hit.every(Boolean)], [10, true])
  // Whatever the share, the number of hits is exactly the share of the burst.
  for (let share = 1; share <= 100; share++) {
    const { count, hit } = burstOf(share)
    assert.equal(hit.length, count)
    assert.equal(hit.filter(Boolean).length, (count * share) / 100, `share ${share}`)
  }
  assert.deepEqual(burstOf(30), burstOf(30))
})

test('the card line says the outcome in a fragment: the share first, then the verb, then the reason', () => {
  const line = (more: Partial<Animation>) => outcomeLine(plain('send', more))
  assert.equal(line({}), undefined)
  assert.equal(line({ outcome: 'lost' }), 'Lost')
  assert.equal(line({ outcome: 'lost', share: 30 }), '30% lost')
  assert.equal(line({ outcome: 'rejected', reason: 'Rate limit' }), 'Rejected: Rate limit')
  assert.equal(line({ outcome: 'intercepted', by: { name: 'Café wifi proxy' } }), 'Taken by Café wifi proxy')
  assert.equal(line({ outcome: 'duplicated' }), 'Sent twice')
  assert.equal(line({ outcome: 'duplicated', share: 30 }), '30% sent twice')
  assert.equal(line({ outcome: 'delayed', reason: 'Cold start' }), 'Delayed: Cold start')
  assert.equal(line({ outcome: 'fail' }), 'Fails')
  assert.equal(line({ outcome: 'fail', share: 30 }), '30% fail')
  assert.equal(line({ outcome: 'timeout' }), 'Times out')
  assert.equal(line({ outcome: 'timeout', share: 10, reason: 'Slow upstream' }), '10% time out: Slow upstream')
  assert.equal(line({ outcome: 'intercepted', by: { name: 'Proxy' }, share: 50, reason: 'Reads the call' }), '50% taken by Proxy: Reads the call')
  // A shape that takes the request is named by its name, which only the model knows.
  assert.equal(line({ outcome: 'intercepted', by: { shape: 'cdn' } }), 'Taken by cdn')
  assert.equal(outcomeLine(plain('send', { outcome: 'intercepted', by: { shape: 'cdn' } }), id => (id === 'cdn' ? 'Edge cache' : id)), 'Taken by Edge cache')
})

// A line of 250 takes the shortest time to cross, 1200 ms, so the numbers below read without arithmetic.
const play = (kind: Animation['kind'], more: Partial<Animation>, length = 250) => beatsFor(plain(kind, more), { length, afterLanding: false })
const kinds = (beats: Beat[]) => beats.map(b => `${b.do}:${b.on}`)

test('a plain animation keeps every beat it had before the outcomes were added', () => {
  const expected = JSON.parse(readFileSync(join(import.meta.dirname, '../desktop/fixtures/expected/beats.json'), 'utf8')) as {
    beats: { animation: unknown; length: number; afterLanding: boolean; beats: unknown; total: number }[]
  }
  const old = expected.beats.filter(b => {
    const keys = typeof b.animation === 'string' ? [] : Object.keys(b.animation as object)
    return keys.every(k => ['kind', 'trigger', 'carries', 'outcome'].includes(k)) && ['fail', 'timeout', undefined].includes((b.animation as { outcome?: string }).outcome)
  })
  assert.ok(old.length > 100)
  for (const b of old) {
    const a = animationOf({ to: 'x', animation: b.animation })!
    const played = beatsFor(a, { length: b.length, afterLanding: b.afterLanding })
    assert.deepEqual({ beats: played.beats, total: played.total }, { beats: b.beats, total: b.total }, JSON.stringify(b.animation))
  }
})

test('lost: it runs partway, pops, and nothing lands; a call keeps waiting', () => {
  const { beats, total } = play('send', { outcome: 'lost' })
  assert.equal(total, 1410)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 1410 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 660, dir: 'fwd', glyph: 'envelope', end: 0.55 },
    { do: 'pop', on: 'line', at: 910, dur: 500, along: 0.55 },
  ])
  assert.equal(beats.some(b => b.on === 'to'), false, 'nothing lands, so the receiver does not squash')
  const call = play('call', { outcome: 'lost', at: 0.4, reason: 'Packet dropped' })
  assert.deepEqual(call.beats.slice(2), [
    { do: 'blob', on: 'line', at: 250, dur: 480, dir: 'fwd', glyph: 'envelope', end: 0.4 },
    { do: 'pop', on: 'line', at: 730, dur: 500, along: 0.4 },
    { do: 'note', on: 'line', at: 730, dur: 1600, along: 0.4, text: 'Packet dropped' },
    { do: 'wait', on: 'from', at: 730, dur: 1800 },
  ])
  assert.equal(call.beats.some(b => b.dir === 'back'), false, 'no answer comes back')
  assert.equal(play('event', { outcome: 'lost' }).beats.find(b => b.do === 'blob')!.glyph, 'bolt')
})

test('rejected: it stops at the bar by the door, comes back in the danger tone, and the sender takes it in', () => {
  const { beats, total } = play('send', { outcome: 'rejected', reason: 'Rate limit' })
  assert.equal(total, 3208)
  assert.deepEqual(beats, [
    { do: 'pipe', on: 'line', at: 0, dur: 3208 },
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 1104, dir: 'fwd', glyph: 'envelope', end: 0.92 },
    { do: 'bar', on: 'line', at: 1354, dur: 900, along: 0.97 },
    { do: 'note', on: 'line', at: 1354, dur: 1600, along: 0.92, text: 'Rate limit' },
    { do: 'blob', on: 'line', at: 1804, dur: 1104, dir: 'back', glyph: 'envelope', tone: 'fail', end: 0.92 },
    { do: 'gulp', on: 'from', at: 2908, dur: 300 },
  ])
  assert.equal(beats.some(b => b.on === 'to'), false, 'the receiver never takes it in')
  const call = play('call', { outcome: 'rejected' })
  assert.ok(call.beats.some(b => b.do === 'wait' && b.on === 'from'))
  assert.equal(call.beats.filter(b => b.do === 'blob' && b.dir === 'back').length, 1)
})

test('intercepted: it leaves the line for the one who takes it, which flashes; a named party is marked for the whole step', () => {
  const named = play('call', { outcome: 'intercepted', by: { name: 'Proxy' }, reason: 'Reads the call' })
  assert.deepEqual(kinds(named.beats), [
    'pipe:line', 'marker:by', 'gulp:from', 'blob:line', 'blob:by', 'flash:by', 'note:by', 'wait:from',
  ])
  assert.deepEqual(named.beats[1], { do: 'marker', on: 'by', at: 0, dur: named.total, along: 0.4, text: 'Proxy' })
  assert.deepEqual(named.beats[4], { do: 'blob', on: 'by', at: 730, dur: 700, dir: 'fwd', glyph: 'envelope', start: 0.4 })
  assert.deepEqual(named.beats[5], { do: 'flash', on: 'by', at: 1430, dur: 450 })
  assert.equal(named.beats.some(b => b.on === 'to'), false)
  // A shape that takes it is marked too, with no text, because its own name is already on it.
  const shape = play('send', { outcome: 'intercepted', by: { shape: 'proxy' } })
  assert.deepEqual(shape.beats[1], { do: 'marker', on: 'by', at: 0, dur: shape.total, along: 0.4 })
  assert.equal(play('send', { outcome: 'lost' }).beats.some(b => b.do === 'marker'), false)
})

test('duplicated: a second copy leaves the first and the receiver takes it in twice, a call answers once', () => {
  const { beats, total } = play('send', { outcome: 'duplicated', carries: 'order' })
  assert.equal(total, 2170)
  const blobs = beats.filter(b => b.do === 'blob')
  assert.equal(blobs.length, 2)
  assert.deepEqual(blobs.map(b => [b.label, b.start]), [['order', undefined], ['order', 0.4]])
  const gulps = beats.filter(b => b.do === 'gulp' && b.on === 'to')
  assert.deepEqual(gulps.map(b => b.at), [1450, 1870])
  // An event is lit twice instead.
  assert.equal(play('event', { outcome: 'duplicated' }).beats.filter(b => b.do === 'flash' && b.on === 'to').length, 2)
  const call = play('call', { outcome: 'duplicated' })
  assert.equal(call.beats.filter(b => b.do === 'gulp' && b.on === 'to').length, 2)
  const reply = call.beats.filter(b => b.do === 'blob' && b.dir === 'back')
  assert.equal(reply.length, 1)
  assert.ok(reply[0].at >= 1870 + 600, 'the answer starts after the second copy has landed')
})

test('delayed: it runs to the clock, waits there while the reason shows, then goes on and lands', () => {
  const { beats, total } = play('send', { outcome: 'delayed', reason: 'Cold start' })
  assert.equal(total, 250 + 480 + 1500 + 720 + 300)
  assert.deepEqual(beats.slice(1), [
    { do: 'gulp', on: 'from', at: 0, dur: 250 },
    { do: 'blob', on: 'line', at: 250, dur: 480, dir: 'fwd', glyph: 'envelope', end: 0.4 },
    { do: 'blob', on: 'line', at: 730, dur: 1500, dir: 'fwd', glyph: 'envelope', start: 0.4, end: 0.4 },
    { do: 'clock', on: 'line', at: 730, dur: 1500, along: 0.4 },
    { do: 'note', on: 'line', at: 730, dur: 1500, along: 0.4, text: 'Cold start' },
    { do: 'blob', on: 'line', at: 2230, dur: 720, dir: 'fwd', glyph: 'envelope', start: 0.4 },
    { do: 'gulp', on: 'to', at: 2950, dur: 300 },
  ])
  // A call still gets its answer after the delay.
  const call = play('call', { outcome: 'delayed' })
  assert.deepEqual(kinds(call.beats).slice(-3), ['wait:from', 'blob:line', 'gulp:from'])
  assert.equal(call.beats.at(-2)!.dir, 'back')
})

test('the beats of a step have the same kinds and order at any length of line', () => {
  for (const outcome of ['fail', 'timeout', 'lost', 'rejected', 'intercepted', 'duplicated', 'delayed'] as const) {
    const more = { outcome, reason: 'Why', ...(outcome === 'intercepted' ? { by: { name: 'Proxy' } } : {}) }
    const shapes = [0, 100, 600, 5000].map(length => kinds(beatsFor(plain('call', more), { length, afterLanding: false }).beats))
    for (const s of shapes) assert.deepEqual(s, shapes[0], outcome)
  }
})

test('a share plays a burst: the hits are named r1, r2, ... and the ordinary requests carry no name', () => {
  const { beats, total } = play('send', { outcome: 'lost', share: 30 })
  const blobs = beats.filter(b => b.do === 'blob')
  assert.equal(blobs.length, 10, 'ten requests')
  assert.deepEqual(blobs.map(b => b.label), [undefined, undefined, undefined, 'r1', undefined, undefined, 'r2', undefined, undefined, 'r3'])
  assert.deepEqual(blobs.map(b => b.at), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => 250 + i * 300))
  // The ordinary ones are deliveries with a squash where they land; the hits pop and nothing lands.
  assert.equal(beats.filter(b => b.do === 'gulp' && b.on === 'to').length, 7)
  assert.equal(beats.filter(b => b.do === 'pop').length, 3)
  // A hit has a colour of its own and a ring, and an ordinary request has neither.
  assert.deepEqual(blobs.filter(b => b.label !== undefined).map(b => [b.tint, b.ring]), [[0, true], [1, true], [2, true]])
  assert.ok(blobs.filter(b => b.label === undefined).every(b => b.tint === undefined && b.ring === undefined && b.end === undefined))
  assert.equal(beats[0].dur, total)
  assert.equal(total, Math.max(...beats.map(b => b.at + b.dur)))
})

test('carries names every hit, and a long run of tints starts over', () => {
  const named = play('send', { outcome: 'fail', share: 50, carries: 'order' }).beats.filter(b => b.do === 'blob')
  assert.deepEqual(named.map(b => b.label), [undefined, 'order', undefined, 'order', undefined, 'order', undefined, 'order', undefined, 'order'])
  assert.deepEqual(named.filter(b => b.tone === 'fail').length, 5, 'only the hits fail')
  // A word that looks like a request name is still just the word.
  assert.equal(play('send', { outcome: 'lost', share: 100, carries: 'r2' }).beats.filter(b => b.do === 'blob').every(b => b.label === 'r2'), true)
  const tints = play('send', { outcome: 'lost', share: 100 }).beats.filter(b => b.do === 'blob').map(b => b.tint)
  assert.deepEqual(tints, [0, 1, 2, 3, 0, 1, 2, 3, 0, 1])
  assert.ok(TINTS.length >= 4)
})

test('a duplicated pair is one request: both copies carry the same name and tint, unlike the ordinary requests', () => {
  const blobs = play('send', { outcome: 'duplicated', share: 10 }).beats.filter(b => b.do === 'blob')
  assert.equal(blobs.length, 11, 'nine ordinary requests and a hit sent twice')
  const copies = blobs.filter(b => b.label !== undefined)
  assert.equal(copies.length, 2)
  assert.deepEqual(copies.map(b => [b.label, b.tint, b.ring]), [['r1', 0, true], ['r1', 0, true]])
  assert.ok(blobs.filter(b => b.label === undefined).every(b => b.tint === undefined))
  assert.equal(play('send', { outcome: 'duplicated', share: 10 }).beats.filter(b => b.do === 'gulp' && b.on === 'to').length, 9 + 2)
})

test('a burst stays short: 100 requests start within four seconds, and a call answers every one of them', () => {
  for (const kind of ['send', 'call', 'event'] as const) {
    for (const length of [0, 250, 5000]) {
      const longest = Math.max(...[{ outcome: 'lost' as const }, {}].map(more => beatsFor(plain(kind, more), { length, afterLanding: false }).total))
      const { beats, total } = beatsFor(plain(kind, { outcome: 'lost', share: 1 }), { length, afterLanding: false })
      assert.equal(beats.filter(b => b.do === 'blob' && b.dir === 'fwd').length, 100)
      assert.ok(total <= longest + 4000, `${kind} ${length}: ${total}`)
    }
  }
  const call = beatsFor(plain('call', { outcome: 'lost', share: 1 }), { length: 5000, afterLanding: false })
  assert.ok(call.total < 6000 + 2 * travelMs(5000) + 1800, String(call.total))
  const answered = beatsFor(plain('call', { outcome: 'lost', share: 30 }), { length: 250, afterLanding: false }).beats
  assert.equal(answered.filter(b => b.do === 'blob' && b.dir === 'back').length, 7, 'every request that arrives is answered')
  assert.equal(answered.filter(b => b.do === 'wait').length, 10)
})

test('a short line spaces the requests of a burst further apart, so its blobs do not run into each other', () => {
  const starts = (length: number) => beatsFor(plain('send', { outcome: 'lost', share: 30 }), { length, afterLanding: false }).beats.filter(b => b.do === 'blob' && b.dir === 'fwd').map(b => b.at)
  const gap = (length: number) => starts(length)[1] - starts(length)[0]
  assert.equal(gap(250), 300)
  assert.equal(gap(5000), 300)
  assert.equal(gap(91), 444, 'a line of 91 px is crossed in 1200 ms, so 36 px apart is 475 ms, held to the 4 s the burst may take')
  assert.ok(gap(120) > 300 && gap(120) < 444)
  assert.equal(gap(0), 300, 'a line that has not been measured yet is spaced as usual')
  assert.equal(gap(Number.NaN), 300)
  // A burst of 100 is a stream, not a row: it keeps to its few seconds whatever the line.
  const stream = beatsFor(plain('send', { outcome: 'lost', share: 1 }), { length: 91, afterLanding: false }).beats.filter(b => b.do === 'blob' && b.dir === 'fwd').map(b => b.at)
  assert.equal(stream.at(-1)! - stream[0], 99 * 40)
})

test('a burst of timeouts dims the line once, after the last of them', () => {
  const { beats } = play('call', { outcome: 'timeout', share: 30 })
  assert.equal(beats.filter(b => b.do === 'fade').length, 1)
  const last = beats.filter(b => b.do === 'wait').at(-1)!
  assert.equal(beats.find(b => b.do === 'fade')!.at, last.at + last.dur)
})

test('a share without an outcome plays one ordinary request, and a callback never plays a burst', () => {
  assert.deepEqual(play('send', { share: 30 }), play('send', {}))
  assert.deepEqual(play('callback', { share: 30 }), play('callback', {}))
})

test('a long carried word is cut for display, and the beat keeps the whole word', () => {
  assert.equal(shortLabel('order'), 'order')
  assert.equal(shortLabel('a'.repeat(LABEL_MAX)), 'a'.repeat(LABEL_MAX))
  assert.equal(shortLabel('a'.repeat(LABEL_MAX + 1)), `${'a'.repeat(LABEL_MAX - 1)}…`)
  assert.equal(play('send', { carries: 'x'.repeat(80) }).beats.find(b => b.do === 'blob')!.label, 'x'.repeat(80))
})

test('the pickers have a sketch for every way to travel and every way to end, and each is a path on the 44 by 24 grid', () => {
  assert.deepEqual(Object.keys(KIND_SKETCHES), ['none', ...ANIMATION_KINDS])
  assert.deepEqual(Object.keys(OUTCOME_SKETCHES), ['none', ...OUTCOMES])
  for (const d of [...Object.values(KIND_SKETCHES), ...Object.values(OUTCOME_SKETCHES)]) {
    assert.match(d, /^M[\d\s.MHVlLhvazZ-]+$/)
    for (const n of d.match(/-?\d+\.?\d*/g)!.map(Number)) assert.ok(Math.abs(n) <= 44, d)
  }
  assert.equal(new Set(Object.values(OUTCOME_SKETCHES)).size, 8, 'no two outcomes are drawn alike')
})

test('an outcome that a step cannot have is blocked with the reason, and one it can have is not', () => {
  assert.equal(outcomeBlock('call', ''), undefined)
  assert.equal(outcomeBlock('', ''), undefined)
  assert.equal(outcomeBlock('', 'lost'), 'Pick how it travels first')
  assert.equal(outcomeBlock(undefined, 'fail'), 'Pick how it travels first')
  for (const outcome of OUTCOMES) assert.equal(outcomeBlock('callback', outcome), 'Not for a callback')
  assert.equal(outcomeBlock('send', 'timeout'), 'Needs a call')
  assert.equal(outcomeBlock('event', 'timeout'), 'Needs a call')
  assert.equal(outcomeBlock('event', 'fail'), 'Needs a send or a call')
  for (const outcome of ['fail', 'timeout', 'lost', 'rejected', 'intercepted', 'duplicated', 'delayed']) assert.equal(outcomeBlock('call', outcome), undefined, outcome)
  // The picker and the checker agree: whatever is blocked is a problem, and the rest is not.
  for (const kind of ANIMATION_KINDS) {
    for (const outcome of OUTCOMES) {
      const raw = { kind, outcome, ...(outcome === 'intercepted' ? { by: { name: 'Proxy' } } : {}) }
      assert.equal(outcomeBlock(kind, outcome) !== undefined, animationProblem(raw, true) !== undefined, `${kind} ${outcome}`)
    }
  }
})

test('picking in edit mode builds the animation key by key and keeps it valid', () => {
  assert.equal(animationWith(undefined, 'kind', 'call'), 'call')
  assert.deepEqual(animationWith('call', 'outcome', 'rejected'), { kind: 'call', outcome: 'rejected' })
  // An interception always has someone who takes it, so picking it is valid at once, and taking the taker away puts the placeholder back.
  assert.deepEqual(animationWith('call', 'outcome', 'intercepted'), { kind: 'call', outcome: 'intercepted', by: { name: DEFAULT_TAKER } })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted', by: 'cache' }, 'by', ''), { kind: 'call', outcome: 'intercepted', by: { name: DEFAULT_TAKER } })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted', by: 'cache' }, 'byName', ''), { kind: 'call', outcome: 'intercepted', by: { name: DEFAULT_TAKER } })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted', by: 'cache' }, 'outcome', 'lost'), { kind: 'call', outcome: 'lost' })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'rejected' }, 'reason', ' Rate limit '), { kind: 'call', outcome: 'rejected', reason: 'Rate limit' })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'rejected', reason: 'Rate limit' }, 'share', '30'), { kind: 'call', outcome: 'rejected', reason: 'Rate limit', share: '30' })
  // Taking a text away removes its key, and taking the last extra away leaves the bare kind.
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'rejected', reason: 'x' }, 'reason', '  '), { kind: 'call', outcome: 'rejected' })
  assert.equal(animationWith({ kind: 'call', outcome: 'rejected' }, 'outcome', ''), 'call')
  // No outcome takes away what only an outcome has.
  assert.equal(animationWith({ kind: 'send', outcome: 'lost', share: '30', reason: 'x', at: '0.4' }, 'outcome', ''), 'send')
  // The one who takes a request: a shape or a name, and picking one replaces the other.
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted' }, 'by', 'cache'), { kind: 'call', outcome: 'intercepted', by: 'cache' })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted', by: 'cache' }, 'byName', 'Café wifi proxy'), { kind: 'call', outcome: 'intercepted', by: { name: 'Café wifi proxy' } })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted', by: { name: 'Proxy' } }, 'by', 'cache'), { kind: 'call', outcome: 'intercepted', by: 'cache' })
  // Another outcome drops what belongs to the old one, and another kind drops an outcome it cannot have.
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'intercepted', by: 'cache', reason: 'x' }, 'outcome', 'lost'), { kind: 'call', outcome: 'lost', reason: 'x' })
  assert.deepEqual(animationWith({ kind: 'send', outcome: 'lost', at: '0.4' }, 'outcome', 'rejected'), { kind: 'send', outcome: 'rejected' })
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'timeout', share: '20', reason: 'x' }, 'kind', 'send'), { kind: 'send' }.kind)
  assert.deepEqual(animationWith({ kind: 'call', outcome: 'lost', reason: 'x' }, 'kind', 'event'), { kind: 'event', outcome: 'lost', reason: 'x' })
  assert.equal(animationWith({ kind: 'call', outcome: 'lost', reason: 'x' }, 'kind', 'callback'), 'callback')
  assert.equal(animationWith({ kind: 'callback', trigger: 'outside', carries: 'x' }, 'kind', 'send') !== undefined, true)
  assert.deepEqual(animationWith({ kind: 'callback', trigger: 'outside', carries: 'x' }, 'kind', 'send'), { kind: 'send', carries: 'x' })
  // A kind of None takes the whole animation away.
  assert.equal(animationWith({ kind: 'call', outcome: 'lost' }, 'kind', ''), undefined)
  assert.equal(animationWith('call', 'kind', ''), undefined)
  // A key that is there keeps its place, and the keys it has no business with are kept.
  assert.deepEqual(Object.keys(animationWith({ kind: 'send', outcome: 'lost', carries: 'order' }, 'outcome', 'delayed') as object), ['kind', 'outcome', 'carries'])
  // Whatever is picked passes the checker, once the step has two ends.
  const picks: [string, string][] = [['kind', 'call'], ['outcome', 'intercepted'], ['byName', 'Proxy'], ['reason', 'Slow'], ['share', '50'], ['outcome', 'lost'], ['kind', 'event'], ['kind', 'callback']]
  let current: unknown
  for (const [key, value] of picks) {
    current = animationWith(current, key as 'kind', value)
    assert.equal(animationProblem(current, true), undefined, `after ${key} ${value}: ${JSON.stringify(current)}`)
  }
})
