/**
 * How a flow step plays. A step may carry `animation:`, a kind (`call`) or a mapping with one
 * (`{ kind: callback, trigger: outside }`). This file says what a tag may hold and turns it into beats:
 * a timed list of the few things a renderer can draw. Nothing here draws, and nothing needs a browser.
 * desktop/Flowy.Core/Animation.cs is a port, and desktop/fixtures/beats.ts keeps the two equal.
 */
import { isMap } from './text.ts'

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
/**
 * What the blob does on its way besides travelling, for the fun of it: nothing unless a step asks. Every one keeps its shape whole, with no distortion:
 * `squish` stretches it along its way, `bounce` hops it like a ball, `pulse` swells it and lets it settle, `wiggle` rocks it from side to side.
 * It is an extra key, so unknown-option messages still list only OPTIONS.
 */
export const EFFECTS = ['squish', 'bounce', 'pulse', 'wiggle'] as const
export type Effect = (typeof EFFECTS)[number]
const isEffect = (v: unknown): v is Effect => EFFECTS.some(e => e === v)
/** The outcomes that came after fail and timeout. They are valid on a send, a call and an event, never on a callback. */
const TRAVEL_OUTCOMES = ['lost', 'rejected', 'intercepted', 'duplicated', 'delayed'] as const
const isOutcome = (v: unknown): v is Outcome => OUTCOMES.some(o => o === v)
type TravelOutcome = (typeof TRAVEL_OUTCOMES)[number]
const isTravelOutcome = (v: unknown): v is TravelOutcome => TRAVEL_OUTCOMES.some(o => o === v)

/**
 * Which kinds each outcome fits. `kinds` are the ones it may take, `only` finishes "animation outcome X only applies to ...", and `needs` is
 * the picker's tooltip when the kind is wrong (the travel outcomes have none: only a callback is wrong for them, and `outcomeBlock` words that).
 */
type OutcomeRule = { kinds: readonly AnimationKind[]; only: string; needs?: string }
const TRAVEL_RULE: OutcomeRule = { kinds: ['send', 'call', 'event'], only: 'send, call and event' }
const OUTCOME_RULES: Record<Outcome, OutcomeRule> = {
  fail: { kinds: ['send', 'call'], only: 'send and call', needs: 'Needs a send or a call' },
  timeout: { kinds: ['call'], only: 'call', needs: 'Needs a call' },
  lost: TRAVEL_RULE, rejected: TRAVEL_RULE, intercepted: TRAVEL_RULE, duplicated: TRAVEL_RULE, delayed: TRAVEL_RULE,
}

/**
 * Where each option of an animation means something. `kind` is the one kind it applies to; `outcome` is the one outcome it applies to, or
 * 'any' for every outcome (it needs one). A new kind or outcome drops the options that no longer apply (see animationWith).
 */
type OptionRule = { kind?: AnimationKind; outcome?: Outcome | 'any' }
type PlacedOption = 'trigger' | 'share' | 'reason' | 'by' | 'at'
const OPTION_RULES: Record<PlacedOption, OptionRule> = {
  trigger: { kind: 'callback' },
  share: { outcome: 'any' },
  reason: { outcome: 'any' },
  by: { outcome: 'intercepted' },
  at: { outcome: 'lost' },
}
const PLACED_OPTIONS = Object.keys(OPTION_RULES) as PlacedOption[]
/** The options that mean something only while the step has an outcome. */
const NEEDS_OUTCOME = PLACED_OPTIONS.filter(o => OPTION_RULES[o].outcome !== undefined)

/** Why an option is out of place for a step of this kind and outcome, worded to follow "animation ", or undefined when it is there or fits. */
function misplaced(option: PlacedOption, value: unknown, kind: AnimationKind, outcome: unknown): string | undefined {
  if (value === undefined) return undefined
  const rule = OPTION_RULES[option]
  if (rule.kind !== undefined && kind !== rule.kind) return `${option} only applies to ${rule.kind}`
  if (rule.outcome === 'any') return outcome === undefined ? `${option} needs an outcome` : undefined
  return rule.outcome !== undefined && outcome !== rule.outcome ? `${option} only applies to outcome ${rule.outcome}` : undefined
}

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
  effect?: Effect
}

