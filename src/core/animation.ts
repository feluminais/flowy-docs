/**
 * How a flow step plays. A step may carry `animation:`, a kind (`call`) or a mapping with one
 * (`{ kind: callback, trigger: outside }`). This file says what a tag may hold and turns it into beats:
 * a timed list of the few things a renderer can draw. Nothing here draws, and nothing needs a browser.
 * desktop/Flowy.Core/Animation.cs is a port, and desktop/fixtures/beats.ts keeps the two equal.
 */

export const ANIMATION_KINDS = ['send', 'call', 'callback', 'event'] as const
export type AnimationKind = (typeof ANIMATION_KINDS)[number]
export const TRIGGERS = ['inside', 'outside'] as const
export type Trigger = (typeof TRIGGERS)[number]
/** How the exchange a step draws ends: refused (`fail`) or never answered (`timeout`). Without one the exchange simply works. */
export const OUTCOMES = ['fail', 'timeout'] as const
export type Outcome = (typeof OUTCOMES)[number]
const OPTIONS = ['kind', 'trigger', 'carries', 'outcome'] as const

/** After the request lands, how long the sender's waiting dots run when nobody answers, and then how long the line takes to fade. */
const TIMEOUT_WAIT = 1800
const TIMEOUT_FADE = 600

/** A step's animation, read: the kind, who sets a callback off (inside unless the file says outside), the word the blob carries, and how it ends. */
export type Animation = { kind: AnimationKind; trigger: Trigger; carries?: string; outcome?: Outcome }

export type Glyph = 'envelope' | 'bolt' | 'bell'

/**
 * One thing to draw. `do` says what: the tube along the line (`pipe`), something running through it (`blob`),
 * a ring going out from a box, a flash on it, a squash as it takes something in (`gulp`), waiting dots over it,
 * a glyph falling onto it (`drop`), or the step's lit line dimming and staying dim (`fade`). `on` says where.
 * Times are milliseconds from the start of the step.
 */
export type Beat = {
  do: 'pipe' | 'blob' | 'ring' | 'flash' | 'gulp' | 'wait' | 'drop' | 'fade'
  on: 'from' | 'to' | 'line'
  at: number
  dur: number
  /** blob only: `fwd` runs from the step's `from` to its `to`, `back` the other way. */
  dir?: 'fwd' | 'back'
  glyph?: Glyph
  /** blob: a reply is drawn in the answer's colour. blob and flash: `fail` is drawn in the danger colour. */
  tone?: 'reply' | 'fail'
  /** blob only: the `carries` word, shown instead of the glyph. */
  label?: string
}

const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isKind = (v: string): v is AnimationKind => ANIMATION_KINDS.some(k => k === v)
const KINDS_HINT = `use ${ANIMATION_KINDS.join(', ')}`

/**
 * What is wrong with a step's `animation`, worded to follow "step N: ", or undefined. A blank tag is no tag.
 * `hasTo` is whether the step has a "to": every kind so far travels between two boxes.
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
    if (extra !== undefined) return `unknown animation option "${extra}" (use ${OPTIONS.join(', ')})`
    const { trigger, carries, outcome } = raw
    if (trigger !== undefined && !TRIGGERS.some(t => t === trigger)) return `animation trigger must be ${TRIGGERS.join(' or ')}`
    if (trigger !== undefined && kind !== 'callback') return 'animation trigger only applies to callback'
    if (carries !== undefined && (typeof carries !== 'string' || carries.trim() === '')) return 'animation carries must be a word'
    if (outcome !== undefined && !OUTCOMES.some(o => o === outcome)) return `animation outcome must be ${OUTCOMES.join(' or ')}`
    if (outcome === 'timeout' && kind !== 'call') return 'animation outcome timeout only applies to call'
    if (outcome === 'fail' && kind !== 'send' && kind !== 'call') return 'animation outcome fail only applies to send and call'
  }
  if (!hasTo) return `animation "${kind}" needs a "to"`
  return undefined
}

/** The step's animation, or undefined when it has none or the tag is wrong (check() reports that) or nothing would travel. */
export function animationOf(step: { to?: string; animation?: unknown }): Animation | undefined {
  const raw = step.animation
  if (raw === undefined || raw === '' || animationProblem(raw, step.to !== undefined) !== undefined) return undefined
  const map = isMap(raw) ? raw : { kind: raw }
  return {
    kind: map.kind as AnimationKind,
    trigger: map.trigger === 'outside' ? 'outside' : 'inside',
    ...(typeof map.carries === 'string' ? { carries: map.carries } : {}),
    ...(map.outcome === 'fail' || map.outcome === 'timeout' ? { outcome: map.outcome } : {}),
  }
}

/** How long something takes to run the length of a line (in the same units the renderer measures it): at least 1.2 seconds, so the eye can follow it, and at most 2.2. */
export const travelMs = (length: number): number => (Number.isFinite(length) ? Math.min(2200, Math.max(1200, Math.floor(length * 3 + 0.5))) : 1200)

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
  const failed = a.outcome === 'fail'
  // A refusal is the news, so everything that runs is the danger tone and the receiver flashes in it when it lands.
  const blob = (at: number, glyph: Glyph): Beat => ({
    do: 'blob', on: 'line', at, dur: T, dir: 'fwd', glyph,
    ...(failed ? { tone: 'fail' as const } : {}),
    ...(a.carries === undefined ? {} : { label: a.carries }),
  })
  const refused = (at: number): Beat[] => (failed ? [{ do: 'flash', on: 'to', at, dur: 450, tone: 'fail' }] : [])
  const body = ((): Beat[] => {
    switch (a.kind) {
      case 'send':
        return [effect('gulp', 'from', 0, 250), blob(250, 'envelope'), effect('gulp', 'to', 250 + T, 300), ...refused(250 + T)]
      case 'call': {
        const landed = 250 + T
        if (a.outcome === 'timeout') {
          // Nobody answers: the sender keeps waiting, nothing comes back, and the line dims.
          return [
            effect('gulp', 'from', 0, 250), blob(250, 'envelope'), effect('gulp', 'to', landed, 300), effect('wait', 'from', landed, TIMEOUT_WAIT),
            { do: 'fade', on: 'line', at: landed + TIMEOUT_WAIT, dur: TIMEOUT_FADE },
          ]
        }
        const back = landed + 600
        return [
          effect('gulp', 'from', 0, 250), blob(250, 'envelope'), effect('gulp', 'to', landed, 300), ...refused(landed), effect('wait', 'from', landed, 600),
          { do: 'blob', on: 'line', at: back, dur: T, dir: 'back', glyph: 'envelope', tone: failed ? 'fail' : 'reply' },
          effect('gulp', 'from', back + T, 300),
        ]
      }
      case 'event':
        return [effect('gulp', 'from', 0, 250), blob(250, 'bolt'), effect('flash', 'to', 250 + T, 450)]
      case 'callback':
        if (a.trigger === 'inside') return [effect('ring', 'from', 0, 600), blob(450, 'bell'), effect('ring', 'to', 450 + T, 600)]
        if (afterLanding) return [effect('flash', 'from', 0, 450), blob(300, 'bell'), effect('ring', 'to', 300 + T, 600)]
        return [{ do: 'drop', on: 'from', at: 0, dur: 600, glyph: 'bolt' }, effect('flash', 'from', 600, 450), blob(850, 'bell'), effect('ring', 'to', 850 + T, 600)]
    }
  })()
  const total = Math.max(...body.map(b => b.at + b.dur))
  return { beats: [{ do: 'pipe', on: 'line', at: 0, dur: total }, ...body], total }
}
