import { animationOf } from './animation.ts'
import { ID_RULE, isValidId } from './model.ts'
import type { Connection, Model, Step } from './model.ts'
import { codeLines, isBlankCode, LANGUAGES, languageOf } from './snippets.ts'
import { hasText, isMap } from './text.ts'
import { lineKey, placeEnds, placeStep } from './views.ts'

/**
 * The data a line carries and a flow step sends: a name, and any mix of a few words about it, its whole shape (a type, a JSON schema, a CSV header) and a filled-in
 * example. A model describes each once under `payloads:` in model.yaml, by id, and a connection's `payloads:` list or a step's `payload:` and `reply:` name it; either can
 * also hold one written out in place. The shape and the example are code, coloured as a snippet is. A long schema is fine, up to these limits.
 */
export const PAYLOAD_MAX = { lines: 400, chars: 40000, perLine: 12, inModel: 200 } as const

/** A payload's shape or example: some code, in a language if you like (worked out from the code when left out). Extra keys are kept. */
export type CodeBlock = { text: string; language?: string; [extra: string]: unknown }

/** A payload as the file holds it. Every field may be missing; check() says what is wrong with one that is not text or not a code block. */
export type Payload = { name?: string; about?: string; shape?: CodeBlock; example?: CodeBlock; [extra: string]: unknown }

/** A payload as a reader shows it: `id` only for one described under `payloads:`, `name` always filled in (the id when it has none), and only the code blocks that hold code. */
export type Shown = { id?: string; name: string; about?: string; shape?: CodeBlock; example?: CodeBlock }

/** Whether a payload says something: a few words about it, a shape or an example. */
export const saysSomething = (p: Record<string, unknown>): boolean => hasText(p.about) || p.shape !== undefined || p.example !== undefined

/** The animation kinds that send something back, so a step of one of them may say what its reply carries. */
export const REPLY_KINDS = ['call', 'callback', 'recurse'] as const

/** The entries of `payloads:` in model.yaml that are mappings, in the file's order. Nothing when there is none or it is not a mapping (check() reports that). */
export function payloadsOf(model: Pick<Model, 'meta'>): Record<string, Payload> {
  const all = model.meta.payloads
  if (!isMap(all)) return {}
  return Object.fromEntries(Object.entries(all).filter(([, p]) => isMap(p))) as Record<string, Payload>
}

const blockOf = (v: unknown): CodeBlock | undefined =>
  isMap(v) && typeof v.text === 'string' && !isBlankCode(v.text) && (v.language === undefined || typeof v.language === 'string')
    ? { text: v.text, ...(v.language === undefined ? {} : { language: v.language }) }
    : undefined

/** What a reader shows of a payload mapping, under `name` (its own, or the id it is filed under). */
function shownOf(p: Record<string, unknown>, name: string, id?: string): Shown {
  const shape = blockOf(p.shape)
  const example = blockOf(p.example)
  return {
    ...(id === undefined ? {} : { id }),
    name,
    ...(hasText(p.about) ? { about: p.about } : {}),
    ...(shape ? { shape } : {}),
    ...(example ? { example } : {}),
  }
}

/**
 * The payload a connection or a step names: an id finds the entry under `payloads:` (named after the id when it has no name), and a mapping with a name is itself. An
 * unknown id, a mapping with no name and anything else find nothing; check() reports each.
 */
export function resolvePayload(model: Pick<Model, 'meta'>, ref: unknown): Shown | undefined {
  if (typeof ref === 'string') {
    const all = model.meta.payloads
    if (!isMap(all) || !Object.hasOwn(all, ref) || !isMap(all[ref])) return undefined
    const p = all[ref]
    return shownOf(p, hasText(p.name) ? p.name : ref, ref)
  }
  return isMap(ref) && hasText(ref.name) ? shownOf(ref, ref.name) : undefined
}

/** The payloads a connection carries that resolve, in the order its `payloads:` lists them. */
export function connectionPayloads(model: Pick<Model, 'meta'>, c: Connection): Shown[] {
  return Array.isArray(c.payloads) ? c.payloads.flatMap(ref => resolvePayload(model, ref) ?? []) : []
}

/** What a step sends. */
export const stepPayload = (model: Pick<Model, 'meta'>, s: Step): Shown | undefined => resolvePayload(model, s.payload)

/** What comes back to a step: the answer to a call, the call back, what each level of a recursion hands back. */
export const stepReply = (model: Pick<Model, 'meta'>, s: Step): Shown | undefined => resolvePayload(model, s.reply)