export type Glyph = 'envelope' | 'bolt' | 'bell'

/**
 * One thing to draw. `do` says what: the tube along the line (`pipe`), something running through it (`blob`),
 * a ring going out from a box, a flash on it, a squash as it takes something in (`gulp`), waiting dots over it,
 * a glyph falling onto it (`drop`), or the step's lit line dimming and staying dim (`fade`). `on` says where.
 * The outcomes add five more: a puff where a request is lost (`pop`), a bar flashing at the receiver's door (`bar`), a dashed clock turning
 * while a request waits (`clock`), a few words next to where something happens (`note`) and the dashed marker of whoever takes a request (`marker`).
 * `on` is `by` for what happens at the interceptor. Times are milliseconds from the start of the step.
 */
export type Beat = {
  do: 'pipe' | 'blob' | 'ring' | 'flash' | 'gulp' | 'wait' | 'drop' | 'fade' | 'pop' | 'bar' | 'clock' | 'note' | 'marker'
  on: 'from' | 'to' | 'line' | 'by'
  at: number
  dur: number
  /** blob only: `fwd` runs from the step's `from` to its `to`, `back` the other way. */
  dir?: 'fwd' | 'back'
  glyph?: Glyph
  /** blob: a reply is drawn in the answer's colour. blob and flash: `fail` is drawn in the danger colour. */
  tone?: 'reply' | 'fail'
  /** blob only: the `carries` word or the name of a request in a burst, shown instead of the glyph. */
  label?: string
  /** blob only: the fractions of the route it runs between (0 and 1 when they are left out). `back` runs from `end` to `start`. On `by` it is where it leaves the route. */
  start?: number
  end?: number
  /** blob and pop: a slot of TINTS, the colour of a request that meets an outcome in a burst. */
  tint?: number
  /** blob only: a ring around it, so a request that meets an outcome in a burst is never told apart by colour alone. */
  ring?: boolean
  /** pop, bar, clock, note and marker: where along the route, as a fraction of it. */
  along?: number
  /** note: the reason. marker: the name of a party that is not in the model. */
  text?: string
}

/** The colours a request that meets an outcome in a burst can have, as shape colour names. Blue, red and amber belong to the ordinary dot, a refusal and a warning. */
export const TINTS = ['teal', 'pink', 'purple', 'orange'] as const

/** The most characters of a name a blob shows. A longer `carries` word is cut with an ellipsis, so it never stretches across the canvas. */
export const LABEL_MAX = 16
export const shortLabel = (label: string): string => (label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label)

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
    const extra = Object.keys(raw).find(k => k !== 'effect' && !OPTIONS.some(o => o === k))
    if (extra !== undefined) return `unknown animation option "${extra}" (use ${OPTIONS.join(', ')})`
    const { trigger, carries, outcome, share, reason, by, at } = raw
    if (trigger !== undefined && !TRIGGERS.some(t => t === trigger)) return `animation trigger must be ${TRIGGERS.join(' or ')}`
    let out = misplaced('trigger', trigger, kind, outcome)
    if (out) return `animation ${out}`
    if (carries !== undefined && (typeof carries !== 'string' || carries.trim() === '')) return 'animation carries must be a word'
    if (raw.effect !== undefined && !isEffect(raw.effect)) return `animation effect must be ${orList(EFFECTS)}`
    if (outcome !== undefined && !isOutcome(outcome)) return `animation outcome must be ${orList(OUTCOMES)}`
    if (isOutcome(outcome) && !OUTCOME_RULES[outcome].kinds.some(k => k === kind)) return `animation outcome ${outcome} only applies to ${OUTCOME_RULES[outcome].only}`
    if (share !== undefined && shareOf(share) === undefined) return 'animation share must be a whole number from 1 to 100'
    out = misplaced('share', share, kind, outcome)
    if (out) return `animation ${out}`
    if (reason !== undefined) {
      if (!plainLine(reason)) return 'animation reason must be plain text on one line'
      if (reason.trim().length > REASON_MAX) return `animation reason can be at most ${REASON_MAX} characters`
    }
    out = misplaced('reason', reason, kind, outcome)
    if (out) return `animation ${out}`
    if (outcome === 'intercepted') {
      if (by === undefined) return 'animation outcome intercepted needs a "by" (a shape id, or { name: ... })'
      const why = byProblem(by)
      if (why !== undefined) return why
    } else {
      out = misplaced('by', by, kind, outcome)
      if (out) return `animation ${out}`
    }
    if (at !== undefined && lostAtOf(at) === undefined) return 'animation at must be a number from 0.1 to 0.9'
    out = misplaced('at', at, kind, outcome)
    if (out) return `animation ${out}`
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
    ...(isEffect(map.effect) ? { effect: map.effect } : {}),
  }
}

