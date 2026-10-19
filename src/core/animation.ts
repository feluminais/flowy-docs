/**
 * How a flow step plays. A step may carry `animation:`, a kind (`call`) or a mapping with one
 * (`{ kind: callback, trigger: outside }`). This file says what a tag may hold and turns it into beats:
 * a timed list of the few things a renderer can draw. Nothing here draws, and nothing needs a browser.
 * desktop/Flowy.Core/Animation.cs is a port, and desktop/fixtures/beats.ts keeps the two equal.
 */

export const ANIMATION_KINDS = ['send', 'call', 'callback', 'event', 'recurse'] as const
export type AnimationKind = (typeof ANIMATION_KINDS)[number]
export const TRIGGERS = ['inside', 'outside'] as const
export type Trigger = (typeof TRIGGERS)[number]
/** Every option a mapping may hold. Which of them a kind takes is `optionsFor`. */
const OPTIONS = ['kind', 'trigger', 'carries', 'depth', 'returns'] as const
/** Whether a kind runs between two boxes (it needs a "to") or is one box acting on itself (it takes none). */
const ENDS: Record<AnimationKind, 'to' | 'alone'> = { send: 'to', call: 'to', callback: 'to', event: 'to', recurse: 'alone' }
/** A recursion's depth is the height of its call stack at its deepest, the first call included. */
const DEPTH_MIN = 2
const DEPTH_MAX = 5
const DEPTH_DEFAULT = 3

/** A step's animation, read: the kind, who sets a callback off (inside unless the file says outside), the word the blob carries, and for recurse its depth and the word that comes back. */
export type Animation = { kind: AnimationKind; trigger: Trigger; carries?: string; depth?: number; returns?: string }

export type Glyph = 'envelope' | 'bolt' | 'bell'

/**
 * One thing to draw. `do` says what: the tube along the line (`pipe`), something running through it (`blob`),
 * a ring going out from a box, a flash on it, a squash as it takes something in (`gulp`), waiting dots over it,
 * or a glyph falling onto it (`drop`). `on` says where. Times are milliseconds from the start of the step.
 */
export type Beat = {
  do: 'pipe' | 'blob' | 'ring' | 'flash' | 'gulp' | 'wait' | 'drop'
  on: 'from' | 'to' | 'line'
  at: number
  dur: number
  /** blob only: `fwd` runs from the step's `from` to its `to`, `back` the other way. */
  dir?: 'fwd' | 'back'
  glyph?: Glyph
  /** blob only: a reply is drawn in the answer's colour. */
  tone?: 'reply'
  /** blob only: the `carries` word, shown instead of the glyph. */
  label?: string
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKind = (v: string): v is AnimationKind => ANIMATION_KINDS.some(k => k === v)
const KINDS_HINT = `use ${ANIMATION_KINDS.join(', ')}`
const optionsFor = (kind: AnimationKind): string[] => (kind === 'recurse' ? ['kind', 'carries', 'depth', 'returns'] : ['kind', 'trigger', 'carries'])

/** What check() says about a recurse step that has a "to". A step whose "to" is its own "from" already gets a message for that, so check() leaves this one out. */
export const RECURSE_HAS_TO = 'animation "recurse" is a shape calling itself: leave out "to"'

/** A `depth` as a number when it is one: a whole number from 2 to 5, or the text of one. Files hold text and MCP may give a number. */
function depthOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^[0-9]+$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n >= DEPTH_MIN && n <= DEPTH_MAX ? n : undefined
}

/**
 * What is wrong with a step's `animation`, worded to follow "step N: ", or undefined. A blank tag is no tag.
 * `hasTo` is whether the step has a "to": most kinds travel between two boxes and need one, recurse is one box and takes none.
 */
export function animationProblem(raw: unknown, hasTo: boolean): string | undefined {
  if (raw === undefined || raw === '') return undefined
  if (typeof raw !== 'string' && !isMap(raw)) return 'animation must be a kind or a mapping with a kind'
  const kind = isMap(raw) ? raw.kind : raw
  if (kind === undefined || kind === '') return `animation needs a kind (${KINDS_HINT})`
  if (typeof kind !== 'string') return 'animation kind must be text'
  if (!isKind(kind)) return `unknown animation "${kind}" (${KINDS_HINT})`
  if (isMap(raw)) {
    const extra = Object.keys(raw).find(k => !OPTIONS.some(o => o === k))
    if (extra !== undefined) return `unknown animation option "${extra}" (use ${optionsFor(kind).join(', ')})`
    const { trigger, carries, depth, returns } = raw
    if (trigger !== undefined && !TRIGGERS.some(t => t === trigger)) return `animation trigger must be ${TRIGGERS.join(' or ')}`
    if (trigger !== undefined && kind !== 'callback') return 'animation trigger only applies to callback'
    if (carries !== undefined && (typeof carries !== 'string' || carries.trim() === '')) return 'animation carries must be a word'
    if (depth !== undefined && kind !== 'recurse') return 'animation depth only applies to recurse'
    if (returns !== undefined && kind !== 'recurse') return 'animation returns only applies to recurse'
    if (depth !== undefined && depthOf(depth) === undefined) return `animation depth must be a whole number from ${DEPTH_MIN} to ${DEPTH_MAX}`
    if (returns !== undefined && (typeof returns !== 'string' || returns.trim() === '')) return 'animation returns must be a word'
  }
  if (ENDS[kind] === 'alone') return hasTo ? RECURSE_HAS_TO : undefined
  if (!hasTo) return `animation "${kind}" needs a "to"`
  return undefined
}

