import { getBezierPath, getSmoothStepPath, getStraightPath, getViewportForBounds, Position } from '@xyflow/system'
import { SHAPE_DEFS } from '../../src/core/look.ts'
import type { Shape } from '../../src/core/look.ts'
import { frameAround, lineEnds, loopAround, panIntoView, ports } from '../../ui/src/graph.ts'
import type { Outline, Rect } from '../../ui/src/graph.ts'
import { clip, MAX_LABEL, placeLabels } from '../../ui/src/labels.ts'
import type { LabelItem } from '../../ui/src/labels.ts'

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }
const box = (x: number, y: number, width = 200, height = 72): Rect => ({ x, y, width, height })

/** Pairs of boxes in every relation that picks a different side, plus overlaps, odd sizes and ties. */
const PAIRS: [Rect, Rect][] = [
  [box(0, 0), box(0, 200)],
  [box(0, 200), box(0, 0)],
  [box(0, 0), box(400, 0)],
  [box(400, 0), box(0, 0)],
  [box(0, 0), box(350, 230)],
  [box(0, 300), box(350, 0)],
  [box(350, 230), box(0, 0)],
  [box(0, 0), box(300, 30)],
  [box(0, 0), box(30, 150)],
  [box(0, 0), box(10, 10)],
  [box(0, 0, 300, 100), box(500, 250)],
  [box(0, 0), box(272, 144)],
  [box(0, 0), box(205, 0)],
  [box(0, 0), box(0, 76)],
  [box(0, 0), box(60, 400)],
  [box(0, 0), box(-250, -180)],
]

const STYLES = ['straight', 'curved', 'angled'] as const

/** What Line.tsx draws for one line: its path and where its label sits. */
function draw(style: (typeof STYLES)[number], a: Rect, b: Rect, edgeA: Outline = [], edgeB: Outline = []) {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b, edgeA, edgeB)
    const [data, x, y] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    return { data, label: [x, y] }
  }
  const p = ports(a, b, edgeA, edgeB)
  const ends = { sourceX: p.from.x, sourceY: p.from.y, sourcePosition: SIDES[p.fromSide], targetX: p.to.x, targetY: p.to.y, targetPosition: SIDES[p.toSide] }
  const [data, x, y] = style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  return { data, label: [x, y] }
}

/** Pairs where one or both ends are a shape other than a rectangle, so lines meet the outline. */
const SHAPED: [Rect, Shape, Rect, Shape][] = [
  [box(0, 0), 'diamond', box(400, 0), 'rectangle'],
  [box(0, 0), 'diamond', box(350, 230), 'ellipse'],
  [box(0, 300), 'hexagon', box(350, 0), 'parallelogram'],
  [box(0, 0), 'pill', box(60, 400), 'arrow'],
  [box(0, 0), 'cloud', box(0, 200), 'cylinder'],
  [box(0, 0), 'ellipse', box(-250, -180), 'diamond'],
  [box(0, 0), 'parallelogram', box(205, 0), 'hexagon'],
  [box(0, 0), 'rectangle', box(10, 10), 'diamond'],
]

/** Boxes with a recursion's loop pipe: a rectangle and the shapes whose outline is not the box's border, and a box of another size and place. */
const LOOPS: [Rect, Shape][] = [
  ...(['rectangle', 'diamond', 'ellipse', 'hexagon', 'pill', 'cloud', 'cylinder', 'parallelogram'] as const).map((shape): [Rect, Shape] => [box(0, 0), shape]),
  [box(40, 90, 260, 100), 'rectangle'],
  [box(40, 90, 260, 100), 'diamond'],
]

const px = (n: number): `${number}px` => `${n}px`
const FITS = [
  { bounds: box(0, 0, 1000, 600), size: [1100, 700], pad: [40, 40, 40, 40] },
  { bounds: box(-300, -100, 1400, 900), size: [1100, 700], pad: [40, 460, 40, 40] },
  { bounds: box(0, 0, 200, 72), size: [1100, 700], pad: [40, 40, 40, 40] },
  { bounds: box(0, 0, 9000, 4000), size: [900, 600], pad: [40, 40, 200, 40] },
  { bounds: box(50, 20, 640, 410), size: [1280, 760], pad: [40, 420, 200, 40] },
]