/** What is wrong with a shape or an example, each message after `at` (`payload order: shape ...`). */
function blockProblems(at: string, key: 'shape' | 'example', v: unknown): string[] {
  if (v === undefined) return []
  if (!isMap(v)) return [`${at}: ${key} must be a mapping with text and, if you like, a language`]
  const out: string[] = []
  if (v.text === undefined || (typeof v.text === 'string' && isBlankCode(v.text))) out.push(`${at}: ${key} has no text`)
  else if (typeof v.text !== 'string') out.push(`${at}: ${key} must be a mapping with text and, if you like, a language`)
  else {
    const code = codeLines(v.text)
    if (code.length > PAYLOAD_MAX.lines) out.push(`${at}: ${key} is ${code.length} lines, at most ${PAYLOAD_MAX.lines}`)
    const chars = code.join('\n').length
    if (chars > PAYLOAD_MAX.chars) out.push(`${at}: ${key} is ${chars} characters, at most ${PAYLOAD_MAX.chars}`)
  }
  if (v.language !== undefined && v.language !== '') {
    if (typeof v.language !== 'string') out.push(`${at}: ${key}: language must be plain text`)
    else if (!languageOf(v.language)) out.push(`${at}: ${key}: unknown language "${v.language}" (use ${LANGUAGES.map(l => l.id).join(', ')}, or leave it out to have it worked out)`)
  }
  return out
}

/** What is wrong with one payload mapping, each message starting with `at`. One written in place (`inline`) must have a name, as it has no id to go by. */
function entryProblems(at: string, p: unknown, inline: boolean): string[] {
  if (!isMap(p)) return [`${at} must be a mapping`]
  const out: string[] = []
  if (p.name !== undefined && typeof p.name !== 'string') out.push(`${at}: name must be plain text`)
  else if (inline && !hasText(p.name)) out.push(`${at} has no name`)
  if (p.about !== undefined && typeof p.about !== 'string') out.push(`${at}: about must be plain text`)
  if (!saysSomething(p)) out.push(`${at} says nothing: give it an about, a shape or an example`)
  return [...out, ...blockProblems(at, 'shape', p.shape), ...blockProblems(at, 'example', p.example)]
}

/** What is wrong with the top-level `payloads:` of model.yaml, each message whole (it is reported on model.yaml, for no shape). */
export function modelPayloadProblems(meta: Model['meta']): string[] {
  const all = meta.payloads
  if (all === undefined || all === '') return []
  if (!isMap(all)) return ['payloads must map ids to payloads']
  const out: string[] = []
  for (const [id, p] of Object.entries(all)) {
    if (!isValidId(id)) out.push(`payload ${id}: ids ${ID_RULE}`)
    out.push(...entryProblems(`payload ${id}`, p, false))
  }
  const count = Object.keys(all).length
  if (count > PAYLOAD_MAX.inModel) out.push(`${count} payloads, at most ${PAYLOAD_MAX.inModel}`)
  return out
}

/** A reference to a payload: an id that must be under `payloads:`, or one written in place, checked as an entry is. */
function referenceProblems(model: Pick<Model, 'meta'>, at: string, word: string, ref: unknown): string[] {
  if (typeof ref === 'string') return isValidReference(model, ref) ? [] : [`unknown ${word} "${ref}"`]
  return entryProblems(at, ref, true)
}

/** Whether an id names an entry at all (a malformed one is reported on the entry itself, not again on each line and step that names it). */
const isValidReference = (model: Pick<Model, 'meta'>, ref: string): boolean => isMap(model.meta.payloads) && Object.hasOwn(model.meta.payloads, ref)

/** What is wrong with a connection's `payloads:`, without the "connection a → b: " the checks put before it. */
export function connectionPayloadProblems(model: Pick<Model, 'meta'>, c: Connection): string[] {
  const list = c.payloads
  if (list === undefined) return []
  if (!Array.isArray(list)) return ['payloads must be a list of payload ids or payloads']
  const out = list.flatMap((ref, i) => referenceProblems(model, `payload ${i + 1}`, 'payload', ref))
  if (list.length > PAYLOAD_MAX.perLine) out.push(`${list.length} payloads, at most ${PAYLOAD_MAX.perLine}`)
  return out
}

