import { flatten, pointAt } from './pathpoints.ts'

/**
 * Where each line's label goes, so labels that would sit on top of each other (the lines of one box, which meet at it and so cross
 * the middle of the canvas close together) are read one by one. The lines and boxes stay where they are and only the labels move,
 * the way label placement is done for a fixed drawing: try a few places along the line, keep the first that is clear of the boxes and
 * of the labels placed before it, and when none is, take the least bad. A label stays at the middle of its line unless something is there.
 * No DOM in here, so the node tests can run it.
 */

type Box = { x: number; y: number; width: number; height: number }
/**
 * Where a label's middle goes. `side` is set for the label of a line among others that sits beside its line instead of on it: -1 when the label runs to the left of its line
 * and 1 when it runs to the right. The sample of the line that starts the label is then at the end by the line (see SAMPLE), so a reader draws it on the left for 1 and on the right for -1.
 * `hidden` is set where a line of a pair has no place clear of the boxes and the other labels: its label is not drawn, unless the line is pointed at.
 */
export type Spot = { x: number; y: number; side?: -1 | 1; hidden?: true }

/**
 * `path`: the line as SVG path data. `mid`: the middle of it, where its label sits unless moved. `chars`: how long its label is.
 * `pinned`: the label stays at `mid` and the others keep clear of it (a lit line's label, which a step's marks and pipe are placed by).
 * `across`: the other lines of the pair this line is one of, as the points they are made of; the label keeps off them if it can.
 * `extra`: width in pixels the label has besides its text (the sample of its line that starts the label of a line of a pair side by side).
 * `clear`: for a lit line of a pair side by side, the clear space its label keeps from the line (a step's pipe is wider than the line, see PIPE_CLEAR); 4 when left out.
 */
export type LabelItem = { id: string; path: string; mid: Spot; chars: number; pinned?: boolean; across?: readonly (readonly Spot[])[]; extra?: number; clear?: number }

/** The clear space between a lit line and its label where a step's pipe runs along the line: the pipe's half thickness and a little air (see labelOffset in motion.ts). */
export const PIPE_CLEAR = 21

/** The width of the sample of a line (its pattern and marks) that starts the label of a line of a pair side by side, with the space after it. */
export const SAMPLE = 34

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

const sizeOf = (chars: number, extra = 0) => ({ width: chars * CHAR + PAD + extra, height: HEIGHT })

/** How much of `a` lies within `b`, with `gapX` added to each side of `b` and `gapY` above and below it. */
function overlap(a: Box, b: Box, gapX = 0, gapY = 0): number {
  const w = Math.min(a.x + a.width, b.x + b.width + gapX) - Math.max(a.x, b.x - gapX)
  const h = Math.min(a.y + a.height, b.y + b.height + gapY) - Math.max(a.y, b.y - gapY)
  return w > 0 && h > 0 ? w * h : 0
}

/** A label of `chars` characters centred on `at`. */
const around = (at: Spot, chars: number, extra = 0): Box => {
  const { width, height } = sizeOf(chars, extra)
  return { x: at.x - width / 2, y: at.y - height / 2, width, height }
}

/** Dearer to move further from the middle, and far dearer to cover a box: a label over a box is hidden by it or hides it. */
const ON_BOX = 1e6
const PER_STEP = 10
const PER_STACK = 50
/** The cost of a label over the line of another of its pair: dear, but a pair of lines side by side leaves a label no place clear of the others' lines, and then the middle is the best of them. */
const ON_LANE = 200
/** The cost of a label over the lit line of its pair, which a step plays along: far dearer than over another line, for a lit line is the one to see. */
const ON_LIT = 1e4
/**
 * The labels of the lines of a pair side by side are wider than the lines are apart, so where the pair runs up and down they cannot all sit on their lines: each sits beside its own line
 * instead, running away from the others, one row below the next (a row is a label's height and APART). The cost of a place beside the line, and of each row from the middle.
 */
const BESIDE = 20
const PER_ROW = 5
/** How many rows beside the lines are tried each way from the middle, and the rows in the order tried. */
const ROWS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8]
/** The clear space between a label beside a line and the line, and between a lit line and its label by default. */
export const NEXT_TO = 4
/** How far from each end of its line a label beside it stays, so it is clear of the heads and of the shape. */
const HEAD_ROOM = 6

