import { getBezierPath, getSmoothStepPath, getStraightPath, getViewportForBounds, Position } from '@xyflow/system'
import { frameAround, lineEnds, panIntoView, ports } from '../../ui/src/graph.ts'
import type { Rect } from '../../ui/src/graph.ts'

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
function draw(style: (typeof STYLES)[number], a: Rect, b: Rect) {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b)
    const [data, x, y] = getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
    return { data, label: [x, y] }
  }
  const p = ports(a, b)
  const ends = { sourceX: p.from.x, sourceY: p.from.y, sourcePosition: SIDES[p.fromSide], targetX: p.to.x, targetY: p.to.y, targetPosition: SIDES[p.toSide] }
  const [data, x, y] = style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
  return { data, label: [x, y] }
}

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

/** What the C# geometry (Geometry, LinePaths, Camera in desktop/Flowy.Core) must reproduce from the browser canvas's own functions. */
export function dumpGeometry(): unknown {
  return {
    paths: PAIRS.flatMap(([a, b]) => STYLES.map(style => {
      const p = ports(a, b)
      return { a, b, style, ...draw(style, a, b), ends: lineEnds(a, b), ports: p }
    })),
    frames: [[box(0, 0), box(300, 200)], [box(10, 10, 50, 50)], [box(-100, 40), box(0, -20), box(80, 300)]].map(rects => ({ rects, frame: frameAround(rects) })),
    fits: FITS.map(f => ({
      ...f,
      viewport: getViewportForBounds(f.bounds, f.size[0], f.size[1], 0.2, 1, { top: px(f.pad[0]), right: px(f.pad[1]), bottom: px(f.pad[2]), left: px(f.pad[3]) }),
    })),
    pans: PANS.map(p => ({ ...p, to: panIntoView(p.box, p.view, { width: p.size[0], height: p.size[1] }, p.panel) ?? null })),
  }
}
