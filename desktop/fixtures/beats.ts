import { animationOf, animationProblem, beatsFor, burstOf, followsLanding, interceptorProblem, outcomeLine, shortLabel, travelMs } from '../../src/core/animation.ts'
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
  // The five outcomes after fail and timeout, and the keys that go with them.
  { kind: 'send', outcome: 'lost' }, { kind: 'call', outcome: 'lost', at: 0.4, reason: 'Packet dropped' }, { kind: 'event', outcome: 'lost', at: '0.9', carries: 'ping' },
  { kind: 'send', outcome: 'rejected', reason: 'Rate limit' }, { kind: 'call', outcome: 'rejected' }, { kind: 'event', outcome: 'rejected', carries: 'ping' },
  { kind: 'send', outcome: 'intercepted', by: 'proxy' }, { kind: 'call', outcome: 'intercepted', by: { name: 'Café wifi proxy' }, reason: 'Reads the call' },
  { kind: 'event', outcome: 'intercepted', by: { name: 'Tap' }, carries: 'ping' },
  { kind: 'send', outcome: 'duplicated', carries: 'order' }, { kind: 'call', outcome: 'duplicated', reason: 'Retried' }, { kind: 'event', outcome: 'duplicated' },
  { kind: 'send', outcome: 'delayed' }, { kind: 'call', outcome: 'delayed', reason: 'Cold start' }, { kind: 'event', outcome: 'delayed' },
  { kind: 'send', outcome: 'fail', reason: 'Card declined' }, { kind: 'call', outcome: 'timeout', reason: 'Slow upstream' },
  { kind: 'send', outcome: 'lost', share: 30 }, { kind: 'call', outcome: 'timeout', share: 50, carries: 'order' }, { kind: 'call', outcome: 'duplicated', share: '100', reason: 'Retried' },
  { kind: 'send', outcome: 'fail', share: 20 }, { kind: 'event', outcome: 'delayed', share: 10 }, { kind: 'call', outcome: 'rejected', share: 5, reason: 'Rate limit' },
  { kind: 'send', outcome: 'intercepted', by: 'proxy', share: 40 }, { kind: 'send', outcome: 'lost', carries: 'a-very-long-word-for-a-small-dot' },
  // Wrong ones: the outcomes on a callback, and every key that is out of range, blank, in the wrong place or missing.
  { kind: 'callback', outcome: 'lost' }, { kind: 'callback', outcome: 'intercepted', by: 'proxy' }, { kind: 'callback', outcome: 'delayed' },
  { kind: 'send', outcome: 'lost', share: 0 }, { kind: 'send', outcome: 'lost', share: 101 }, { kind: 'send', outcome: 'lost', share: 30.5 }, { kind: 'send', outcome: 'lost', share: 'a third' },
  { kind: 'send', outcome: 'lost', share: '' }, { kind: 'send', outcome: 'lost', share: ['30'] }, { kind: 'send', share: 30 },
  { kind: 'send', outcome: 'rejected', reason: 'x'.repeat(40) }, { kind: 'send', outcome: 'rejected', reason: 'x'.repeat(41) }, { kind: 'send', outcome: 'rejected', reason: ' ' },
  { kind: 'send', outcome: 'rejected', reason: 'two\nlines' }, { kind: 'send', outcome: 'rejected', reason: 'one' + String.fromCharCode(0x2028) + 'line' },
  { kind: 'send', outcome: 'rejected', reason: ['Rate limit'] }, { kind: 'send', reason: 'Why' },
  { kind: 'send', outcome: 'intercepted' }, { kind: 'send', outcome: 'intercepted', by: '' }, { kind: 'send', outcome: 'intercepted', by: ['proxy'] },
  { kind: 'send', outcome: 'intercepted', by: { name: '' } }, { kind: 'send', outcome: 'intercepted', by: { name: 'x'.repeat(24) } }, { kind: 'send', outcome: 'intercepted', by: { name: 'x'.repeat(25) } },
  { kind: 'send', outcome: 'intercepted', by: { name: 'Tap', color: 'red' } }, { kind: 'send', outcome: 'intercepted', by: {} }, { kind: 'send', outcome: 'lost', by: 'proxy' }, { kind: 'send', by: 'proxy' },
  { kind: 'send', outcome: 'lost', at: 0.1 }, { kind: 'send', outcome: 'lost', at: 0.05 }, { kind: 'send', outcome: 'lost', at: 0.95 }, { kind: 'send', outcome: 'lost', at: 'half' },
  { kind: 'send', outcome: 'lost', at: '.5' }, { kind: 'send', outcome: 'lost', at: '' }, { kind: 'send', outcome: 'delayed', at: 0.5 }, { kind: 'send', at: 0.5 },
]
/** A tag that gives a share plays a burst of 10, 20 or 100 requests, so those are dumped at two lengths only, under "bursting", and not at every length like the rest. */
const hasShare = (animation: unknown): boolean => typeof animation === 'object' && animation !== null && 'share' in animation
const BURSTS: unknown[] = [
  { kind: 'send', outcome: 'lost', share: 1 }, { kind: 'call', outcome: 'rejected', share: 5, carries: 'ping' }, { kind: 'send', outcome: 'duplicated', share: 30 },
  { kind: 'call', outcome: 'timeout', share: 33 }, { kind: 'event', outcome: 'intercepted', by: { name: 'Tap' }, share: 70 }, { kind: 'call', outcome: 'delayed', share: 100, reason: 'Queue' },
]
const SHARES = [1, 2, 5, 10, 15, 30, 33, 50, 70, 99, 100]
/** Which shapes exist, for the checks that need the model. */
const SHAPES = ['web', 'api', 'proxy']
const STEP = { from: 'web', to: 'api' }
const SHAPE_NAMES: Record<string, string> = { proxy: 'Edge proxy' }
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
    interceptors: RAW.filter(animation => typeof animation === 'object' && animation !== null && 'by' in animation).map(animation => ({
      animation,
      problem: interceptorProblem(animation, STEP, id => SHAPES.includes(id)) ?? null,
    })),
    // A shape that is on the step, one that is not in the model, and one that is another step's.
    interceptorShapes: ['proxy', ' proxy ', 'web', 'api', 'ghost'].map(by => ({ by, problem: interceptorProblem({ kind: 'send', outcome: 'intercepted', by }, STEP, id => SHAPES.includes(id)) ?? null })),
    lines: RAW.flatMap(animation => {
      const a = read(animation)
      return a?.outcome === undefined ? [] : [{ animation, line: outcomeLine(a) ?? null, named: outcomeLine(a, id => SHAPE_NAMES[id] ?? id) ?? null }]
    }),
    bursts: SHARES.map(share => ({ share, ...burstOf(share) })),
    labels: ['order', 'a'.repeat(16), 'a'.repeat(17), 'a-very-long-word-for-a-small-dot', ''].map(label => ({ label, short: shortLabel(label) })),
    bursting: [...BURSTS, ...RAW.filter(hasShare)].flatMap(animation => {
      const a = read(animation)
      return a ? [250, 1000].map(length => ({ animation, length, afterLanding: false, ...beatsFor(a, { length, afterLanding: false }) })) : []
    }),
    beats: RAW.filter(animation => !hasShare(animation)).flatMap(animation => {
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
