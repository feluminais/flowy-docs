import { HEAD_PATH } from './heads.ts'

/**
 * What a connection is, drawn as a line. A connection says `kind:` with one of six words and the line takes a pattern and a mark at each end to match.
 * A kind is shape only: the colour of a line says its state and its width says traffic, so a kind never changes either. The six are fixed.
 *
 * - The pattern says how the connection is set up. Solid: a message sent when someone asks or calls. Dash-dot: something plugs into a host.
 * - The head, at the receiving end (`to`), is a filled triangle when the sender waits and an open chevron when the message just arrives.
 * - The tail, at the sending end (`from`): a chevron when an answer comes back, two when answers keep coming, a ring when the sender keeps the last
 *   value, a diamond when the sender holds an object.
 *
 * A connection with no kind (or a word that is none of the six) is the plain line: solid, a filled head, no tail.
 */
export const KIND_IDS = ['request', 'stream', 'publish', 'cached', 'object', 'extension'] as const
export type KindId = (typeof KIND_IDS)[number]

/** How a line is dashed: a plain line, or the dash-dot of an extension point. */
export type Pattern = 'solid' | 'dashdot'
/** The mark at the receiving end: a filled triangle (the sender waits) or an open chevron (the message just arrives). */
export type HeadShape = 'filled' | 'open'
/** The mark at the sending end, or none. */
export type TailShape = 'none' | 'open' | 'double' | 'ring' | 'diamond'
/** Every mark there is. A head is `filled` or `open`; a tail is `open`, `double`, `ring` or `diamond`. */
export type MarkShape = Exclude<HeadShape | TailShape, 'none'>

/** What a line looks like: its pattern and the marks at its two ends. */
export type LineLook = { pattern: Pattern; head: HeadShape; tail: TailShape }

/** The look of a connection with no kind: today's line. */
export const PLAIN_LOOK: LineLook = { pattern: 'solid', head: 'filled', tail: 'none' }

/** What the plain line is called in a key. */
export const PLAIN_NAME = 'Plain line'

/** The six kinds in the order a key and a picker list them: the name a person reads, and the look. */
export const KINDS: Record<KindId, { name: string; look: LineLook }> = {
  request: { name: 'Request and reply', look: { pattern: 'solid', head: 'filled', tail: 'open' } },
  stream: { name: 'Request then stream', look: { pattern: 'solid', head: 'filled', tail: 'double' } },
  publish: { name: 'Publish and subscribe', look: { pattern: 'solid', head: 'open', tail: 'none' } },
  cached: { name: 'Cached publish', look: { pattern: 'solid', head: 'open', tail: 'ring' } },
  object: { name: 'Object updates', look: { pattern: 'solid', head: 'open', tail: 'diamond' } },
  extension: { name: 'Extension point', look: { pattern: 'dashdot', head: 'filled', tail: 'none' } },
}

/** Whether a value read from a file is one of the six kind words, written exactly. */
export const isKindId = (v: unknown): v is KindId => typeof v === 'string' && Object.hasOwn(KINDS, v)

/** The kind a connection has, or undefined for none, a blank one, or a word that is not a kind (it draws plain). */
export const kindOf = (c: Record<string, unknown>): KindId | undefined => (isKindId(c.kind) ? c.kind : undefined)

/** The name of a kind as the UI says it. */
export const kindName = (id: KindId): string => KINDS[id].name

/** The look of a kind, or the plain look for none. */
export const lookOfKind = (id: KindId | undefined): LineLook => (id === undefined ? PLAIN_LOOK : KINDS[id].look)

/** The look a connection draws on its own. */
export const lookOf = (c: Record<string, unknown>): LineLook => lookOfKind(kindOf(c))

export const sameLook = (a: LineLook, b: LineLook): boolean => a.pattern === b.pattern && a.head === b.head && a.tail === b.tail

export const isPlainLook = (look: LineLook): boolean => sameLook(look, PLAIN_LOOK)

