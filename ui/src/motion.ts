/** Maths for drawing a step's beats (src/core/animation.ts). No DOM in here, so the node tests can run it. */
import type { Animation, AnimationKind, Beat } from '../../src/core/animation.ts'
import type { Rect } from './graph.ts'

/** The kinds the canvas draws. A step tagged with any other kind plays like a step with no tag. */
export const DRAWN_KINDS: readonly AnimationKind[] = ['send', 'call', 'callback', 'event']

/** The animation to play: `a` when the canvas draws its kind, otherwise nothing. */
export const drawable = (a: Animation | undefined): Animation | undefined => (a !== undefined && DRAWN_KINDS.includes(a.kind) ? a : undefined)

/** How long Autoplay rests after a step has finished moving, in ms. */
export const GAP = 900
/** How long Autoplay stays on a step that doesn't move, or when motion is reduced, in ms. */
export const DWELL = 2200

type Span = { at: number; dur: number }

/** How far through a beat the moment `t` is: 0 before it, 1 after it. */
export const progress = (b: Span, t: number): number => Math.min(1, Math.max(0, (t - b.at) / b.dur))

/** Whether the beat is running at `t`. */
export const active = (b: Span, t: number): boolean => t >= b.at && t < b.at + b.dur

/** Slow at both ends, fast in the middle: a blob eases into the pipe and out of it. */
export const ease = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

/** 0 at the ends of a beat and 1 in the middle: a squash, or a blob stretched at full speed. */
export const bump = (p: number): number => Math.sin(Math.PI * p)

/** The tube fades in over the first 150 ms of its beat and out over the last 250. */
export const tubeOpacity = (b: Span, t: number): number => Math.min(1, Math.max(0, Math.min((t - b.at) / 150, (b.at + b.dur - t) / 250)))

/** How far along a line of length `len` a blob is at progress `p`, running forward or back. */
export const distance = (dir: 'fwd' | 'back' | undefined, p: number, len: number): number => (dir === 'back' ? 1 - ease(p) : ease(p)) * len

/**
 * The dash settings that draw one stretch of a path of length `len`: `window` long and centred on `pos`.
 * The gap is longer than the path, so the pattern never repeats on it.
 */
export const dashAround = (pos: number, len: number, window: number): { array: string; offset: number } => ({
  array: `${window} ${len * 2 + window}`,
  offset: -(pos - window / 2),
})

/**
 * How many ghost cards show at `t`, as a fraction while one slides in or out. Each `stack` beat that has started takes the count
 * from the level before it to its own over its `dur`; a beat that has not started yet changes nothing.
 */
export function cardsAt(beats: readonly Beat[], t: number): number {
  let before = 0
  let cards = 0
  for (const b of beats) {
    if (b.do !== 'stack') continue
    if (t < b.at) break
    cards = before + ((b.level ?? 0) - before) * ease(progress(b, t))
    before = b.level ?? 0
  }
  return cards
}

/** The rect of ghost card `k` (1 is the nearest): 8 px lower and 7 px narrower on each side for every level down, scaled by how far it has slid in, 0 to 1. */
export const cardBox = (r: Rect, k: number, amount: number): Rect => ({ x: r.x + 7 * k * amount, y: r.y + 8 * k * amount, width: r.width - 14 * k * amount, height: r.height })

/** The counter on a recursing box: the height of the stack while it plays, and how deep it went once it has finished. */
export const pillText = (playing: boolean, cards: number, depth: number): string => (playing ? `↻ ${Math.round(cards) + 1}` : `↻ ${depth} deep`)

/** The squash for the `from` and `to` tiles. With one box at both ends the larger goes on it, so the empty second side never wipes the first. */
export const tileSquash = (sameBox: boolean, squash: { from: number; to: number }): { from: number; to: number } =>
  sameBox ? { from: Math.max(squash.from, squash.to), to: 0 } : squash
