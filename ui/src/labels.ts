import { flatten, pointAt } from './pathpoints.ts'

/**
 * Where each line's label goes, so labels that would sit on top of each other (the lines of one box, which meet at it and so cross
 * the middle of the canvas close together) are read one by one. The lines and boxes stay where they are and only the labels move,
 * the way label placement is done for a fixed drawing: try a few places along the line, keep the first that is clear of the boxes and
 * of the labels placed before it, and when none is, take the least bad. A label stays at the middle of its line unless something is there.
 * No DOM in here, so the node tests can run it.
 */

type Box = { x: number; y: number; width: number; height: number }
export type Spot = { x: number; y: number }

/**
 * `path`: the line as SVG path data. `mid`: the middle of it, where its label sits unless moved. `chars`: how long its label is.
 * `pinned`: the label stays at `mid` and the others keep clear of it (a lit line's label, which a step's marks and pipe are placed by).
 */
export type LabelItem = { id: string; path: string; mid: Spot; chars: number; pinned?: boolean }

/** How wide one character of a label is and the padding round the text, and how tall it is, as drawn at the 10px of React Flow's edge text, bold lit lines included. */
const CHAR = 6.2
const PAD = 10
const HEIGHT = 18
/** The clear space kept between two labels, one above the other. */
const APART = 3
/**
 * The clear space kept between two labels side by side, about four characters with the padding: closer, two labels on one row read as one
 * sentence ("reads menus 5 connections").
 */
const ROW_GAP = 16

/** How far along a line to try a label, in the order tried: the middle first, then each side of it, so a label moves no further than it must. */
const ALONG = [0.5, 0.62, 0.38, 0.74, 0.26, 0.85, 0.15]
/** Last resort when no place along the line is clear: stacked above or below the middle, in label heights. */
const STACKED = [1, -1, 2, -2]

/**
 * The longest label drawn on a line, in characters. A longer one is cut short with an ellipsis: it is wider than the gap between the lines
 * of one box, so there is no place for it that covers nothing. The whole label is in the line's panel.
 */
export const MAX_LABEL = 42
export const clip = (label: string): string => (label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1).trimEnd()}…` : label)

const sizeOf = (chars: number) => ({ width: chars * CHAR + PAD, height: HEIGHT })

/** How much of `a` lies within `b`, with `gapX` added to each side of `b` and `gapY` above and below it. */
function overlap(a: Box, b: Box, gapX = 0, gapY = 0): number {
  const w = Math.min(a.x + a.width, b.x + b.width + gapX) - Math.max(a.x, b.x - gapX)
  const h = Math.min(a.y + a.height, b.y + b.height + gapY) - Math.max(a.y, b.y - gapY)
  return w > 0 && h > 0 ? w * h : 0
}

/** A label of `chars` characters centred on `at`. */
const around = (at: Spot, chars: number): Box => {
  const { width, height } = sizeOf(chars)
  return { x: at.x - width / 2, y: at.y - height / 2, width, height }
}

/** Dearer to move further from the middle, and far dearer to cover a box: a label over a box is hidden by it or hides it. */
const ON_BOX = 1e6
const PER_STEP = 10
const PER_STACK = 50

/**
 * The spot for each label, by line id. Pinned ones stay put. The rest go longest first (the hardest to fit), each at the first
 * place along its line, nearest the middle, that clears everything placed so far, or else wherever it overlaps least.
 */
export function placeLabels(items: LabelItem[], boxes: Box[]): Map<string, Spot> {
  const spots = new Map<string, Spot>()
  const placed: Box[] = []
  for (const item of items) {
    if (!item.pinned) continue
    spots.set(item.id, item.mid)
    placed.push(around(item.mid, item.chars))
  }
  const movable = items.filter(i => !i.pinned).sort((a, b) => b.chars - a.chars)
  for (const item of movable) {
    const line = flatten(item.path)
    const candidates: { at: Spot; cost: number }[] = []
    ALONG.forEach(s => {
      const [x, y] = s === 0.5 ? [item.mid.x, item.mid.y] : pointAt(line, s)
      candidates.push({ at: { x, y }, cost: Math.abs(s - 0.5) * PER_STEP })
    })
    for (const k of STACKED) candidates.push({ at: { x: item.mid.x, y: item.mid.y + k * (HEIGHT + APART) }, cost: Math.abs(k) * PER_STACK })
    let best = candidates[0]
    let bestCost = Infinity
    for (const c of candidates) {
      const label = around(c.at, item.chars)
      const cost = c.cost
        + boxes.reduce((sum, b) => sum + (overlap(label, b) > 0 ? ON_BOX : 0), 0)
        + placed.reduce((sum, p) => sum + overlap(label, p, ROW_GAP, APART), 0)
      if (cost < bestCost) {
        best = c
        bestCost = cost
      }
      if (cost === c.cost) break // clear: the first such place is the one nearest the middle
    }
    spots.set(item.id, best.at)
    placed.push(around(best.at, item.chars))
  }
  return spots
}
