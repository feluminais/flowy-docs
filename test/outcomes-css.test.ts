import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The ways a request can end (src/core/animation.ts) are drawn by ui/src/StepMotion.tsx with a few classes, styled in ui/src/style.css. Nothing in the
 * stylesheet moves on its own except the clock, and that only for a reader who has not asked for less motion: with reduced motion the marks stay and the
 * clock is a still picture.
 */
const source = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** The text of every top-level block, with its prelude: a rule, or an at-rule such as a media query with its rules inside. */
function blocks(css: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = []
  let depth = 0
  let head = ''
  let start = 0
  for (let i = 0; i < css.length; i++) {
    if (css[i] === '{') {
      if (depth === 0) {
        head = css.slice(start, i).trim()
        start = i + 1
      }
      depth++
    } else if (css[i] === '}') {
      depth--
      if (depth === 0) {
        out.push({ head, body: css.slice(start, i) })
        start = i + 1
      }
    }
  }
  return out
}

const top = blocks(source)
const plain = top.filter(b => !b.head.startsWith('@'))
const calm = top.filter(b => b.head.replace(/\s+/g, ' ') === '@media (prefers-reduced-motion: no-preference)').flatMap(b => blocks(b.body))
const selectors = (rules: { head: string }[]) => rules.flatMap(r => r.head.split(',').map(s => s.trim()))

test('every class StepMotion draws an outcome with has a rule', () => {
  const has = (cls: string) => selectors(plain).some(s => s.split(/[\s>]+/).some(part => part.split(/[.:]/).includes(cls)))
  for (const cls of ['pop', 'puff', 'tick', 'cross', 'bar', 'clock', 'dial', 'spark', 'orbit', 'hands', 'note', 'marker', 'halo', 'tinted']) assert.ok(has(cls), `.${cls} has no rule`)
})

test('a request in a burst takes its colour from --req, and its ring is never filled', () => {
  const fills = plain.filter(b => b.head.includes('.blob.tinted') && /fill:\s*var\(--req\)/.test(b.body))
  assert.equal(fills.length, 1)
  assert.match(fills[0].head, /:not\(\.halo\)/, 'the colour fills the dot, not the ring around it')
  const danger = plain.filter(b => b.head.includes('.blob.tinted.fail'))
  assert.equal(danger.length, 1, 'a refusal coming back is red whatever its tint')
  assert.match(danger[0].body, /fill:\s*var\(--danger\)/)
  const ring = plain.find(b => /\.blob \.halo/.test(b.head))!
  assert.match(ring.body, /fill:\s*none/)
  assert.match(ring.body, /stroke:\s*var\(--req/)
})

test('the colours of an outcome are the app tokens, never a colour written again', () => {
  const motion = plain.filter(b => /\.motion|\.player-outcome/.test(b.head)).map(b => b.body).join('\n')
  assert.equal(/#[0-9a-f]{3,8}\b/i.test(motion), false, 'a colour written as hex in the motion rules')
  assert.equal(/\b(rgb|hsl)a?\(/.test(motion), false)
})

test('only the clock moves by itself, and only with no preference for less motion', () => {
  const outside = plain.filter(b => /\banimation\s*:/.test(b.body) && /\.motion/.test(b.head))
  assert.deepEqual(outside.map(b => b.head), [], 'a motion rule animates outside the no-preference block')
  const inside = calm.filter(b => /\banimation\s*:/.test(b.body))
  assert.deepEqual(selectors(inside).sort(), ['.motion .clock .dial', '.motion .clock .orbit'])
  for (const name of ['dial-turn', 'orbit-turn']) {
    assert.ok(top.some(b => b.head === `@keyframes ${name}`), `${name} is missing`)
    assert.ok(inside.some(b => b.body.includes(name)), `${name} is not used`)
  }
})

test('the hands of the clock show only in a still picture', () => {
  const hands = plain.find(b => b.head === '.motion .clock .hands')!
  assert.match(hands.body, /display:\s*none/)
  const still = plain.find(b => b.head === '.motion .clock.still .hands')!
  assert.match(still.body, /display:\s*inline/)
})

test('the step card shows the outcome in the danger colour with a mark beside it', () => {
  const line = plain.find(b => b.head === '.player .player-outcome')!
  assert.match(line.body, /color:\s*var\(--danger\)/)
  assert.ok(plain.some(b => b.head === '.player-outcome::before'))
})