/** Whether the line through `points` passes through `box` (the ends of its segments count). */
function touches(box: Box, points: readonly Spot[]): boolean {
  const [x0, y0, x1, y1] = [box.x, box.y, box.x + box.width, box.y + box.height]
  for (let i = 0; i + 1 < points.length; i++) {
    // Liang-Barsky: the part of the segment, as a fraction of it, that lies inside each of the box's four sides; the segment touches the box when some part lies inside all four.
    const [p, q] = [points[i], points[i + 1]]
    const dx = q.x - p.x
    const dy = q.y - p.y
    let [low, high] = [0, 1]
    let inside = true
    for (const [step, room] of [[-dx, p.x - x0], [dx, x1 - p.x], [-dy, p.y - y0], [dy, y1 - p.y]]) {
      if (step === 0) {
        if (room < 0) inside = false
      } else if (step < 0) low = Math.max(low, room / step)
      else high = Math.min(high, room / step)
    }
    if (inside && low <= high) return true
  }
  return false
}

/** How far from its line a label of a line among others may be and still be read as its own: a label further off is by some other line. */
const STRAY = 8

/** Whether `box` is within STRAY of the line through `points`, which is walked in steps of about 2 pixels. */
function near(box: Box, points: readonly Spot[]): boolean {
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]]
    const steps = Math.max(1, Math.ceil(Math.sqrt((q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y)) / 2))
    for (let k = 0; k <= steps; k++) {
      const [x, y] = [p.x + ((q.x - p.x) * k) / steps, p.y + ((q.y - p.y) * k) / steps]
      const [dx, dy] = [Math.max(box.x - x, 0, x - (box.x + box.width)), Math.max(box.y - y, 0, y - (box.y + box.height))]
      if (dx * dx + dy * dy <= STRAY * STRAY) return true
    }
  }
  return false
}

/** The points a line's path is made of. */
function pointsOf(path: string): Spot[] {
  const line = flatten(path)
  return line.xs.map((x, i) => ({ x, y: line.ys[i] }))
}

/** Where the line through `points` is at height `y`: the crossing nearest `x`, or none where the line does not reach that height. */
function crossing(points: readonly Spot[], y: number, x: number): Spot | undefined {
  let best: Spot | undefined
  for (let i = 0; i + 1 < points.length; i++) {
    const [p, q] = [points[i], points[i + 1]]
    if ((p.y - y) * (q.y - y) > 0 || p.y === q.y) continue
    const at = { x: p.x + ((q.x - p.x) * (y - p.y)) / (q.y - p.y), y }
    if (best === undefined || Math.abs(at.x - x) < Math.abs(best.x - x)) best = at
  }
  return best
}

/**
 * Where a label of a row centred at height `y` stands, beside the line through `points` on the given side: level with the line, and as far out as the line reaches over the label's height, so a line that slants does not run through the label.
 * None where the line does not reach that height.
 */
function abreast(points: readonly Spot[], y: number, x: number, side: -1 | 1): Spot | undefined {
  const middle = crossing(points, y, x)
  if (middle === undefined) return undefined
  const xs = [crossing(points, y - HEIGHT / 2, x), middle, crossing(points, y + HEIGHT / 2, x)].flatMap(p => (p === undefined ? [] : [p.x]))
  return { x: side < 0 ? Math.min(...xs) : Math.max(...xs), y }
}

/** A label of `width` beside a line's middle `mid`, on the given side of it and `gap` clear of it, `dy` lower. */
const next = (mid: Spot, width: number, side: -1 | 1, gap: number, dy = 0): Spot => ({ x: mid.x + side * (width / 2 + gap), y: mid.y + dy, side })

