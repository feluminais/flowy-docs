import { createContext, memo, useContext, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, Position, useInternalNode } from '@xyflow/react'
import type { Edge, EdgeProps, InternalNode, XYPosition } from '@xyflow/react'
import type { Mark } from '../../src/core/failures.ts'
import { SHAPE_DEFS, shapeOf } from '../../src/core/look.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { ChangeMarksContext, FailBadge } from './Box.tsx'
import { changeAt } from './compare.ts'
import { lineEnds, ports, sizeOf } from './graph.ts'
import { clip, placeLabels } from './labels.ts'
import type { Spot } from './labels.ts'
import { labelOffset } from './motion.ts'
import type { BoxData, BoxNode, Outline, Rect } from './graph.ts'

/** How lines are drawn: the project's style, or this reader's own. App provides it. */
export const LineStyleContext = createContext<LineStyle>('straight')

/** How thick each line is drawn while traffic shows (by line id), where it differs from the usual. */
export const LineWidthsContext = createContext<ReadonlyMap<string, number>>(new Map())

/** The failure modes each line carries while the Failures tab shows them (by line id): the worst band and the count. */
export const LineMarksContext = createContext<ReadonlyMap<string, Mark>>(new Map())

/**
 * The line the pointer is on (or whose row in a panel it is on), kept outside the page's state: pointing at lines is constant while the canvas is panned, and each change would draw the
 * whole page again. A line asks whether it is the one, so only the two lines that change draw again.
 */
export type HoverStore = { get: () => string | undefined; set: (id: string | undefined) => void; subscribe: (listener: () => void) => () => void }

export function createHoverStore(): HoverStore {
  let now: string | undefined
  const listeners = new Set<() => void>()
  return {
    get: () => now,
    set(id) {
      if (id === now) return
      now = id
      for (const listener of [...listeners]) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
  }
}

const LineHoverContext = createContext<HoverStore>(createHoverStore())

/** Provides the line the pointer is on to the lines inside. */
export const LineHover = LineHoverContext

/** Where each line's label goes where it isn't the middle of the line (by line id), so labels that would overlap don't. A line asks for its own, so one that moves is the only one that draws again. See LabelSpots. */
export type SpotStore = { get: (id: string) => Spot | undefined; subscribe: (listener: () => void) => () => void }

const noSpots: SpotStore = { get: () => undefined, subscribe: () => () => undefined }
const LabelSpotsContext = createContext<SpotStore>(noSpots)

function createSpotStore(first: ReadonlyMap<string, Spot>) {
  let spots = new Map(first)
  const listeners = new Set<() => void>()
  return {
    get: (id: string) => spots.get(id),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    /** Takes the new places; a label that is where it was keeps the object it had, so the line that owns it has nothing to draw. */
    set(next: ReadonlyMap<string, Spot>) {
      let changed = next.size !== spots.size
      const kept = new Map<string, Spot>()
      for (const [id, spot] of next) {
        const before = spots.get(id)
        const same = before !== undefined && before.x === spot.x && before.y === spot.y
        if (!same) changed = true
        kept.set(id, same ? before : spot)
      }
      spots = kept
      if (changed) for (const listener of [...listeners]) listener()
    },
  }
}

/** Provides where the labels go (see labelSpots) to the lines inside. */
export function LabelSpots({ spots, children }: { spots: ReadonlyMap<string, Spot>; children: ReactNode }) {
  const store = useRef<ReturnType<typeof createSpotStore>>(undefined)
  store.current ??= createSpotStore(spots)
  const current = store.current
  useLayoutEffect(() => current.set(spots), [current, spots])
  return <LabelSpotsContext value={current}>{children}</LabelSpotsContext>
}

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }

export const rect = (n: InternalNode): Rect => ({ ...n.internals.positionAbsolute, ...sizeOf(n) })
/** The outline a line meets: the shape's own, so it never ends in the air beside a diamond's corner. */
/** What a box is called, for the words a badge on a line says. */
const nameOfNode = (n: InternalNode, id: string): string => (n.data as BoxData).object.name || id

export const outline = (n: InternalNode): Outline => SHAPE_DEFS[shapeOf((n.data as BoxData).object)].edge

