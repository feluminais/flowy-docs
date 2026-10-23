import { ANIMATION_KINDS, animationOf, channelLine, CHANNEL_SKETCHES, END_SKETCHES, animationProblem, animationWith, beatsFor, burstOf, EFFECTS, followsLanding, interceptorProblem, KIND_SKETCHES, leavesMarks, OUTCOME_SKETCHES, OUTCOMES, outcomeBlock, outcomeLine, shortLabel, TINTS, travelMs } from '../../src/core/animation.ts'
import type { AnimationKey } from '../../src/core/animation.ts'
import { colorPair } from '../../src/core/look.ts'
import { active, bump, distance, DWELL, ease, entryPoint, GAP, labelOffset, litOpacity, lowerSide, markerSize, markerSpot, noteSpot, effectPose, progress, tubeOpacity } from '../../ui/src/motion.ts'

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
  // Exotic white space: JavaScript's trim() and .NET's differ on U+FEFF and U+0085, so the checks must agree on both.
  { kind: 'send', outcome: 'rejected', reason: String.fromCharCode(0xfeff) }, { kind: 'send', outcome: 'rejected', reason: 'x'.repeat(40) + String.fromCharCode(0xfeff) },
  { kind: 'send', outcome: 'lost', carries: String.fromCharCode(0x85) }, { kind: 'send', outcome: 'lost', carries: String.fromCharCode(0xfeff) },
  { kind: 'send', outcome: 'intercepted' }, { kind: 'send', outcome: 'intercepted', by: '' }, { kind: 'send', outcome: 'intercepted', by: ['proxy'] },
  { kind: 'send', outcome: 'intercepted', by: { name: '' } }, { kind: 'send', outcome: 'intercepted', by: { name: 'x'.repeat(24) } }, { kind: 'send', outcome: 'intercepted', by: { name: 'x'.repeat(25) } },
  { kind: 'send', outcome: 'intercepted', by: { name: 'Tap', color: 'red' } }, { kind: 'send', outcome: 'intercepted', by: {} }, { kind: 'send', outcome: 'lost', by: 'proxy' }, { kind: 'send', by: 'proxy' },
  { kind: 'send', outcome: 'lost', at: 0.1 }, { kind: 'send', outcome: 'lost', at: 0.05 }, { kind: 'send', outcome: 'lost', at: 0.95 }, { kind: 'send', outcome: 'lost', at: 'half' },
  { kind: 'send', outcome: 'lost', at: '.5' }, { kind: 'send', outcome: 'lost', at: '' }, { kind: 'send', outcome: 'delayed', at: 0.5 }, { kind: 'send', at: 0.5 },
  // What a blob does on its way: the four effects on each way of travelling, with what else a step can hold, and the wrong ones.
  { kind: 'send', effect: 'squish' }, { kind: 'call', effect: 'bounce', carries: 'order' }, { kind: 'event', effect: 'pulse' }, { kind: 'callback', effect: 'wiggle', trigger: 'outside' },
  { kind: 'call', effect: 'bounce', outcome: 'timeout' }, { kind: 'send', effect: 'pulse', outcome: 'lost', share: 30 },
  { kind: 'send', effect: 'spin' }, { kind: 'send', effect: '' }, { kind: 'send', effect: ['bounce'] }, { kind: 'send', effect: 'Bounce' }, { kind: 'send', effect: 'bounce', speed: 'fast' },
  // What a step leaves open or closes: each kind, a name, an end, a close, an effect beside them, and every wrong way to write them.
  { kind: 'call', opens: 'stream' }, { kind: 'call', opens: 'listener', name: 'Hook' }, { kind: 'send', opens: 'job', name: ' Charge ', towards: 'from' }, { kind: 'event', opens: 'stream', towards: 'to', carries: 'rows' },
  { kind: 'callback', trigger: 'outside', opens: 'listener' }, { kind: 'call', opens: 'stream', name: 'x'.repeat(24) }, { kind: 'call', opens: 'job', effect: 'bounce' },
  { kind: 'send', closes: 'Orders' }, { kind: 'call', closes: ' Orders ' }, { kind: 'event', closes: 'x'.repeat(24), carries: 'bye' }, { kind: 'callback', closes: 'Hook' },
  { kind: 'call', opens: 'pipe' }, { kind: 'call', opens: '' }, { kind: 'call', opens: ['stream'] }, { kind: 'call', opens: 'Stream' }, { kind: 'call', opens: 'stream', towards: 'up' }, { kind: 'call', opens: 'stream', towards: '' },
  { kind: 'call', opens: 'stream', towards: ['from'] }, { kind: 'call', name: 'Orders' }, { kind: 'call', towards: 'to' }, { kind: 'call', name: 'Orders', towards: 'from' },
  { kind: 'call', opens: 'stream', closes: 'x' }, { kind: 'call', opens: 'stream', name: 'x'.repeat(25) }, { kind: 'call', closes: 'x'.repeat(25) },
  { kind: 'call', opens: 'stream', name: '' }, { kind: 'call', opens: 'stream', name: ' ' }, { kind: 'call', opens: 'stream', name: ['Orders'] }, { kind: 'call', opens: 'stream', name: 'two\nlines' },
  { kind: 'call', closes: '' }, { kind: 'call', closes: ' ' }, { kind: 'call', closes: ['Orders'] }, { kind: 'call', closes: 'one' + String.fromCharCode(0x2028) + 'line' },
  { kind: 'call', opens: 'stream', name: String.fromCharCode(0xfeff) }, { kind: 'call', closes: 'x'.repeat(24) + String.fromCharCode(0xfeff) },
  { kind: 'call', opens: 'stream', outcome: 'fail' }, { kind: 'call', opens: 'job', outcome: 'timeout' }, { kind: 'send', opens: 'listener', outcome: 'lost', share: 30 },
  { kind: 'call', closes: 'x', outcome: 'rejected' }, { kind: 'send', closes: 'x', outcome: 'intercepted', by: 'proxy' }, { kind: 'call', opens: 'stream', closes: 'x', outcome: 'delayed' },
  { kind: 'call', opens: 'stream', outcome: 'maybe' }, { kind: 'call', opens: 'stream', speed: 'fast' },
]
/** A tag that gives a share plays a burst of 10, 20 or 100 requests, so those are dumped at two lengths only, under "bursting", and not at every length like the rest. */
const hasShare = (animation: unknown): boolean => typeof animation === 'object' && animation !== null && 'share' in animation
const BURSTS: unknown[] = [
  { kind: 'send', outcome: 'lost', share: 1 }, { kind: 'call', outcome: 'rejected', share: 5, carries: 'ping' }, { kind: 'send', outcome: 'duplicated', share: 30 },
  { kind: 'call', outcome: 'timeout', share: 33 }, { kind: 'event', outcome: 'intercepted', by: { name: 'Tap' }, share: 70 }, { kind: 'call', outcome: 'delayed', share: 100, reason: 'Queue' },
]
const SHARES = [1, 2, 5, 10, 15, 30, 33, 50, 70, 99, 100]
/** What the pickers of edit mode do, each chain a run of picks from nothing, the result after each one. */
const PICKS: [AnimationKey, string][][] = [
  [['kind', 'call'], ['outcome', 'rejected'], ['reason', ' Rate limit '], ['share', '30'], ['reason', '  '], ['outcome', ''], ['kind', '']],
  [['kind', 'send'], ['outcome', 'lost'], ['at', '0.4'], ['share', '20'], ['reason', 'Packet dropped'], ['outcome', 'rejected'], ['kind', 'event'], ['kind', 'callback']],
  [['kind', 'call'], ['outcome', 'intercepted'], ['by', 'cache'], ['byName', 'Café wifi proxy'], ['by', 'cache'], ['byName', ''], ['by', ''], ['outcome', 'lost'], ['outcome', 'intercepted'], ['kind', 'send']],
  [['kind', 'call'], ['outcome', 'timeout'], ['share', '10'], ['kind', 'send'], ['kind', 'call'], ['carries', 'order'], ['carries', ''], ['outcome', 'delayed'], ['outcome', 'duplicated']],
  [['outcome', 'lost'], ['kind', 'event'], ['outcome', 'fail'], ['kind', 'send'], ['outcome', 'fail'], ['share', '100']],
  // Channels: open, name, point, close, and what each pick drops.
  [['kind', 'call'], ['opens', 'stream'], ['name', ' Orders '], ['towards', 'from'], ['towards', ''], ['opens', 'job'], ['closes', 'Orders'], ['opens', 'listener'], ['opens', ''], ['kind', '']],
  [['kind', 'send'], ['outcome', 'lost'], ['share', '20'], ['opens', 'stream'], ['name', 'Rows'], ['outcome', 'fail'], ['closes', 'Rows'], ['name', 'Again'], ['outcome', 'rejected']],
  [['kind', 'call'], ['closes', 'Orders'], ['closes', ''], ['name', 'Alone'], ['towards', 'to'], ['opens', 'pipe'], ['opens', ''], ['kind', 'event']],
  [['kind', 'call'], ['outcome', 'intercepted'], ['byName', 'Tap'], ['opens', 'job'], ['outcome', 'duplicated'], ['closes', 'Job'], ['outcome', 'delayed'], ['reason', 'Slow']],
]
/** Which shapes exist, for the checks that need the model. */
const SHAPES = ['web', 'api', 'proxy']
const STEP = { from: 'web', to: 'api' }
const SHAPE_NAMES: Record<string, string> = { proxy: 'Edge proxy' }
const LENGTHS = [0, 100, 250, 400, 1000, 5000, 333.3]
const ENDS: [string, string][] = [['a', 'b'], ['b', 'c'], ['a', 'c'], ['a', 'a']]
const TIMEOUT_BEATS = beatsFor({ kind: 'call', trigger: 'inside', outcome: 'timeout' }, { length: 250, afterLanding: false }).beats
/** The stretches of a line a blob runs between, and the directions a line can run, for the maths the outcomes added. */
const SPANS: { start?: number; end?: number }[] = [{}, { end: 0.4 }, { start: 0.4 }, { start: 0.4, end: 0.4 }, { end: 0.92 }]
const DIRECTIONS: [number, number][] = [[300, 0], [-300, 0], [0, 300], [0, -300], [0, 0], [100, 100], [100, -100], [-50, 200], [300, 20]]
const BOX = { x: 100, y: 100, width: 200, height: 72 }
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
    // How a step that opens or closes a channel reads on its card.
    channelLines: RAW.flatMap(animation => {
      const a = read(animation)
      return a === undefined ? [] : [{ animation, line: channelLine(a) ?? null }]
    }),
    bursts: SHARES.map(share => ({ share, ...burstOf(share) })),
    blocks: [undefined, '', ...ANIMATION_KINDS].flatMap(kind => ['', ...OUTCOMES].map(outcome => ({ kind: kind ?? null, outcome, block: outcomeBlock(kind, outcome) ?? null }))),
    sketches: { kinds: Object.entries(KIND_SKETCHES), outcomes: Object.entries(OUTCOME_SKETCHES), channels: Object.entries(CHANNEL_SKETCHES), ends: Object.entries(END_SKETCHES) },
    picks: PICKS.map(chain => {
      let current: unknown
      return chain.map(([key, value]) => ({ key, value, result: (current = animationWith(current, key, value)) ?? null }))
    }),
    // A step that already has an animation of its own, mapping or bare kind.
    picksFrom: [
      { kind: 'callback', trigger: 'outside', carries: 'x' }, { kind: 'send', outcome: 'lost', carries: 'order', note: 'kept' }, 'call', { kind: 'call', outcome: 'intercepted', by: { name: 'Proxy' }, reason: 'x' },
      { kind: 'call', opens: 'stream', name: 'Orders', towards: 'from', carries: 'rows' }, { kind: 'send', closes: 'Orders', note: 'kept' },
    ].flatMap(from => (
      [['kind', 'send'], ['kind', 'callback'], ['outcome', 'delayed'], ['outcome', ''], ['reason', 'Why'], ['by', 'cache'], ['byName', 'Tap'], ['share', '40'], ['opens', 'stream'], ['opens', ''], ['name', 'Orders'], ['towards', 'from'], ['closes', 'Orders']] as [AnimationKey, string][]
    ).map(([key, value]) => ({ from, key, value, result: animationWith(from, key, value) ?? null }))),
    marks: RAW.flatMap(animation => {
      const a = read(animation)
      return a ? [{ animation, marks: leavesMarks(a) }] : []
    }),
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
      // A blob that runs between two fractions of the line, and waits where start is end.
      spans: SPANS.flatMap(span => (['fwd', 'back'] as const).flatMap(dir => [0, 0.3, 0.5, 1].map(p => ({ span, dir, p, distance: distance(dir, p, 200, span) })))),
      // The colour of each slot of the tints, which wrap round.
      tints: [0, 1, 2, 3, 4, 7, -1].map(slot => ({ slot, pair: colorPair(TINTS[((slot % TINTS.length) + TINTS.length) % TINTS.length])! })),
      // Where a label, a note and a marker sit beside a line that runs in each direction.
      sides: DIRECTIONS.map(([dx, dy]) => ({
        dx, dy, label: labelOffset(dx, dy, 6), lower: lowerSide(dx, dy), note: noteSpot(dx, dy, 10),
        marker: markerSpot(dx, dy, markerSize('Café wifi proxy')),
      })),
      // What each effect does to a blob at each moment of its run, on lines at each angle: a dot or a label, which the squish treats differently.
      effects: [undefined, ...EFFECTS, 'spin'].flatMap(effect => [true, false].flatMap(label => [0, 20, 90, 200, -70].flatMap(angle => [0, 0.1, 0.25, 0.5, 0.8, 1].map(p => ({ effect: effect ?? null, label, angle, p, pose: effectPose(effect as Parameters<typeof effectPose>[0], label, angle, p) }))))),
      markers: ['', 'Tap', 'Café wifi proxy', 'x'.repeat(24)].map(name => ({ name, size: markerSize(name) })),
      // Where a blob that is taken in by a box stops.
      entries: [[200, 0], [0, 136], [200, 400], [400, 136], [150, 120], [0, 0], [400, 400], [200, 136]].map(([x, y]) => ({ from: { x, y }, box: BOX, point: entryPoint({ x, y }, BOX) })),
    },
  }
}