/** The side of its line the label of a line among others runs to: away from the others, so it covers as few of their lines as it can. Level with them (the middle one of an odd number), to the right. */
function outward(item: LabelItem): -1 | 1 {
  const others = item.across ?? []
  if (others.length === 0) return 1
  const middles = others.map(points => (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2)
  const level = middles.reduce((sum, x) => sum + x, 0) / middles.length
  return item.mid.x - level < -0.5 ? -1 : 1
}

/**
 * The place for the label of a lit line among others: beside the line, never on it (the step's dot runs along it, and so does a pipe). Right of it, left of it, above it or below it, whichever
 * covers the fewest of the other lines and the boxes and the labels placed, the first of them when equal. A line that runs up and down has its label to one side, and one that runs across has it above or below.
 */
function besideLit(item: LabelItem, placed: readonly Box[], boxes: readonly Box[]): Spot {
  const { width } = sizeOf(item.chars, item.extra)
  const gap = item.clear ?? NEXT_TO
  const own = pointsOf(item.path)
  const options: Spot[] = [
    next(item.mid, width, 1, gap), next(item.mid, width, -1, gap),
    { x: item.mid.x, y: item.mid.y - gap - HEIGHT / 2 }, { x: item.mid.x, y: item.mid.y + gap + HEIGHT / 2 },
  ]
  let best = options[0]
  let bestCost = Infinity
  options.forEach((at, i) => {
    const label = around(at, item.chars, item.extra)
    const cost = i
      + (touches(label, own) ? 10 * ON_LANE : 0)
      + boxes.reduce((sum, b) => sum + (overlap(label, b) > 0 ? ON_BOX : 0), 0)
      + placed.reduce((sum, p) => sum + overlap(label, p, ROW_GAP, APART), 0)
      + (item.across ?? []).reduce((sum, other) => sum + (touches(label, other) ? ON_LANE : 0), 0)
    if (cost < bestCost) {
      best = at
      bestCost = cost
    }
  })
  return best
}

/**
 * The spot for each label, by line id. Pinned ones stay put. The rest go longest first (the hardest to fit), each at the first
 * place along its line, nearest the middle, that clears everything placed so far, or else wherever it overlaps least.
 */
export function placeLabels(items: LabelItem[], boxes: Box[]): Map<string, Spot> {
  const spots = new Map<string, Spot>()
  const placed: Box[] = []
  for (const item of items) {
    if (!item.pinned) continue
    const spot = item.across === undefined ? item.mid : besideLit(item, placed, boxes)
    spots.set(item.id, spot)
    placed.push(around(spot, item.chars, item.extra))
  }
  const movable = items.filter(i => !i.pinned).sort((a, b) => b.chars - a.chars)
  // The lit lines of the pairs side by side: the label of another line of a pair keeps off them, and has no place at all where that is the only way.
  const lit = items.filter(i => i.pinned && i.across !== undefined).map(i => pointsOf(i.path))
  const onLit = (label: Box, item: LabelItem) => (item.across === undefined ? [] : lit.filter(l => touches(label, l)))
  for (const item of movable) {
    const line = flatten(item.path)
    const points = pointsOf(item.path)
    const candidates: { at: Spot; cost: number }[] = []
    ALONG.forEach(s => {
      const [x, y] = s === 0.5 ? [item.mid.x, item.mid.y] : pointAt(line, s)
      candidates.push({ at: { x, y }, cost: Math.abs(s - 0.5) * PER_STEP })
    })
    // A label of a line with others beside it slides along its own line and no further: stacked above or below, it would sit on another line's place. It may sit beside its line, row by row.
    if (item.across === undefined) for (const k of STACKED) candidates.push({ at: { x: item.mid.x, y: item.mid.y + k * (HEIGHT + APART) }, cost: Math.abs(k) * PER_STACK })
    else {
      // Beside the line only where the line runs up and down enough for a label to sit by it: a label on a line that runs across would still be on it.
      const side = outward(item)
      const { width } = sizeOf(item.chars, item.extra)
      for (const k of ROWS) {
        // Each row is by the line where the line is level with it (a line that slants has its rows shifted along it).
        const level = k === 0 ? item.mid : abreast(points, item.mid.y + k * (HEIGHT + APART), item.mid.x, side)
        if (level === undefined) continue
        const at = next(level, width, side, NEXT_TO)
        const label = around(at, item.chars, item.extra)
        // Level with the line and clear of the heads at its ends, or at the middle where the line is too short for rows.
        const inRange = k === 0 || (label.y >= Math.min(...points.map(p => p.y)) + HEAD_ROOM && label.y + label.height <= Math.max(...points.map(p => p.y)) - HEAD_ROOM)
        if (inRange && !touches(label, points)) candidates.push({ at, cost: BESIDE + Math.abs(k) * PER_ROW })
      }
    }
    let best = candidates[0]
    let bestCost = Infinity
    for (const c of candidates) {
      const label = around(c.at, item.chars, item.extra)
      const cost = c.cost
        + boxes.reduce((sum, b) => sum + (overlap(label, b) > 0 ? ON_BOX : 0), 0)
        + placed.reduce((sum, p) => sum + overlap(label, p, ROW_GAP, APART), 0)
        + (item.across ?? []).reduce((sum, other) => sum + (touches(label, other) ? ON_LANE : 0), 0)
        + onLit(label, item).length * ON_LIT
      if (cost < bestCost) {
        best = c
        bestCost = cost
      }
      if (cost === c.cost) break // clear: the first such place is the one nearest the middle
    }
    // A line of a pair side by side whose label finds no place clear of the boxes, of the labels placed and of the lit line of its pair, or none near its own line, has no label drawn: the lines of a crowded pair are in its panel, and one pointed at shows its own.
    const label = around(best.at, item.chars, item.extra)
    if (item.across !== undefined && (boxes.some(b => overlap(label, b) > 0) || placed.some(p => overlap(label, p, ROW_GAP, APART) > 0) || onLit(label, item).length > 0 || !near(label, points))) {
      spots.set(item.id, { ...best.at, hidden: true })
      continue
    }
    spots.set(item.id, best.at)
    placed.push(label)
  }
  return spots
}