/** The SVG path and the label's place for one line in the given style. */
function draw(style: LineStyle, a: Rect, b: Rect, edgeA: Outline, edgeB: Outline): [string, number, number] {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b, edgeA, edgeB)
    const [path, x, y] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    return [path, x, y]
  }
  const p = ports(a, b, edgeA, edgeB)
  const ends = {
    sourceX: p.from.x, sourceY: p.from.y, sourcePosition: SIDES[p.fromSide],
    targetX: p.to.x, targetY: p.to.y, targetPosition: SIDES[p.toSide],
  }
  const [path, x, y] = style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  return [path, x, y]
}

/**
 * Where the labels on show go: each line's, in the given style, kept clear of the boxes and of one another (see placeLabels). A lit line's
 * label and the label of a line a pipe plays along stay at the middle of the line, and the others are placed round them.
 */
export function labelSpots(style: LineStyle, edges: Edge[], nodes: BoxNode[]): Map<string, Spot> {
  const at = new Map(nodes.map(n => [n.id, n]))
  const boxes = nodes.map(n => ({ ...n.position, ...sizeOf(n) }))
  const items = edges.flatMap(e => {
    const [a, b] = [at.get(e.source), at.get(e.target)]
    if (typeof e.label !== 'string' || e.label === '' || !a || !b) return []
    const edgeOf = (n: BoxNode) => SHAPE_DEFS[shapeOf(n.data.object)].edge
    const [path, x, y] = draw(style, { ...a.position, ...sizeOf(a) }, { ...b.position, ...sizeOf(b) }, edgeOf(a), edgeOf(b))
    return [{ id: e.id, path, mid: { x, y }, chars: clip(e.label).length, pinned: e.className?.includes('active') || e.data?.lift === true }]
  })
  return placeLabels(items, boxes)
}

/** The middle of the line between two boxes in the given style, where its label sits. */
export function labelPoint(style: LineStyle, a: InternalNode, b: InternalNode): XYPosition {
  const [, x, y] = draw(style, rect(a), rect(b), outline(a), outline(b))
  return { x, y }
}

/** The path of the line between two boxes in the given style, for a step's pipe to follow. */
export const pathBetween = (style: LineStyle, a: InternalNode, b: InternalNode): string => draw(style, rect(a), rect(b), outline(a), outline(b))[0]

/**
 * A line between two boxes. Straight lines go edge to edge, whichever sides face each other: the boxes
 * sit above, beside and below the members, so lines that always left at the bottom would loop around.
 * Curved and right-angled lines leave from the middle of the facing side.
 */
export const Line = memo(function Line({ id, source, target, label, markerEnd, interactionWidth, data }: EdgeProps) {
  const style = useContext(LineStyleContext)
  const width = useContext(LineWidthsContext).get(id)
  const mark = useContext(LineMarksContext).get(id)
  const hover = useContext(LineHoverContext)
  const hot = useSyncExternalStore(hover.subscribe, () => hover.get() === id)
  const spots = useContext(LabelSpotsContext)
  const spot = useSyncExternalStore(spots.subscribe, () => spots.get(id))
  const change = changeAt(useContext(ChangeMarksContext)?.lines, id)
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const [path, x, y] = draw(style, rect(a), rect(b), outline(a), outline(b))
  // A step that moves runs a blob along this line, so its label steps aside instead of sitting under the blob.
  const [ra, rb] = [rect(a), rect(b)]
  // A label shows on a line that is pointed at, as on one that is selected: the line itself says so, since pointing re-draws no page. The label it holds back is in its data.
  const shown = label ?? (hot && typeof data?.label === 'string' ? data.label : undefined)
  const text = typeof shown === 'string' ? clip(shown) : shown
  const aside = data?.lift === true && typeof text === 'string' ? labelOffset(rb.x + rb.width / 2 - (ra.x + ra.width / 2), rb.y + rb.height / 2 - (ra.y + ra.height / 2), text.length) : { x: 0, y: 0 }
  const [labelX, labelY] = spot && data?.lift !== true ? [spot.x, spot.y] : [x + aside.x, y + aside.y]
  return (
    <>
      {change && <path className="change-line" data-change={change} d={path} fill="none" />}
      <BaseEdge id={id} path={path} className={hot ? 'hot' : undefined} label={text} labelX={labelX} labelY={labelY} markerEnd={markerEnd} interactionWidth={interactionWidth} style={width === undefined ? undefined : { strokeWidth: width }} />
      {mark && (
        <EdgeLabelRenderer>
          <FailBadge mark={mark} line={`${nameOfNode(a, source)} to ${nameOfNode(b, target)}`} className="line" style={{ transform: `translate(-50%, -150%) translate(${x}px, ${y}px)` }} />
        </EdgeLabelRenderer>
      )}
    </>
  )
})
