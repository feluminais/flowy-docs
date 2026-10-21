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
/**
 * How the exchange a step draws ends: refused (`fail`), never answered (`timeout`), gone halfway (`lost`), turned away at the door
 * (`rejected`), taken by a third party (`intercepted`), handled twice (`duplicated`) or held up on the way (`delayed`).
 * Without one the exchange simply works.
 */
export const OUTCOMES = ['fail', 'timeout', 'lost', 'rejected', 'intercepted', 'duplicated', 'delayed'] as const
export type Outcome = (typeof OUTCOMES)[number]
const OPTIONS = ['kind', 'trigger', 'carries', 'outcome', 'share', 'reason', 'by', 'at'] as const
/** The outcomes that came after fail and timeout. They are valid on a send, a call and an event, never on a callback. */
const TRAVEL_OUTCOMES = ['lost', 'rejected', 'intercepted', 'duplicated', 'delayed'] as const
const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some(o => o === v)

/** The longest a reason and an interceptor's name may be, in characters. */
export const REASON_MAX = 40
export const NAME_MAX = 24
/** Where a lost request vanishes along its line, as a fraction of the way, when the step does not say. */
export const LOST_AT = 0.55

/** After the request lands, how long the sender's waiting dots run when nobody answers, and then how long the line takes to fade. */
const TIMEOUT_WAIT = 1800
const TIMEOUT_FADE = 600

/** Who takes an intercepted request: a shape of the model, or a party that is not in it, by name. */
export type Interceptor = { shape: string } | { name: string }

/**
 * A step's animation, read: the kind, who sets a callback off (inside unless the file says outside), the word the blob carries, and how it ends.
 * `share` is the whole percent of the requests that meet the outcome (a burst plays when it is there), `reason` says why in a few words,
 * `by` is who takes an intercepted request and `at` how far along its line a lost one vanishes (a fraction).
 */