/**
 * The look of one drawn line that stands for several connections, or undefined when it is the plain line (so a model with no kinds is unchanged).
 * `looks` has one entry for each connection; `both` is whether they run both ways.
 *
 * - All the same look, running one way: that look, tail included.
 * - All the same look, running both ways: the head at both ends and no tails, since one end's tail would sit where the other end's head is.
 * - The same pattern but different marks: the pattern stays and the head is plain.
 * - Otherwise: the plain line. The line's panel shows each connection with its own look, so a mixed line loses nothing on selection.
 */
export function mergedLook(looks: readonly LineLook[], both: boolean): LineLook | undefined {
  if (looks.length === 0) return undefined
  const first = looks[0]
  let merged: LineLook
  if (looks.every(l => sameLook(l, first))) merged = both ? { ...first, tail: 'none' } : first
  else if (looks.every(l => l.pattern === first.pattern)) merged = { pattern: first.pattern, head: PLAIN_LOOK.head, tail: 'none' }
  else return undefined
  return isPlainLook(merged) ? undefined : { ...merged }
}

/** The kind that all of these connections share, or undefined when one has none, one has a word that is no kind, or they differ. */
export function sharedKind(connections: readonly Record<string, unknown>[]): KindId | undefined {
  const first = connections.length === 0 ? undefined : kindOf(connections[0])
  return first !== undefined && connections.every(c => kindOf(c) === first) ? first : undefined
}

/** How each pattern is dashed on a line, in px as SVG's `stroke-dasharray` takes it (the desktop divides by the pen's thickness). Butt caps. */
export const DASHES: Record<Pattern, readonly number[]> = { solid: [], dashdot: [11, 3, 2, 3] }

/** How a mark is painted: filled in the line's colour, only stroked, or hollow (filled with the background and stroked, so the line does not show through). */
export type MarkPaint = 'fill' | 'stroke' | 'hollow'

/** A ring: four cubics (not arcs, so the reader that flattens paths made of M, L, C and Q still works), radius 3.5, its edge on the line's end. */
const RING = 'M0 0C0 1.933 -1.567 3.5 -3.5 3.5C-5.433 3.5 -7 1.933 -7 0C-7 -1.933 -5.433 -3.5 -3.5 -3.5C-1.567 -3.5 0 -1.933 0 0Z'

/**
 * The marks, each in a frame of its own like the head in heads.ts: tip at the origin, pointing along +x, body towards -x. `width` is the stroke width
 * at scale 1 (0 for a filled mark, which has no stroke). Every mark fits a 10 px band across the line.
 */
export const MARKS: Record<MarkShape, { path: string; paint: MarkPaint; width: number }> = {
  filled: { path: HEAD_PATH, paint: 'fill', width: 0 },
  open: { path: 'M-9.5 -4L-1.5 0L-9.5 4', paint: 'stroke', width: 1.75 },
  double: { path: 'M-9.5 -4L-1.5 0L-9.5 4M-15.5 -4L-7.5 0L-15.5 4', paint: 'stroke', width: 1.75 },
  ring: { path: RING, paint: 'hollow', width: 1.5 },
  diamond: { path: 'M0 0L-6 -3.5L-12 0L-6 3.5Z', paint: 'hollow', width: 1.5 },
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000

/** A mark's path with every coordinate multiplied by `scale` and rounded to 3 decimals. Marks are drawn in absolute M, L, C and Z, so every number is a coordinate. */
export function markPath(shape: MarkShape, scale = 1): string {
  return MARKS[shape].path.replace(/-?\d*\.?\d+/g, n => String(round3(Number(n) * scale)))
}

/** A mark's stroke width at `scale` (heads.ts headScale gives the scale for a line's width), rounded to 3 decimals (0 for a filled mark). */
export const markStroke = (shape: MarkShape, scale = 1): number => round3(MARKS[shape].width * scale)

/** The six kind words as a check message lists them. */
export const KIND_LIST = KIND_IDS.join(', ')
