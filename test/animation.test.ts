import { test } from 'node:test'
import assert from 'node:assert/strict'
import { animationOf, animationProblem, beatsFor, burstOf, followsLanding, interceptorProblem, lostAtOf, outcomeLine, shareOf, travelMs } from '../src/core/animation.ts'
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
