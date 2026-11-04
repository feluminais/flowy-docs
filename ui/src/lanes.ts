import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react'
import type { LineStyle } from '../../src/core/model.ts'
import type { Point } from '../../src/core/heads.ts'
import { laneGeometry, REST, SPREAD } from '../../src/core/lanes.ts'
import type { LaneBox, Pose, Slot } from '../../src/core/lanes.ts'
import { lineEnds, lineId, ports } from './graph.ts'
import type { Outline, Rect } from './graph.ts'

export { REST, SPREAD }
export type { Pose, Slot }

/**
 * The lane store: the one place in the browser that makes the path of a line between two shapes. The line itself, the label that sits on it, the pipe a step runs along, the
 * stream of an open channel, the traffic and the mark of a group all ask it, so they cannot disagree about where a line is. The desktop reader has the same thing in one place
 * (`LaneStore.PathFor`, a twin to this one).
 *
 * A lane is asked for by its strand id (the id of the line the reader draws: an edge's id until a project draws a line for each connection, see View.strands in core), the style of
 * lines, the shapes at its two ends and a pose (what the lane is doing: at rest, or spread, or parted around a lit lane). The answer is the SVG path from the first shape to the
 * second and the middle of the line, where its label sits. Both stay the same object while the shapes stay where they are, so a reader that asks on every draw gets the same
 * lane back and has nothing new to work out.
 *
 * A line that is one of several of a pair (it has a `slot`, see View.strands and src/core/lanes.ts) is a straight lane beside the others, in every line style; a line that is
 * alone between its two shapes is drawn as it always was. A pose says how far the lanes of its pair are spread; the lanes of a pair parted around a lit lane are the same question
 * with the lit lane in the pose. A lone line has nothing to spread, so every pose gives its rest path.
 */

/**
 * A lane: the SVG path data from the first shape to the second, and the middle of it, where the label sits. A lane of a pair of several lines also has the points the path is made of,
 * for the pointer to be asked which lane it is on.
 */
export type Lane = { readonly path: string; readonly x: number; readonly y: number; readonly points?: readonly Point[] }

/** A shape at one end of a lane: its id, where it is, and the outline the lane meets. */
export type LaneEnd = LaneBox

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

/** The SVG path and the label's place for one line in the given style, from the first shape to the second. */
function draw(style: LineStyle, a: Rect, b: Rect, edgeA: Outline, edgeB: Outline): Lane {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b, edgeA, edgeB)
    const [path, x, y] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    return { path, x, y }
  }
  const p = ports(a, b, edgeA, edgeB)
  const ends = {
    sourceX: p.from.x, sourceY: p.from.y, sourcePosition: SIDES[p.fromSide],
    targetX: p.to.x, targetY: p.to.y, targetPosition: SIDES[p.toSide],
  }
  const [path, x, y] = style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  return { path, x, y }
}

/** How a pose is told from another in the store's keys. */
const poseKey = (pose: Pose): string => (pose === REST || (pose.s === 0 && pose.lam.every(l => l === 0)) ? '' : `${pose.s}:${pose.lam.join(',')}`)

/** How a slot is told from another in the store's keys. A lone line has none. */
const slotKey = (slot: Slot | undefined): string => (slot === undefined || slot.lanes < 2 ? '' : `${slot.lane}/${slot.lanes}/${slot.back}`)

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height

/** What a lane was worked out from: the lane stays good for as long as all of this is the same. */
type Held = { a: Rect; b: Rect; edgeA: Outline; edgeB: Outline; lane: Lane }

/** More lanes than this in one store and it starts again, so a canvas that is made again with new ids many times over does not keep every line it ever drew. */
const MOST = 20000

export type LaneStore = {
  /**
   * The lane for `strand` (undefined where the caller has no strand id: the pair's own id, which is also the id of the line the reader draws for the pair) in `style`, in `pose`. A line that runs
   * the other way between the same two shapes is another lane: its path starts at the other shape. With a `slot` of a pair of two lines or more the lane is the straight lane it is among them.
   */
  laneFor(strand: string | undefined, style: LineStyle, from: LaneEnd, to: LaneEnd, pose?: Pose, slot?: Slot): Lane
}

export function createLaneStore(): LaneStore {
  let held = new Map<string, Held>()
  return {
    laneFor(strand, style, from, to, pose = REST, slot) {
      const key = `${strand ?? lineId(from.id, to.id)}\u0001${from.id}\u0001${to.id}\u0001${style}\u0001${poseKey(pose)}\u0001${slotKey(slot)}`
      const found = held.get(key)
      if (found && sameRect(found.a, from.rect) && sameRect(found.b, to.rect) && found.edgeA === from.edge && found.edgeB === to.edge) return found.lane
      if (held.size >= MOST) held = new Map()
      const lane = slot !== undefined && slot.lanes > 1 ? laneGeometry(from, to, slot, pose) : draw(style, from.rect, to.rect, from.edge, to.edge)
      // The rects are copied: a caller may go on moving the object it passed.
      held.set(key, { a: { ...from.rect }, b: { ...to.rect }, edgeA: from.edge, edgeB: to.edge, lane })
      return lane
    },
  }
}

/** The store every reader draws from. */
export const lanes: LaneStore = createLaneStore()
