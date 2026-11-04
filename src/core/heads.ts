/**
 * The arrowhead of a line. Both readers draw it themselves, from this one shape, so it is the same size in the browser and on the desktop and takes
 * the line's colour in every state (picked, pointed at, lit, a problem, faded). The shape is drawn in a frame of its own: tip at the origin,
 * pointing along +x, body towards -x. A reader puts it on a line with the matrix from `headMatrix`.
 */

export interface Point {
  x: number
  y: number
}

/** The head's path at scale 1: a closed triangle 10 long and 9 wide, filled and not stroked. */
export const HEAD_PATH = 'M0 0L-10 -4.5L-10 4.5Z'

/** How far back from the tip the head's body reaches. */
export const HEAD_LENGTH = 10

/** Half the head's width, at its back. */
export const HEAD_HALF_WIDTH = 4.5

/** Lines up to this thick (a quiet line is 1.5, a picked one 2, a lit one 2.5) wear the head at scale 1. */
const BASE_WIDTH = 2.5

/**
 * How much bigger the head is drawn on a line `width` thick: 1 up to 2.5, then growing with the square root of the width, so a line thickened by traffic
 * (up to 6) wears a head about half as big again, not one three times as wide. Rounded to 3 decimals.
 */
export const headScale = (width: number): number => Math.round(Math.sqrt(Math.max(1, width / BASE_WIDTH)) * 1000) / 1000

/** An SVG matrix `[a, b, c, d, e, f]`: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = [number, number, number, number, number, number]

/**
 * The matrix that puts a head, drawn in its own frame, with its tip at `end` and pointing along `dir` (a unit vector out of the line). For the
 * head at the start of a line, `end` is the line's start and `dir` points back out of the line. No trigonometry: a rotation is its own cosine and sine.
 */
export const headMatrix = (end: Point, dir: Point, scale = 1): Matrix => [dir.x * scale, dir.y * scale, -dir.y * scale, dir.x * scale, end.x, end.y]

/** Where a line starts and ends, and the unit direction out of the line at each end (where its heads point). */
export interface PathEnds {
  start: Point
  startDir: Point
  end: Point
  endDir: Point
}

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y

/** The unit vector from `a` towards `b`; (0, 1) when they are the same point. */
function unit(a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.sqrt(dx * dx + dy * dy)
  return length === 0 ? { x: 0, y: 1 } : { x: dx / length, y: dy / length }
}

const NUMBER = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/.source

/** A number (with an exponent, as JavaScript prints very small or very large ones) or a lone letter, which is a command. The number is tried first, so its `e` is never a command. */
const TOKEN = new RegExp(`(${NUMBER})|([A-Za-z])`, 'gi')

/** How many numbers each command takes. Lines are made of these four: straight, curved and right-angled ones. */
const TAKES: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4 }

/**
 * Where a line drawn as an SVG path (absolute `M`, `L`, `C` and `Q` only, as the canvas draws lines) starts and ends, and which way it points
 * there: the tangent, from the control point next to the end (or the point before it, when the control point is the end itself). Undefined for
 * a path that is not made of those.
 */
export function endsOfPath(d: string): PathEnds | undefined {
  const parts: { cmd: string; numbers: number[] }[] = []
  for (const m of d.matchAll(TOKEN)) {
    if (m[2] !== undefined) parts.push({ cmd: m[2], numbers: [] })
    else if (parts.length > 0) parts[parts.length - 1].numbers.push(Number(m[1]))
    else return undefined
  }
  const segments: { cmd: string; at: Point[] }[] = []
  for (const { cmd, numbers } of parts) {
    if (!(cmd in TAKES) || numbers.length !== TAKES[cmd]) return undefined
    const at: Point[] = []
    for (let i = 0; i < numbers.length; i += 2) at.push({ x: numbers[i], y: numbers[i + 1] })
    segments.push({ cmd, at })
  }
  if (segments.length < 2 || segments[0].cmd !== 'M') return undefined
  const start = segments[0].at[0]
  const first = segments[1]
  const last = segments[segments.length - 1]
  const end = last.at[last.at.length - 1]
  const before = segments[segments.length - 2].at.at(-1)!
  // A curve whose control point sits on its own end has no tangent there: it is the chord that points.
  const towardsStart = first.at[0]
  const towardsEnd = last.at.length > 1 ? last.at[last.at.length - 2] : before
  return {
    start,
    startDir: unit(first.cmd === 'C' && same(towardsStart, start) ? first.at[2] : towardsStart, start),
    end,
    endDir: unit(same(towardsEnd, end) && last.at.length > 1 ? before : towardsEnd, end),
  }
}