/** What is wrong with a step's `payload:` and `reply:`, without the "step N: " the checks put before it. */
export function stepPayloadProblems(model: Pick<Model, 'meta'>, s: Step): string[] {
  const out: string[] = []
  const kind = animationOf(s)?.kind
  if (s.payload !== undefined) {
    out.push(...referenceProblems(model, 'payload', 'payload', s.payload))
    if (s.to === undefined && kind !== 'recurse') out.push('a payload needs a "to": nothing is sent')
  }
  if (s.reply !== undefined) {
    out.push(...referenceProblems(model, 'reply', 'reply', s.reply))
    if (!REPLY_KINDS.some(k => k === kind)) out.push('a reply needs a call, a callback or a recurse animation')
  }
  return out
}

/** A shape or an example as text to put in a file: the language as its id (one that isn't known stays, for check() to report), the code as clean lines, then any extra keys. */
function tidyBlock(v: unknown): unknown {
  if (!isMap(v)) return v
  const { language, text, ...extra } = v
  const out: Record<string, unknown> = {}
  if (typeof language === 'string' && language.trim() !== '') out.language = languageOf(language)?.id ?? language.trim()
  else if (language !== undefined && typeof language !== 'string') out.language = language
  if (text !== undefined) out.text = typeof text === 'string' ? codeLines(text).join('\n') : text
  return Object.assign(out, extra)
}

/** A blank name or about is left out, and text is trimmed; anything that isn't text stays, for check() to report. */
const tidyText = (v: unknown): unknown => (typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v)

/** A payload as text to put in a file: the keys in the order name, about, shape, example, then the extra ones; a blank name or about left out. Anything not a mapping stays as it is. */
export function tidyPayload(p: unknown): unknown {
  if (!isMap(p)) return p
  const { name, about, shape, example, ...extra } = p
  const out: Record<string, unknown> = {}
  if (tidyText(name) !== undefined) out.name = tidyText(name)
  if (tidyText(about) !== undefined) out.about = tidyText(about)
  if (shape !== undefined) out.shape = tidyBlock(shape)
  if (example !== undefined) out.example = tidyBlock(example)
  return Object.assign(out, extra)
}

/** Who names the payload `id`: each connection whose list holds it, then each flow step whose payload or reply is it. One written in place never counts, whatever its name. */
export function payloadUsers(model: Model, id: string): string[] {
  const lines = model.connections.filter(c => Array.isArray(c.payloads) && c.payloads.includes(id)).map(c => `connection ${c.from} → ${c.to}`)
  const steps = Object.entries(model.flows).flatMap(([fid, f]) => f.steps.flatMap((s, i) => (s.payload === id || s.reply === id ? [`flow ${fid} step ${i + 1}`] : [])))
  return [...lines, ...steps]
}

/**
 * One payload a drawn line carries: `back` when it runs from the line's `to` to its `from`, `own` when a connection the line draws lists it, and the flow steps that send it
 * (`step` counts from 0; `reply` when it is what comes back).
 */
export type Carried = { payload: Shown; back: boolean; own: boolean; steps: { flow: string; step: number; reply: boolean }[] }

/**
 * What the line from `from` to `to` in `view` carries: the payloads of every connection it draws (a zoomed-out line may draw several, either way), then what every flow
 * step that lands on it sends and gets back. One with an id is one row however many name it; one written in place is always a row of its own.
 */
export function lineCarries(model: Model, view: string, from: string, to: string): Carried[] {
  const line = lineKey(from, to)
  const rows: Carried[] = []
  const byId = new Map<string, Carried>()
  const add = (ref: unknown, back: boolean, own: boolean): Carried | undefined => {
    const id = typeof ref === 'string' ? ref : undefined
    const known = id === undefined ? undefined : byId.get(id)
    if (known) return known
    const payload = resolvePayload(model, ref)
    if (!payload) return undefined
    const row: Carried = { payload, back, own, steps: [] }
    rows.push(row)
    if (id !== undefined) byId.set(id, row)
    return row
  }
  for (const c of model.connections) {
    const ends = placeEnds(model, view, c.from, c.to)
    if (!ends || lineKey(...ends) !== line || !Array.isArray(c.payloads)) continue
    for (const ref of c.payloads) add(ref, ends[0] !== from, true)
  }
  for (const [flow, f] of Object.entries(model.flows)) {
    f.steps.forEach((s, step) => {
      if (s.to === undefined || typeof s.from !== 'string') return
      const ends = placeStep(model, view, s)
      if (!ends || ends[0] === ends[1] || lineKey(...ends) !== line) return
      const back = ends[0] !== from
      if (s.payload !== undefined) add(s.payload, back, false)?.steps.push({ flow, step, reply: false })
      if (s.reply !== undefined) add(s.reply, !back, false)?.steps.push({ flow, step, reply: true })
    })
  }
  return rows
}
