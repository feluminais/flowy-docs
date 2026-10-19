import { animationOf, animationProblem, beatsFor, followsLanding, travelMs } from '../../src/core/animation.ts'
import { active, bump, cardBox, cardsAt, distance, DWELL, ease, GAP, pillText, progress, tileSquash, tubeOpacity } from '../../ui/src/motion.ts'

/** Tags as the files can hold them: good ones, and every kind of wrong one. */
const RAW: unknown[] = [
  'send', 'call', 'callback', 'event',
  { kind: 'send', carries: 'order' }, { kind: 'call', carries: 'basket' },
  { kind: 'callback' }, { kind: 'callback', trigger: 'inside' }, { kind: 'callback', trigger: 'outside' }, { kind: 'callback', trigger: 'outside', carries: 'receipt' },
  '', 'sned', 'Send', { kind: '' }, {}, { carries: 'x' }, { kind: 'send', speed: 'fast' }, { kind: 'send', trigger: 'outside' },
  { kind: 'callback', trigger: 'sideways' }, { kind: 'send', carries: ' ' }, { kind: 'send', carries: '' }, ['send'], { kind: ['send'] }, { kind: { x: 'y' } },
  // Recursion. Files hold text, so depth is text here: a C# reader never sees a number.
  'recurse', { kind: 'recurse' }, { kind: 'recurse', depth: '2' }, { kind: 'recurse', depth: '5' }, { kind: 'recurse', depth: '4', carries: 'CNAME', returns: 'A record' },
  { kind: 'recurse', returns: ' ' }, { kind: 'recurse', trigger: 'outside' }, { kind: 'recurse', speed: 'fast' }, { kind: 'send', depth: '3' }, { kind: 'call', returns: 'x' },
  ...['1', '6', '3.5', '3x', '', '99999999999999999999'].map(depth => ({ kind: 'recurse', depth })),
]
const LENGTHS = [0, 100, 250, 400, 1000, 5000, 333.3]
const ENDS: [string, string][] = [['a', 'b'], ['b', 'c'], ['a', 'c'], ['a', 'a']]
const SPAN = { at: 100, dur: 400 }
const TUBE = { at: 0, dur: 1000 }

/** The recursions whose pile of cards is dumped: depth and the length of the loop pipe. */
const PILES: [number, number][] = [[2, 250], [3, 250], [5, 250], [3, 0]]
const PILE_TIMES = [...Array.from({ length: 121 }, (_, i) => i * 50), 619, 695, 770, 2265, 2960]
const CARD_BOX = { x: 10, y: 20, width: 200, height: 72 }
const SQUASHES = [{ from: 0, to: 0 }, { from: 0.6, to: 0 }, { from: 0.2, to: 0.5 }, { from: 0.5, to: 0.2 }]

/** What the TypeScript says about tags: whether each is wrong, how it reads, how long a line takes, and every beat. */
export function dumpBeats(): unknown {
  const read = (animation: unknown, to: boolean) => animationOf({ ...(to ? { to: 'x' } : {}), animation })
  return {
    travel: LENGTHS.map(length => ({ length, ms: travelMs(length) })),
    problems: RAW.flatMap(animation => [true, false].map(to => ({ animation, to, problem: animationProblem(animation, to) ?? null }))),
    // Each tag is read on a step with a "to" and on one without, because recurse takes none and the rest need one.
    reads: RAW.flatMap(animation => [true, false].map(to => ({ animation, to, read: read(animation, to) ?? null }))),
    beats: RAW.flatMap(animation => [true, false].flatMap(to => {
      const a = read(animation, to)
      return a ? LENGTHS.flatMap(length => [false, true].map(afterLanding => ({ animation, to, length, afterLanding, ...beatsFor(a, { length, afterLanding }) }))) : []
    })),
    follows: [null, ...ENDS].flatMap(previous => [null, ...ENDS].map(current => ({ previous, current, follows: followsLanding(previous, current) }))),
    // The browser's drawing maths, which the desktop app ports (Flowy.Core/MotionMath.cs).
    motion: {
      gap: GAP,
      dwell: DWELL,
      ease: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(p => ({ p, ease: ease(p), bump: bump(p) })),
      progress: [0, 50, 100, 250, 499, 500, 900].map(t => ({ t, progress: progress(SPAN, t), active: active(SPAN, t), tube: tubeOpacity(TUBE, t) })),
      distance: (['fwd', 'back'] as const).flatMap(dir => [0, 0.3, 1].map(p => ({ dir, p, distance: distance(dir, p, 200) }))),
      // A recursion's pile of cards and its counter (Flowy.Core/MotionMath.cs ports them).
      cards: PILES.flatMap(([depth, length]) => {
        const beats = beatsFor({ kind: 'recurse', trigger: 'inside', depth }, { length, afterLanding: false }).beats
        return PILE_TIMES.map(t => ({ depth, length, t, cards: cardsAt(beats, t) }))
      }),
      cardBoxes: [1, 2, 3, 4].flatMap(k => [0, 0.25, 0.5, 1].map(amount => ({ k, amount, box: cardBox(CARD_BOX, k, amount) }))),
      pills: [false, true].flatMap(playing => [2, 3, 4, 5].flatMap(depth => [0, 0.5, 1, 1.4, 1.5, 1.6, 2.5, 3.4].map(cards => ({ playing, depth, cards, text: pillText(playing, cards, depth) })))),
      squashes: [false, true].flatMap(sameBox => SQUASHES.map(squash => ({ sameBox, squash, result: tileSquash(sameBox, squash) }))),
    },
  }
}
