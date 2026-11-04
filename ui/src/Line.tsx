import { createContext, memo, useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { BaseEdge, EdgeLabelRenderer, useInternalNode, useStore } from '@xyflow/react'
import type { EdgeProps, InternalNode, XYPosition } from '@xyflow/react'
import type { Mark } from '../../src/core/failures.ts'
import { endsOfPath, HEAD_PATH, headMatrix, headScale } from '../../src/core/heads.ts'
import { HAIRLINE_GAP, isLaned, round3, stackStep } from '../../src/core/lanes.ts'
import type { Point } from '../../src/core/heads.ts'
import type { LineLook } from '../../src/core/kinds.ts'
import { SHAPE_DEFS, shapeOf } from '../../src/core/look.ts'
import type { LineStyle } from '../../src/core/model.ts'
import { ChangeMarksContext, FailBadge } from './Box.tsx'
import { changeAt } from './compare.ts'
import { inPair, loopAround, sizeOf } from './graph.ts'
import { clip, SAMPLE } from './labels.ts'
import { laneOf } from './lanehit.ts'
import { lanes, REST, SPREAD } from './lanes.ts'
import type { LaneEnd, Pose, Slot } from './lanes.ts'
import type { Spot } from './labels.ts'
import type { SpotsFor } from './labelspots.ts'
import { marksOf, markScale } from './kindkey.ts'
import { LookSwatch, MarkPath, TrunkChip } from './kinds.tsx'
import { labelOffset } from './motion.ts'
import { PartsContext } from './parts.ts'
import { useEasedSpread } from './spread.ts'
import type { BoxData, Outline, Rect } from './graph.ts'
import type { Trunk } from '../../src/core/views.ts'

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
        const same = before !== undefined && before.x === spot.x && before.y === spot.y && before.side === spot.side
        if (!same) changed = true
        kept.set(id, same ? before : spot)
      }
      spots = kept
      if (changed) for (const listener of [...listeners]) listener()
    },
  }
}

/**
 * Provides where the labels go (see spotsFor) to the lines inside. The labels are placed from the lines as they are drawn, and while a flow plays the lines of a pair part around the lit
 * ones (see parts.ts), so they are placed again each time the pair changes: this reads the flow's part store from PartsContext, which is why it sits inside it.
 */
export function LabelSpots({ spots, children }: { spots: SpotsFor; children: ReactNode }) {
  const parts = useContext(PartsContext)
  const store = useRef<ReturnType<typeof createSpotStore>>(undefined)
  store.current ??= createSpotStore(spots(parts.lam))
  const current = store.current
  useLayoutEffect(() => {
    const place = () => current.set(spots(parts.lam))
    place()
    return parts.subscribe(place)
  }, [current, spots, parts])
  return <LabelSpotsContext value={current}>{children}</LabelSpotsContext>
}

export const rect = (n: InternalNode): Rect => ({ ...n.internals.positionAbsolute, ...sizeOf(n) })
/** The outline a line meets: the shape's own, so it never ends in the air beside a diamond's corner. */
/** What a box is called, for the words a badge on a line says. */
const nameOfNode = (n: InternalNode, id: string): string => (n.data as BoxData).object.name || id

export const outline = (n: InternalNode): Outline => SHAPE_DEFS[shapeOf((n.data as BoxData).object)].edge

/** A box as the end of a lane (see lanes.ts). */
export const endOf = (n: InternalNode): LaneEnd => ({ id: n.id, rect: rect(n), edge: outline(n) })

/** The middle of the line between two boxes in the given style, where its label sits. `strand` is the id of the line, where the caller knows it (see lanes.ts). */
export function labelPoint(style: LineStyle, a: InternalNode, b: InternalNode, strand?: LaneRef): XYPosition {
  const { x, y } = lanes.laneFor(strand?.id, style, endOf(a), endOf(b), REST, strand?.slot)
  return { x, y }
}

/**
 * A line of a pair of shapes that has several, as a pipe or a stream asks for it: its id, its place among its pair's lines, the pair's id and, while a step of the stop rides a
 * line of the pair, how lit each of the pair's lines is (1 for a line a step rides, see parts.ts). A lit line that has another lit line beside it is moved by the gap the pair
 * opens around them, so what runs along it is laid out on the line as it stands once the pair has parted.
 */
export type LaneRef = { id: string; slot: Slot; pair?: string; lit?: readonly number[] }

/** The pose a line is in once its pair has parted: the lit lanes of `strand`, or at rest. */
const partedPose = (strand: LaneRef | undefined): Pose => (strand?.lit === undefined ? REST : { s: 0, lam: strand.lit })