/**
 * What a step's animation says, field by field, as the text the edit form shows: "" for a field the file leaves out. Unlike animationOf it
 * keeps what is wrong (an unknown kind, a share of "many", a number as text), so the form can show a file's mistake instead of hiding it.
 * A bare tag is the kind. `by` is the id of the shape that takes the request, `byName` the name of a party that is not in the model.
 */
export type AnimationFields = { kind: string; outcome: string; share: string; reason: string; by: string; byName: string }

export function animationFields(step: { animation?: unknown }): AnimationFields {
  const raw = step.animation
  const map = isMap(raw) ? raw : typeof raw === 'string' ? { kind: raw } : {}
  const text = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '')
  return {
    kind: text(map.kind),
    outcome: text(map.outcome),
    share: text(map.share),
    reason: text(map.reason),
    by: text(map.by),
    byName: isMap(map.by) ? text(map.by.name) : '',
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

/** How long a reason stays up beside where the outcome happens, and how long a puff, a bar and the wait of a delayed request last. */
const NOTE_MS = 1600
const POP_MS = 500
const BAR_MS = 900
const DELAY_HOLD = 1500
/** Where along the route a rejected request stops, where the bar is, where a delayed one waits and an intercepted one leaves, and where a reason sits for the others. */
const REJECT_STOP = 0.92
const BAR_AT = 0.97
const WAIT_AT = 0.4
const LANDING_NOTE_AT = 0.88
/**
 * A burst starts a request every BURST_STAGGER ms, or further apart on a short line so the blobs stay about BLOB_SPACING px from each other,
 * and never spreads its starts over more than BURST_SPREAD ms, so 100 requests still take only a few seconds.
 */
const BURST_STAGGER = 300
const BLOB_SPACING = 36
const BURST_SPREAD = 4000

/**
 * One request of the step: whether it meets the outcome (`hit`), the word it carries, and, in a burst, the colour and ring of a request that
 * meets one. `fade` is whether a timeout dims the line after it (in a burst only the last one does).
 */
type Req = { hit: boolean; label?: string; tint?: number; ring?: boolean; fade?: boolean }

/**
 * The step as beats, with the tube first and how long the whole thing lasts. They are listed request by request, and each request in the order its beats start.
 * `length` is how long the line is on screen; `afterLanding` is followsLanding for this step.
 * A step with a `share` plays a burst of requests one after another (see burstOf): the ones that meet the outcome are named `r1`, `r2`, ... or by `carries`,
 * and coloured and ringed, and the rest are ordinary deliveries that carry no name. Without one the step plays a single request.
 * The kinds of beat and their order never depend on `length`, only their times and the fractions that follow from it, so a renderer may lay its shapes out once.
 */
export function beatsFor(a: Animation, { length, afterLanding }: { length: number; afterLanding: boolean }): { beats: Beat[]; total: number } {
  const T = travelMs(length)
  /** A fraction of the time a request takes to cross, in whole milliseconds. */
  const ms = (fraction: number): number => Math.floor(T * fraction + 0.5)
  const note = (at: number, dur: number, where: { along: number } | { on: 'by' }): Beat[] =>
    a.reason === undefined ? [] : [{ do: 'note', on: 'on' in where ? where.on : 'line', at, dur, ...('along' in where ? { along: where.along } : {}), text: a.reason }]

  /** A request that runs into one of the five outcomes after fail and timeout. */
  const outcome5 = (o: number, r: Req, outcome: TravelOutcome): Beat[] => {
    const glyph: Glyph = a.kind === 'event' ? 'bolt' : 'envelope'
    const call = a.kind === 'call'
    const s = o + 250
    const squeeze = effect('gulp', 'from', o, 250)
    const blob = (at: number, dur: number, more: Partial<Pick<Beat, 'on' | 'dir' | 'tone' | 'start' | 'end'>> = {}): Beat => ({
      do: 'blob', on: more.on ?? 'line', at, dur, dir: more.dir ?? 'fwd', glyph,
      ...(more.tone === undefined ? {} : { tone: more.tone }),
      ...(r.label === undefined ? {} : { label: r.label }),
      ...(more.start === undefined ? {} : { start: more.start }),
      ...(more.end === undefined ? {} : { end: more.end }),
      ...(r.tint === undefined ? {} : { tint: r.tint }),
      ...(r.ring === true ? { ring: true } : {}),
    })
    // Where a request lands: a squash, or a flash for an event.
    const taken = (at: number): Beat[] => (a.kind === 'event' ? [effect('flash', 'to', at, 450)] : [effect('gulp', 'to', at, 300)])
    // A call still gets its answer once the request has landed.
    const reply = (landed: number): Beat[] =>
      call
        ? [
            effect('wait', 'from', landed, 600),
            { do: 'blob', on: 'line', at: landed + 600, dur: T, dir: 'back', glyph: 'envelope', tone: 'reply' },
            effect('gulp', 'from', landed + 600 + T, 300),
          ]
        : []
    switch (outcome) {
      case 'lost': {
        // It runs partway, pops, and nothing arrives: no squash at the receiver, and a caller keeps waiting.
        const at = a.at ?? LOST_AT
        const gone = s + ms(at)
        return [
          squeeze, blob(s, ms(at), { end: at }),
          { do: 'pop', on: 'line', at: gone, dur: POP_MS, ...(r.tint === undefined ? {} : { tint: r.tint }), along: at },
          ...note(gone, NOTE_MS, { along: at }),
          ...(call ? [effect('wait', 'from', gone, TIMEOUT_WAIT)] : []),
        ]
      }
      case 'rejected': {
        // It stops at the bar by the door, which flashes, and comes back in the danger tone to the sender, who takes it in.
        const door = s + ms(REJECT_STOP)
        const back = door + 450
        return [
          squeeze, blob(s, ms(REJECT_STOP), { end: REJECT_STOP }),
          { do: 'bar', on: 'line', at: door, dur: BAR_MS, along: BAR_AT },
          ...note(door, NOTE_MS, { along: REJECT_STOP }),
          ...(call ? [effect('wait', 'from', door, 450)] : []),
          blob(back, ms(REJECT_STOP), { dir: 'back', tone: 'fail', end: REJECT_STOP }),
          effect('gulp', 'from', back + ms(REJECT_STOP), 300),
        ]
      }
      case 'intercepted': {
        // It leaves the line for whoever takes it, which flashes. Nothing goes on to the receiver.
        const leaves = s + ms(WAIT_AT)
        const there = leaves + 700
        return [
          squeeze, blob(s, ms(WAIT_AT), { end: WAIT_AT }),
          blob(leaves, 700, { on: 'by', start: WAIT_AT }),
          { do: 'flash', on: 'by', at: there, dur: 450 },
          ...note(there, NOTE_MS, { on: 'by' }),
          ...(call ? [effect('wait', 'from', there, TIMEOUT_WAIT)] : []),
        ]
      }
      case 'duplicated': {
        // A second copy leaves the first where it passes the split and arrives later, so the receiver takes it in twice.
        const second = s + ms(0.45)
        const again = second + ms(0.9)
        return [
          squeeze, blob(s, T), blob(second, ms(0.9), { start: WAIT_AT }),
          ...taken(s + T), ...taken(again),
          ...note(second, NOTE_MS, { along: WAIT_AT }),
          ...reply(again),
        ]
      }
      case 'delayed': {
        // It runs to the clock, waits there while it turns, and goes on.
        const run = ms(WAIT_AT)
        const resume = s + run + DELAY_HOLD
        const landed = resume + (T - run)
        return [
          squeeze, blob(s, run, { end: WAIT_AT }),
          blob(s + run, DELAY_HOLD, { start: WAIT_AT, end: WAIT_AT }),
          { do: 'clock', on: 'line', at: s + run, dur: DELAY_HOLD, along: WAIT_AT },
          ...note(s + run, DELAY_HOLD, { along: WAIT_AT }),
          blob(resume, T - run, { start: WAIT_AT }),
          ...taken(landed),
          ...reply(landed),
        ]
      }
    }
  }

  /** A request that works, or fails or never gets an answer (the two outcomes there were first). */
  const request = (o: number, r: Req): Beat[] => {
    const outcome = r.hit ? a.outcome : undefined
    if (isTravelOutcome(outcome)) return outcome5(o, r, outcome)
    const failed = outcome === 'fail'
    // A refusal is the news, so everything that runs is the danger tone and the receiver flashes in it when it lands.
    const blob = (at: number, glyph: Glyph): Beat => ({
      do: 'blob', on: 'line', at, dur: T, dir: 'fwd', glyph,
      ...(failed ? { tone: 'fail' as const } : {}),
      ...(r.label === undefined ? {} : { label: r.label }),
      ...(r.tint === undefined ? {} : { tint: r.tint }),
      ...(r.ring === true ? { ring: true } : {}),
    })
    const refused = (at: number): Beat[] => (failed ? [{ do: 'flash', on: 'to', at, dur: 450, tone: 'fail' }] : [])
    const dim = (at: number): Beat => ({ do: 'fade', on: 'line', at, dur: TIMEOUT_FADE })
    switch (a.kind) {
      case 'send':
        return [effect('gulp', 'from', o, 250), blob(o + 250, 'envelope'), effect('gulp', 'to', o + 250 + T, 300), ...refused(o + 250 + T), ...(failed ? note(o + 250 + T, NOTE_MS, { along: LANDING_NOTE_AT }) : [])]
      case 'call': {
        const landed = o + 250 + T
        if (outcome === 'timeout') {
          // Nobody answers: the sender keeps waiting, nothing comes back, and the line dims.
          return [
            effect('gulp', 'from', o, 250), blob(o + 250, 'envelope'), effect('gulp', 'to', landed, 300), effect('wait', 'from', landed, TIMEOUT_WAIT),
            ...(r.fade === false ? [] : [dim(landed + TIMEOUT_WAIT)]),
            ...note(landed, NOTE_MS, { along: LANDING_NOTE_AT }),
          ]
        }
        const back = landed + 600
        return [
          effect('gulp', 'from', o, 250), blob(o + 250, 'envelope'), effect('gulp', 'to', landed, 300), ...refused(landed), effect('wait', 'from', landed, 600),
          { do: 'blob', on: 'line', at: back, dur: T, dir: 'back', glyph: 'envelope', tone: failed ? 'fail' : 'reply' },
          effect('gulp', 'from', back + T, 300),
          ...(failed ? note(landed, NOTE_MS, { along: LANDING_NOTE_AT }) : []),
        ]
      }
      case 'event':
        return [effect('gulp', 'from', o, 250), blob(o + 250, 'bolt'), effect('flash', 'to', o + 250 + T, 450)]
      case 'callback':
        if (a.trigger === 'inside') return [effect('ring', 'from', 0, 600), blob(450, 'bell'), effect('ring', 'to', 450 + T, 600)]
        if (afterLanding) return [effect('flash', 'from', 0, 450), blob(300, 'bell'), effect('ring', 'to', 300 + T, 600)]
        return [{ do: 'drop', on: 'from', at: 0, dur: 600, glyph: 'bolt' }, effect('flash', 'from', 600, 450), blob(850, 'bell'), effect('ring', 'to', 850 + T, 600)]
    }
  }

  // One request, or a burst of them: the share's hits get a name, a colour and a ring, the rest are ordinary.
  const burst = a.share !== undefined && a.outcome !== undefined && a.kind !== 'callback' ? burstOf(a.share) : undefined
  const body = ((): Beat[] => {
    if (burst === undefined) return request(0, { hit: true, ...(a.carries === undefined ? {} : { label: a.carries }) })
    const spacing = Number.isFinite(length) && length > 0 ? Math.ceil((BLOB_SPACING * T) / length) : 0
    const stagger = Math.min(Math.floor(BURST_SPREAD / (burst.count - 1)), Math.max(BURST_STAGGER, spacing))
    const last = burst.hit.lastIndexOf(true)
    let nth = 0
    return burst.hit.flatMap((hit, i) => {
      if (!hit) return request(i * stagger, { hit: false })
      nth++
      return request(i * stagger, { hit: true, label: a.carries ?? `r${nth}`, tint: (nth - 1) % TINTS.length, ring: true, fade: i === last })
    })
  })()
  const total = Math.max(...body.map(b => b.at + b.dur))
  // Whoever takes an intercepted request is drawn for the whole step, a shape by a dashed outline and a party that is not in the model by a dashed marker with its name.
  const marker: Beat[] = a.outcome === 'intercepted' && a.by !== undefined
    ? [{ do: 'marker', on: 'by', at: 0, dur: total, along: WAIT_AT, ...('name' in a.by ? { text: a.by.name } : {}) }]
    : []
  return { beats: [{ do: 'pipe', on: 'line', at: 0, dur: total }, ...marker, ...body], total }
}

/**
 * The drawings the pickers of edit mode offer, one for each way a step can travel and one for each way its request can end, as stroke-only path data on a
 * 44 by 24 grid. The browser and the desktop app draw the same strings. `none` is the choice of no animation, and of a request that arrives.
 */
export const KIND_SKETCHES: Record<'none' | AnimationKind, string> = {
  none: 'M6 12H38',
  send: 'M6 12H36M30 6l6 6l-6 6',
  call: 'M6 8H38M32 3l6 5l-6 5M38 17H6M12 12l-6 5l6 5',
  callback: 'M22 3a5 5 0 0 0 -5 5v4l-2 4h14l-2 -4v-4a5 5 0 0 0 -5 -5zM20 19a2 2 0 0 0 4 0',
  event: 'M24 2l-9 12h7l-2 8l9 -12h-7z',
}
export const OUTCOME_SKETCHES: Record<'none' | Outcome, string> = {
  none: 'M6 12H36M30 6l6 6l-6 6',
  fail: 'M6 12H26M31 6l9 12M40 6l-9 12',
  timeout: 'M6 12H22M29 12h.01M34 12h.01M39 12h.01',
  lost: 'M6 12H16M22 6l10 12M32 6l-10 12',
  rejected: 'M6 9H31M37 3v18M31 16H12M18 11l-6 5l6 5',
  intercepted: 'M6 8H18l7 8M27 14h12v8h-12z',
  duplicated: 'M6 7H36M30 2l6 5l-6 5M6 18H36M30 13l6 5l-6 5',
  delayed: 'M6 12H15M29 12H38M22 6a6 6 0 1 0 .01 0M22 9v3l2 2',
}

/**
 * Why an outcome cannot be picked for a step that travels as `kind`, in a few words for a tooltip, or undefined when it can. The picker greys the choice out
 * with this beside it, and the checker refuses the same pairs. `outcome` "" (the request arrives) always fits.
 */
export function outcomeBlock(kind: string | undefined, outcome: string): string | undefined {
  if (outcome === '') return undefined
  if (kind === undefined || kind === '') return 'Pick how it travels first'
  if (kind === 'callback') return 'Not for a callback'
  return isOutcome(outcome) && !OUTCOME_RULES[outcome].kinds.some(k => k === kind) ? OUTCOME_RULES[outcome].needs : undefined
}

/** The keys of an animation the pickers and fields of edit mode set. `by` is the id of a shape that takes the request, `byName` the name of a party that is not in the model. */
export type AnimationKey = 'kind' | 'outcome' | 'share' | 'reason' | 'at' | 'carries' | 'by' | 'byName'

/** Who takes an intercepted request until the reader names one: an interception needs a taker, so picking it never leaves the step without. */
export const DEFAULT_TAKER = 'Third party'

/**
 * A step's `animation` with one key set, as the pickers of edit mode make it. Setting the kind to "" takes the animation away, and the outcome to "" takes it
 * away together with what needs it (share, reason, by, at). A choice that no longer fits what is set drops what it unseats: a new kind drops an outcome it
 * cannot have, a new outcome drops `by` unless it is intercepted and `at` unless it is lost. An intercepted step always has someone who takes it: when none
 * is named it is DEFAULT_TAKER. A blank text removes its key. The result is the bare kind when
 * nothing else is set, else a mapping that keeps the order of the keys that were there; undefined means no animation.
 */
export function animationWith(current: unknown, key: AnimationKey, value: string): Record<string, unknown> | string | undefined {
  const map: Record<string, unknown> = isMap(current) ? { ...current } : typeof current === 'string' && current !== '' ? { kind: current } : {}
  const drop = (...keys: string[]) => keys.forEach(k => delete map[k])
  const text = value.trim()
  if (key === 'kind') {
    if (text === '') return undefined
    map.kind = text
    drop(...PLACED_OPTIONS.filter(o => OPTION_RULES[o].kind !== undefined && OPTION_RULES[o].kind !== text))
    if (typeof map.outcome === 'string' && outcomeBlock(text, map.outcome) !== undefined) drop('outcome', ...NEEDS_OUTCOME)
  } else if (key === 'outcome') {
    if (text === '') drop('outcome', ...NEEDS_OUTCOME)
    else {
      map.outcome = text
      drop(...PLACED_OPTIONS.filter(o => OPTION_RULES[o].outcome !== undefined && OPTION_RULES[o].outcome !== 'any' && OPTION_RULES[o].outcome !== text))
    }
  } else if (key === 'byName') {
    if (text === '') drop('by')
    else map.by = { name: text }
  } else if (text === '') drop(key)
  else map[key] = text
  if (map.outcome === 'intercepted' && map.by === undefined) map.by = { name: DEFAULT_TAKER }
  const keys = Object.keys(map)
  if (keys.length === 0) return undefined
  return keys.length === 1 && keys[0] === 'kind' && typeof map.kind === 'string' ? map.kind : map
}

/**
 * Whether the step leaves marks where its outcome happened (a cross, a bar, a clock, a marker, a reason). A still picture needs them too, and the label of
 * its line moves aside so they never sit on it.
 */
export const leavesMarks = (a: Animation): boolean =>
  beatsFor(a, { length: 0, afterLanding: false }).beats.some(b => b.do === 'pop' || b.do === 'bar' || b.do === 'clock' || b.do === 'note' || b.do === 'marker')