const PANS = [
  { box: box(100, 100), view: { x: 0, y: 0, zoom: 1 }, size: [1100, 700], panel: 380 },
  { box: box(900, 100), view: { x: 0, y: 0, zoom: 1 }, size: [1100, 700], panel: 380 },
  { box: box(-50, 650), view: { x: 10, y: 20, zoom: 0.8 }, size: [1100, 700], panel: 380 },
  { box: box(1500, 100), view: { x: 0, y: 0, zoom: 1 }, size: [600, 400], panel: 380 },
  { box: box(300, 300), view: { x: 0, y: 0, zoom: 1 }, size: [1100, 700], panel: 380 },
]

/**
 * Labels to place: one box with lines to a row of boxes below it (the lines of a selected shape), in each style, with labels long enough to
 * collide, to sit on one row a space apart, or to fit at the middles. `pinned` pins the middle line's label, as a lit line's is.
 */
const LABEL_SCENES = [
  { count: 5, apart: 224, chars: 50 },
  { count: 3, apart: 125, chars: 18 },
  { count: 3, apart: 224, chars: 12 },
  { count: 4, apart: 160, chars: 24, pinned: true },
  { count: 2, apart: 0, chars: 60 },
]

function labelCases() {
  return LABEL_SCENES.flatMap(scene => STYLES.map(style => {
    const from = box(400, 0)
    const to = Array.from({ length: scene.count }, (_, i) => box(i * scene.apart, scene.apart === 0 ? 100 : 220))
    const items: LabelItem[] = to.map((b, i) => {
      const { data, label } = draw(style, from, b)
      return { id: `l${i}`, path: data, mid: { x: label[0], y: label[1] }, chars: scene.chars, pinned: scene.pinned === true && i === 1 }
    })
    const boxes = [from, ...to]
    const spots = placeLabels(items, boxes)
    // The C# side takes a label's size, which the browser works out from its characters: 6.2 a character and 10 of padding, 18 high.
    return { style, boxes, items: items.map(i => ({ ...i, width: i.chars * 6.2 + 10, height: 18 })), spots: items.map(i => spots.get(i.id)) }
  }))
}

/** What the C# geometry (Geometry, LinePaths, Camera, LineLabels in desktop/Flowy.Core) must reproduce from the browser canvas's own functions. */
export function dumpGeometry(): unknown {
  return {
    paths: PAIRS.flatMap(([a, b]) => STYLES.map(style => {
      const p = ports(a, b)
      return { a, b, style, ...draw(style, a, b), ends: lineEnds(a, b), ports: p }
    })),
    shaped: SHAPED.flatMap(([a, shapeA, b, shapeB]) => STYLES.map(style => {
      const [edgeA, edgeB] = [SHAPE_DEFS[shapeA].edge, SHAPE_DEFS[shapeB].edge]
      return { a, b, shapeA, shapeB, style, ...draw(style, a, b, edgeA, edgeB), ends: lineEnds(a, b, edgeA, edgeB), ports: ports(a, b, edgeA, edgeB) }
    })),
    loops: LOOPS.map(([b, shape]) => ({ box: b, shape, path: loopAround(b, SHAPE_DEFS[shape].edge) })),
    frames: [[box(0, 0), box(300, 200)], [box(10, 10, 50, 50)], [box(-100, 40), box(0, -20), box(80, 300)]].map(rects => ({ rects, frame: frameAround(rects) })),
    fits: FITS.map(f => ({
      ...f,
      viewport: getViewportForBounds(f.bounds, f.size[0], f.size[1], 0.2, 1, { top: px(f.pad[0]), right: px(f.pad[1]), bottom: px(f.pad[2]), left: px(f.pad[3]) }),
    })),
    pans: PANS.map(p => ({ ...p, to: panIntoView(p.box, p.view, { width: p.size[0], height: p.size[1] }, p.panel) ?? null })),
    labels: labelCases(),
    clips: ['REST', 'x'.repeat(MAX_LABEL), 'x'.repeat(MAX_LABEL + 1), 'publishes onboarding and queries courier records, then waits', `${'a'.repeat(40)}  tail`]
      .map(label => ({ label, clipped: clip(label) })),
  }
}
