import { animationOf, animationProblem, beatsFor, followsLanding, travelMs } from '../../src/core/animation.ts'
import { active, bump, distance, DWELL, ease, GAP, litOpacity, progress, tubeOpacity } from '../../ui/src/motion.ts'

/** Tags as the files can hold them: good ones, and every kind of wrong one. */
const RAW: unknown[] = [
  'send', 'call', 'callback', 'event',
  { kind: 'send', carries: 'order' }, { kind: 'call', carries: 'basket' },
  { kind: 'callback' }, { kind: 'callback', trigger: 'inside' }, { kind: 'callback', trigger: 'outside' }, { kind: 'callback', trigger: 'outside', carries: 'receipt' },
  '', 'sned', 'Send', { kind: '' }, {}, { carries: 'x' }, { kind: 'send', speed: 'fast' }, { kind: 'send', trigger: 'outside' },
  { kind: 'callback', trigger: 'sideways' }, { kind: 'send', carries: ' ' }, { kind: 'send', carries: '' }, ['send'], { kind: ['send'] }, { kind: { x: 'y' } },
  { kind: 'send', outcome: 'fail' }, { kind: 'call', outcome: 'fail' }, { kind: 'call', outcome: 'timeout' }, { kind: 'call', outcome: 'fail', carries: 'declined' },
  { kind: 'send', outcome: 'timeout' }, { kind: 'event', outcome: 'fail' }, { kind: 'callback', outcome: 'timeout' },
  { kind: 'call', outcome: 'maybe' }, { kind: 'call', outcome: '' }, { kind: 'call', outcome: ['fail'] },
]
const LENGTHS = [0, 100, 250, 400, 1000, 5000, 333.3]
const ENDS: [string, string][] = [['a', 'b'], ['b', 'c'], ['a', 'c'], ['a', 'a']]
const TIMEOUT_BEATS = beatsFor({ kind: 'call', trigger: 'inside', outcome: 'timeout' }, { length: 250, afterLanding: false }).beats
const SPAN = { at: 100, dur: 400 }
const TUBE = { at: 0, dur: 1000 }

/** What the TypeScript says about tags: whether each is wrong, how it reads, how long a line takes, and every beat. */
export function dumpBeats(): unknown {
  const read = (animation: unknown) => animationOf({ to: 'x', animation })
  return {
    travel: LENGTHS.map(length => ({ length, ms: travelMs(length) })),
    problems: RAW.flatMap(animation => [true, false].map(to => ({ animation, to, problem: animationProblem(animation, to) ?? null }))),
    reads: RAW.map(animation => ({ animation, read: read(animation) ?? null })),
    beats: RAW.flatMap(animation => {
      const a = read(animation)
      return a ? LENGTHS.flatMap(length => [false, true].map(afterLanding => ({ animation, length, afterLanding, ...beatsFor(a, { length, afterLanding }) }))) : []
    }),
    follows: [null, ...ENDS].flatMap(previous => [null, ...ENDS].map(current => ({ previous, current, follows: followsLanding(previous, current) }))),
    // The browser's drawing maths, which the desktop app ports (Flowy.Core/MotionMath.cs).
    motion: {
      gap: GAP,
      dwell: DWELL,
      ease: [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(p => ({ p, ease: ease(p), bump: bump(p) })),
      progress: [0, 50, 100, 250, 499, 500, 900].map(t => ({ t, progress: progress(SPAN, t), active: active(SPAN, t), tube: tubeOpacity(TUBE, t) })),
      distance: (['fwd', 'back'] as const).flatMap(dir => [0, 0.3, 1].map(p => ({ dir, p, distance: distance(dir, p, 200) }))),
      // How far a timeout has dimmed the lit line, over the beats of a call that nobody answers.
      lit: [0, 1000, 3250, 3550, 3850, 9000].map(t => ({ t, lit: litOpacity(TIMEOUT_BEATS, t) })),
    },
  }
}