/** The path of the line between two boxes in the given style, for a step's pipe to follow. `strand` is the line, where the caller knows it (see lanes.ts); without it the path is the pair's one line. */
export const pathBetween = (style: LineStyle, a: InternalNode, b: InternalNode, strand?: LaneRef): string => lanes.laneFor(strand?.id, style, endOf(a), endOf(b), partedPose(strand), strand?.slot).path

/** The path of a recursion's loop pipe for one box, out of its right side and back in (the same in every line style). */
export const loopPath = (n: InternalNode): string => loopAround(rect(n), outline(n))

/** The usual thickness of a line, which the head's size is measured against (the stylesheet makes a picked or a lit line a little thicker, which the head ignores). */
const USUAL_WIDTH = 1.5

/**
 * The marks at the ends of a line. Flowy draws them itself (src/core/heads.ts and src/core/kinds.ts), so they are the same size as on the desktop and the stylesheet
 * colours them with the line (`.head` and `.kmark` beside every rule for `.react-flow__edge-path`). They take no clicks.
 *
 * A plain line has a filled head on its end, and on its start when it carries connections both ways. A line with a kind has the kind's head instead (a filled
 * triangle or an open chevron, at both ends when both ways) and, when it runs one way, the kind's tail on its start.
 */
const Ends = memo(function Ends({ path, both, hot, width, look, lanes }: { path: string; both: boolean; hot: boolean; width: number | undefined; look: LineLook | undefined; lanes: number }) {
  const ends = useMemo(() => endsOfPath(path), [path])
  if (!ends) return null
  const full = headScale(width ?? USUAL_WIDTH)
  const scale = markScale(full, lanes)
  const className = hot ? 'head hot' : 'head'
  const { head: headShape, headAtStart, tail } = marksOf(look, both)
  const head = (at: Point, dir: Point) => headShape === 'filled'
    ? <path className={className} d={HEAD_PATH} transform={`matrix(${headMatrix(at, dir, scale).join(' ')})`} />
    : <MarkPath shape={headShape} at={at} dir={dir} scale={scale} hot={hot} />
  return (
    <>
      {head(ends.end, ends.endDir)}
      {headAtStart && head(ends.start, ends.startDir)}
      {tail && <MarkPath shape={tail} at={ends.start} dir={ends.startDir} scale={scale} hot={hot} />}
    </>
  )
})

/**
 * A line between two boxes. Straight lines go edge to edge, whichever sides face each other: the boxes
 * sit above, beside and below the members, so lines that always left at the bottom would loop around.
 * Curved and right-angled lines leave from the middle of the facing side.
 */