/** The step's animation, or undefined when it has none or the tag is wrong (check() reports that) or nothing would travel. */
export function animationOf(step: { to?: string; animation?: unknown }): Animation | undefined {
  const raw = step.animation
  if (raw === undefined || raw === '' || animationProblem(raw, step.to !== undefined) !== undefined) return undefined
  const map = isMap(raw) ? raw : { kind: raw }
  const kind = map.kind as AnimationKind
  return {
    kind,
    trigger: map.trigger === 'outside' ? 'outside' : 'inside',
    ...(typeof map.carries === 'string' ? { carries: map.carries } : {}),
    ...(kind === 'recurse' ? { depth: depthOf(map.depth) ?? DEPTH_DEFAULT } : {}),
    ...(kind === 'recurse' && typeof map.returns === 'string' ? { returns: map.returns } : {}),
  }
}

/** How long something takes to run the length of a line (in the same units the renderer measures it): half a second to a bit over one. */
export const travelMs = (length: number): number => (Number.isFinite(length) ? Math.min(1100, Math.max(500, Math.floor(length * 2 + 0.5))) : 500)

/** Whether the step before ended at the box this one starts from, so a callback "triggered outside" was just kicked by it. */
export const followsLanding = (previous: readonly [string, string] | null | undefined, current: readonly [string, string] | null | undefined): boolean =>
  previous != null && current != null && previous[1] === current[0]

const effect = (d: 'ring' | 'flash' | 'gulp' | 'wait', on: 'from' | 'to', at: number, dur: number): Beat => ({ do: d, on, at, dur })

/**
 * The step as beats, in the order they start, with the tube first and how long the whole thing lasts.
 * `length` is how long the line is on screen; `afterLanding` is followsLanding for this step.
 */
export function beatsFor(a: Animation, { length, afterLanding }: { length: number; afterLanding: boolean }): { beats: Beat[]; total: number } {
  const T = travelMs(length)
  const blob = (at: number, glyph: Glyph): Beat => ({ do: 'blob', on: 'line', at, dur: T, dir: 'fwd', glyph, ...(a.carries === undefined ? {} : { label: a.carries }) })
  const body = ((): Beat[] => {
    switch (a.kind) {
      case 'send':
        return [effect('gulp', 'from', 0, 150), blob(150, 'envelope'), effect('gulp', 'to', 150 + T, 200)]
      case 'call': {
        const landed = 150 + T
        const back = landed + 300
        return [
          effect('gulp', 'from', 0, 150), blob(150, 'envelope'), effect('gulp', 'to', landed, 200), effect('wait', 'from', landed, 300),
          { do: 'blob', on: 'line', at: back, dur: T, dir: 'back', glyph: 'envelope', tone: 'reply' },
          effect('gulp', 'from', back + T, 200),
        ]
      }
      case 'event':
        return [effect('gulp', 'from', 0, 150), blob(150, 'bolt'), effect('flash', 'to', 150 + T, 250)]
      case 'callback':
        if (a.trigger === 'inside') return [effect('ring', 'from', 0, 400), blob(300, 'bell'), effect('ring', 'to', 300 + T, 400)]
        if (afterLanding) return [effect('flash', 'from', 0, 250), blob(200, 'bell'), effect('ring', 'to', 200 + T, 400)]
        return [{ do: 'drop', on: 'from', at: 0, dur: 350, glyph: 'bolt' }, effect('flash', 'from', 350, 250), blob(550, 'bell'), effect('ring', 'to', 550 + T, 400)]
      case 'recurse':
        throw new Error('recurse has no beats yet')
    }
  })()
  const total = Math.max(...body.map(b => b.at + b.dur))
  return { beats: [{ do: 'pipe', on: 'line', at: 0, dur: total }, ...body], total }
}