export type Animation = {
  kind: AnimationKind
  trigger: Trigger
  carries?: string
  outcome?: Outcome
  share?: number
  reason?: string
  by?: Interceptor
  at?: number
}

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
/** "a, b or c". */
const orList = (words: readonly string[]): string => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} or ${words.at(-1)}`)
/** A line of plain text for a label: not blank, with no line break and no control character in it. */
const plainLine = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '' && !/\p{Cc}|\p{Zl}|\p{Zp}/u.test(v)

/**
 * The share of requests, 1 to 100 whole percent, or undefined. A number or the text of one: a file holds every value as text,
 * and put_flow gives numbers.
 */
export function shareOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d{1,3}$/.test(v) ? Number(v) : Number.NaN
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : undefined
}

/** How far along its line a lost request vanishes, 0.1 to 0.9, from a number or the text of one; undefined when it is anything else. */
export function lostAtOf(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d*\.?\d+$/.test(v) ? Number(v) : Number.NaN
  return n >= 0.1 && n <= 0.9 ? n : undefined
}

const BY_HINT = 'animation by must be a shape id or { name: ... }'
/** What is wrong with the shape of `by`, or undefined. Whether a shape id exists is interceptorProblem's to say. */
function byProblem(by: unknown): string | undefined {
  if (typeof by === 'string') return plainLine(by) ? undefined : BY_HINT
  if (!isMap(by) || Object.keys(by).some(k => k !== 'name')) return BY_HINT
  if (!plainLine(by.name)) return 'animation by name must be plain text on one line'
  return by.name.trim().length > NAME_MAX ? `animation by name can be at most ${NAME_MAX} characters` : undefined
}

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
    const { trigger, carries, outcome, share, reason, by, at } = raw
    if (trigger !== undefined && !TRIGGERS.some(t => t === trigger)) return `animation trigger must be ${TRIGGERS.join(' or ')}`
    if (trigger !== undefined && kind !== 'callback') return 'animation trigger only applies to callback'
    if (carries !== undefined && (typeof carries !== 'string' || carries.trim() === '')) return 'animation carries must be a word'
    if (outcome !== undefined && !isOutcome(outcome)) return `animation outcome must be ${orList(OUTCOMES)}`
    if (outcome === 'timeout' && kind !== 'call') return 'animation outcome timeout only applies to call'
    if (outcome === 'fail' && kind !== 'send' && kind !== 'call') return 'animation outcome fail only applies to send and call'
    if (TRAVEL_OUTCOMES.some(o => o === outcome) && kind === 'callback') return `animation outcome ${String(outcome)} only applies to send, call and event`
    if (share !== undefined) {
      if (shareOf(share) === undefined) return 'animation share must be a whole number from 1 to 100'
      if (outcome === undefined) return 'animation share needs an outcome'
    }
    if (reason !== undefined) {
      if (!plainLine(reason)) return 'animation reason must be plain text on one line'
      if (reason.trim().length > REASON_MAX) return `animation reason can be at most ${REASON_MAX} characters`
      if (outcome === undefined) return 'animation reason needs an outcome'
    }
    if (outcome === 'intercepted') {
      if (by === undefined) return 'animation outcome intercepted needs a "by" (a shape id, or { name: ... })'
      const why = byProblem(by)
      if (why !== undefined) return why
    } else if (by !== undefined) return 'animation by only applies to outcome intercepted'
    if (at !== undefined) {
      if (lostAtOf(at) === undefined) return 'animation at must be a number from 0.1 to 0.9'
      if (outcome !== 'lost') return 'animation at only applies to outcome lost'
    }
  }
  if (!hasTo) return `animation "${kind}" needs a "to"`
  return undefined
}

/**
 * What is wrong with the shape an interception names, or undefined. It needs the model, so animationProblem leaves it: an unknown shape,
 * or one of the step's own ends (the shape that takes the request is a third party). A `{ name: ... }` is never checked against the model.
 */
export function interceptorProblem(raw: unknown, step: { from: string; to?: string }, exists: (id: string) => boolean): string | undefined {
  if (!isMap(raw) || raw.outcome !== 'intercepted' || typeof raw.by !== 'string' || raw.by.trim() === '') return undefined
  const id = raw.by.trim()
  if (!exists(id)) return `animation by: unknown object "${id}"`
  if (id === step.from || id === step.to) return `animation by "${id}" is an end of the step (name another shape, or use { name: ... })`
  return undefined
}

/** The step's animation, or undefined when it has none or the tag is wrong (check() reports that) or nothing would travel. */
export function animationOf(step: { to?: string; animation?: unknown }): Animation | undefined {
  const raw = step.animation
  if (raw === undefined || raw === '' || animationProblem(raw, step.to !== undefined) !== undefined) return undefined
  const map = isMap(raw) ? raw : { kind: raw }
  const share = shareOf(map.share)
  const at = lostAtOf(map.at)
  const by = ((): Interceptor | undefined => {
    if (typeof map.by === 'string') return { shape: map.by.trim() }
    return isMap(map.by) && typeof map.by.name === 'string' ? { name: map.by.name.trim() } : undefined
  })()
  return {
    kind: map.kind as AnimationKind,
    trigger: map.trigger === 'outside' ? 'outside' : 'inside',
    ...(typeof map.carries === 'string' ? { carries: map.carries } : {}),
    ...(isOutcome(map.outcome) ? { outcome: map.outcome } : {}),
    ...(share === undefined ? {} : { share }),
    ...(typeof map.reason === 'string' ? { reason: map.reason.trim() } : {}),
    ...(by === undefined ? {} : { by }),
    ...(at === undefined ? {} : { at }),
  }
}

/**
 * How many requests a share plays, and which of them meet the outcome: 10 when the share is a multiple of 10, 20 for a multiple of 5,
 * otherwise 100, so the share shows exactly. Request `i` is hit when the running total of `share` percent crosses a whole request, which
 * spreads the hits evenly through the burst. It is fixed by the numbers and never random, so the browser, the desktop app and the tests play the same.
 */
export function burstOf(share: number): { count: number; hit: boolean[] } {
  const count = share % 10 === 0 ? 10 : share % 5 === 0 ? 20 : 100
  return { count, hit: Array.from({ length: count }, (_, i) => Math.floor(((i + 1) * share) / 100) > Math.floor((i * share) / 100)) }
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)

/**
 * How the step's outcome reads on the step card and in the Mermaid note, as a fragment: "Lost", "30% lost", "Rejected: Rate limit",
 * "Taken by Café wifi proxy", "Sent twice", "Delayed: Cold start". A share comes first and the verb follows in lower case; a reason follows after a colon.
 * `nameOf` turns the id of an intercepting shape into its name. Undefined when the step has no outcome.
 */
export function outcomeLine(a: Animation, nameOf: (shape: string) => string = id => id): string | undefined {
  if (a.outcome === undefined) return undefined
  const who = a.by === undefined ? '' : 'name' in a.by ? a.by.name : nameOf(a.by.shape)
  // With a share the verb follows a number ("30% fail"), so the two that are about one request change their form.
  const words: Record<Outcome, string> = {
    fail: a.share === undefined ? 'Fails' : 'fail', timeout: a.share === undefined ? 'Times out' : 'time out', lost: 'Lost', rejected: 'Rejected',
    intercepted: `Taken by ${who}`, duplicated: 'Sent twice', delayed: 'Delayed',
  }
  const verb = a.share === undefined ? words[a.outcome] : `${a.share}% ${lowerFirst(words[a.outcome])}`
  return a.reason === undefined ? verb : `${verb}: ${a.reason}`
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