export const Line = memo(function Line({ id, source, target, label, interactionWidth, data }: EdgeProps) {
  const style = useContext(LineStyleContext)
  // Where a project draws a line for each connection, the id is the line's own and `data.pair` the pair's merged line: traffic, failure marks and compare marks are the pair's.
  const pair = typeof data?.pair === 'string' ? data.pair : id
  const width = useContext(LineWidthsContext).get(pair)
  const mark = useContext(LineMarksContext).get(pair)
  const hover = useContext(LineHoverContext)
  // What the pointer is on, as this line sees it: this line ('line'), this line among others of its pair ('lane': drawn above them), another line of its pair ('mate': faded a little), or none.
  const several = typeof data?.lanes === 'number' && data.lanes > 1
  // A trunk stands for several lines (their ids are in `data.trunk`): pointing at one of them, say in the list of a panel, points at the trunk.
  const trunk = data?.trunk as Trunk | undefined
  const pointed = useSyncExternalStore(hover.subscribe, () => {
    const now = hover.get()
    if (now === undefined) return 'none'
    if (now === id || trunk?.members.includes(now)) return several ? 'lane' : 'line'
    if (now === pair) return 'line'
    return several && inPair(now, pair) ? 'mate' : 'none'
  })
  const hot = pointed === 'line' || pointed === 'lane'
  const mate = pointed === 'mate'
  const spreadNow = useEasedSpread(data?.spread === true) // how far the pair has gone towards spread, eased (see useEasedSpread)
  // How lit each lane of the pair is while a step plays on it: the others part around the lit one (see parts.ts). Read by the pair, so only its lines draw again as it changes.
  const parts = useContext(PartsContext)
  const lit = useSyncExternalStore(parts.subscribe, () => (several ? parts.lam(pair) : undefined))
  const spots = useContext(LabelSpotsContext)
  const spot = useSyncExternalStore(spots.subscribe, () => spots.get(id))
  const change = changeAt(useContext(ChangeMarksContext)?.lines, pair)
  const look = data?.look as LineLook | undefined
  // The strip of a line among others takes clicks within HIT_WIDTH screen pixels (the desktop measures the same), but React Flow scales it with the canvas, so it is made 1/zoom as wide.
  // A lone line keeps React Flow's usual strip and does not follow the zoom.
  const stripZoom = useStore(s => (several ? s.transform[2] : 1))
  const a = useInternalNode(source)
  const b = useInternalNode(target)
  if (!a || !b) return null
  const { slot } = laneOf(data)
  // The hairlines of a trunk lie behind it on its outer side, a fixed step along the normal of the pair (see stackStep).
  const trunkStep = trunk !== undefined && slot !== undefined ? stackStep(endOf(a), endOf(b), slot) : undefined
  const pose = lit === undefined ? (spreadNow === 0 ? REST : spreadNow === 1 ? SPREAD : { s: spreadNow, lam: [] }) : { s: spreadNow, lam: lit }
  const { path, x, y } = lanes.laneFor(id, style, endOf(a), endOf(b), pose, slot)
  // A step that moves runs a blob along this line, so its label steps aside instead of sitting under the blob.
  const [ra, rb] = [rect(a), rect(b)]
  // A label shows on a line that is pointed at, as on one that is selected: the line itself says so, since pointing re-draws no page. The label it holds back is in its data.
  const shown = label ?? (hot && typeof data?.label === 'string' ? data.label : undefined)
  const text = typeof shown === 'string' ? clip(shown) : shown
  const sampled = typeof text === 'string' && isLaned(slot)
  // The label of a line among others is placed beside its line already when the line is lit (see besideLit), clear of a pipe too; a lone line's label steps aside here.
  const aside = data?.lift === true && !sampled && typeof text === 'string' ? labelOffset(rb.x + rb.width / 2 - (ra.x + ra.width / 2), rb.y + rb.height / 2 - (ra.y + ra.height / 2), text.length) : { x: 0, y: 0 }
  // The failure badge of a pair sits above the middle of the pair, not on one of its lines (the desktop's PairBadgeRect puts it in the same place).
  const centre = isLaned(slot) ? lanes.laneFor(pair, 'straight', endOf(a), endOf(b)) : { x, y }
  const [labelX, labelY] = spot && !(spot.hidden && pointed === 'lane') && (data?.lift !== true || sampled) ? [spot.x, spot.y] : [x + aside.x, y + aside.y]
  return (
    <>
      {/* The line pointed at among the lines of its pair is drawn above them (the stylesheet lifts the svg React Flow gives it, for `raised`), and they fade a little (`lane-mate`). */}
      <g className={mate ? 'lane-mate' : undefined}>
        {change && <path className="change-line" data-change={change} d={path} fill="none" />}
        {trunkStep && [1, 2].map(k => <path key={k} className={hot ? 'trunk-hair hot' : 'trunk-hair'} d={path} fill="none" transform={`translate(${round3(trunkStep.x * HAIRLINE_GAP * k)} ${round3(trunkStep.y * HAIRLINE_GAP * k)})`} />)}
        <BaseEdge id={id} path={path} className={[hot && 'hot', pointed === 'lane' && 'raised', look?.pattern === 'dashdot' && 'dashdot'].filter(Boolean).join(' ') || undefined} label={sampled ? undefined : text} labelX={labelX} labelY={labelY} interactionWidth={interactionWidth === undefined ? undefined : interactionWidth / stripZoom} style={width === undefined ? undefined : { strokeWidth: width }} />
        {trunk && !(hot && text !== undefined) && <TrunkChip size={trunk.size} at={{ x, y }} />}
        <Ends path={path} both={data?.both === true} hot={hot} width={width} look={look} lanes={typeof data?.lanes === 'number' ? data.lanes : 1} />
      </g>
      {sampled && !(spot?.hidden === true && pointed !== 'lane') && (
        <EdgeLabelRenderer>
          {/* The label of a line among others starts with a sample of the line (its pattern and marks), so it is tied to its own line with no leader line. It takes no clicks. */}
          <div className={['lane-pill', mate && 'lane-mate', spot?.side === -1 && 'flip'].filter(Boolean).join(' ')} aria-hidden="true" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            <LookSwatch look={look} width={SAMPLE - 6} height={12} />
            <span>{text}</span>
          </div>
        </EdgeLabelRenderer>
      )}
      {mark && (slot === undefined || (slot.lane === 0 && (slot.within ?? 0) === 0)) && (
        <EdgeLabelRenderer>
          <FailBadge mark={mark} line={`${nameOfNode(a, source)} to ${nameOfNode(b, target)}`} className="line" style={{ transform: `translate(-50%, -150%) translate(${centre.x}px, ${centre.y}px)` }} />
        </EdgeLabelRenderer>
      )}
    </>
  )
})
