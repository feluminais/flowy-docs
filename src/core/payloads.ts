import type { Connection, Model, Step } from './model.ts'
import { isBlankCode } from './snippets.ts'
import { hasText, isMap } from './text.ts'

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
