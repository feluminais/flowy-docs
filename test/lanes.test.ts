import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getBezierPath, getSmoothStepPath, getStraightPath, Position } from '@xyflow/react'
import { SHAPE_DEFS } from '../src/core/look.ts'
import type { LineStyle } from '../src/core/model.ts'
import { lineEnds, lineId, ports } from '../ui/src/graph.ts'
import type { Outline, Rect } from '../ui/src/graph.ts'
import { createLaneStore, lanes, REST } from '../ui/src/lanes.ts'
import type { LaneEnd } from '../ui/src/lanes.ts'

const STYLES: LineStyle[] = ['straight', 'curved', 'angled']

const box = (id: string, x: number, y: number, edge: Outline = [], width = 200, height = 72): LaneEnd => ({ id, rect: { x, y, width, height }, edge })

/**
 * The line as the browser drew it before the lane store: the body of Line.tsx's `draw`, copied. The store must give exactly these strings.
 */
function before(style: LineStyle, a: Rect, b: Rect, edgeA: Outline, edgeB: Outline): [string, number, number] {
  const [path, x, y] = oldDraw(style, a, b, edgeA, edgeB)
  return [path, x, y]
}

function oldDraw(style: LineStyle, a: Rect, b: Rect, edgeA: Outline, edgeB: Outline) {
  if (style === 'straight') {
    const [from, to] = lineEnds(a, b, edgeA, edgeB)
    return getStraightPath({ sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y })
  }
  const sides = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left }
  const p = ports(a, b, edgeA, edgeB)
  const ends = {
    sourceX: p.from.x, sourceY: p.from.y, sourcePosition: sides[p.fromSide],
    targetX: p.to.x, targetY: p.to.y, targetPosition: sides[p.toSide],
  }
  return style === 'curved' ? getBezierPath(ends) : getSmoothStepPath({ ...ends, borderRadius: 8 })
}

// Beside each other, above and below, on a diagonal, at the same spot, and with every kind of outline at one or both ends.
const PAIRS: [LaneEnd, LaneEnd][] = [
  [box('a', 0, 0), box('b', 400, 0)],
  [box('a', 0, 0), box('b', 0, 220)],
  [box('a', 0, 0), box('b', 330, 190)],
  [box('a', 330, 190), box('b', 0, 0)],
  [box('a', 0, 0), box('b', 0, 0)],
  [box('a', 10, 20, SHAPE_DEFS.diamond.edge), box('b', 400, 90, SHAPE_DEFS.ellipse.edge)],
  [box('a', 10, 20, SHAPE_DEFS.hexagon.edge), box('b', 40, 300, SHAPE_DEFS.pill.edge, 120, 48)],
  [box('a', -250.5, 12.25, SHAPE_DEFS.cloud.edge), box('b', 90.75, -140.5, SHAPE_DEFS.cylinder.edge)],
]

test('the lane store draws every line exactly as the browser drew it before', () => {
  const store = createLaneStore()
  for (const style of STYLES) {
    for (const [a, b] of PAIRS) {
      for (const [from, to] of [[a, b], [b, a]]) {
        const [path, x, y] = before(style, from.rect, to.rect, from.edge, to.edge)
        const lane = store.laneFor(undefined, style, from, to)
        assert.deepEqual([lane.path, lane.x, lane.y], [path, x, y], `${style} ${from.id}>${to.id}`)
      }
    }
  }
})

test('a few lines are pinned by their path data', () => {
  const [a, b] = [box('a', 0, 0), box('b', 400, 0)]
  const at = (style: LineStyle) => createLaneStore().laneFor(undefined, style, a, b).path
  assert.equal(at('straight'), 'M 200,36L 400,36')
  assert.equal(at('curved'), 'M200,36 C300,36 300,36 400,36')
  assert.equal(at('angled'), 'M200 36L220 36L300 36L300 36L380 36L400 36')
})

test('asked again with the shapes where they were, the store gives back the same lane', () => {
  const store = createLaneStore()
  const [a, b] = PAIRS[2]
  const first = store.laneFor('a|b', 'curved', a, b)
  // Other objects with the same numbers: a caller makes its rects afresh on every draw.
  const again = store.laneFor('a|b', 'curved', { ...a, rect: { ...a.rect } }, { ...b, rect: { ...b.rect } })
  assert.equal(again, first)
})

test('a shape that moved or changed its outline, or another style, gives another lane', () => {
  const store = createLaneStore()
  const [a, b] = PAIRS[2]
  const first = store.laneFor('a|b', 'straight', a, b)
  const moved = store.laneFor('a|b', 'straight', a, { ...b, rect: { ...b.rect, x: b.rect.x + 40 } })
  assert.notEqual(moved, first)
  assert.notEqual(moved.path, first.path)
  assert.deepEqual([moved.path, moved.x, moved.y], before('straight', a.rect, { ...b.rect, x: b.rect.x + 40 }, a.edge, b.edge))
  const reshaped = store.laneFor('a|b', 'straight', a, { ...b, edge: SHAPE_DEFS.diamond.edge })
  assert.deepEqual([reshaped.path, reshaped.x, reshaped.y], before('straight', a.rect, b.rect, a.edge, SHAPE_DEFS.diamond.edge))
  // Moved back, the lane is the one it was.
  assert.deepEqual(store.laneFor('a|b', 'straight', a, b), first)
  assert.notEqual(store.laneFor('a|b', 'curved', a, b).path, first.path)
})

test('a lane is asked for by its strand, and a caller with none gets the pair\'s own lane', () => {
  const store = createLaneStore()
  const [a, b] = PAIRS[2]
  const named = store.laneFor(lineId(a.id, b.id), 'straight', a, b)
  assert.equal(store.laneFor(undefined, 'straight', a, b), named)
  // Another strand of the same two shapes is a lane of its own, which later draws apart from this one.
  const other = store.laneFor('a|b|other', 'straight', a, b)
  assert.notEqual(other, named)
  assert.deepEqual(other, named)
})

test('the line the other way between two shapes starts at the other shape', () => {
  const store = createLaneStore()
  const [a, b] = PAIRS[0]
  const there = store.laneFor(undefined, 'straight', a, b)
  const back = store.laneFor(undefined, 'straight', b, a)
  assert.notEqual(back, there)
  assert.equal(back.path, 'M 400,36L 200,36')
  assert.equal(store.laneFor(undefined, 'straight', a, b), there)
})

test('a pose is part of the question; only the rest pose is drawn so far, so a pose gives the rest path', () => {
  const store = createLaneStore()
  const [a, b] = PAIRS[2]
  const rest = store.laneFor('x', 'straight', a, b, REST)
  assert.equal(store.laneFor('x', 'straight', a, b), rest)
  const spread = store.laneFor('x', 'straight', a, b, { s: 1, lam: [] })
  const part = store.laneFor('x', 'straight', a, b, { s: 0, lam: [0, 1] })
  assert.deepEqual([spread.path, part.path], [rest.path, rest.path])
  // A pose with nothing in it is the rest pose.
  assert.equal(store.laneFor('x', 'straight', a, b, { s: 0, lam: [] }), rest)
})

test('the store that starts again after too many lanes still answers right', () => {
  const store = createLaneStore()
  const [a, b] = PAIRS[0]
  for (let i = 0; i < 20_500; i++) store.laneFor(`strand-${i}`, 'straight', a, b)
  const lane = store.laneFor('strand-0', 'straight', a, b)
  assert.equal(lane.path, 'M 200,36L 400,36')
})

test('the shared store is one object', () => {
  const [a, b] = PAIRS[0]
  assert.equal(lanes.laneFor(undefined, 'straight', a, b), lanes.laneFor(undefined, 'straight', a, b))
})

test('no reader file but the lane store makes the path of a line between two shapes', () => {
  const dir = join(import.meta.dirname, '..', 'ui', 'src')
  const makers = /\b(getStraightPath|getBezierPath|getSmoothStepPath|getSimpleBezierPath)\b|\b(lineEnds|ports)\(/
  const found = readdirSync(dir)
    .filter(f => /\.(ts|tsx)$/.test(f) && f !== 'lanes.ts' && f !== 'graph.ts')
    .filter(f => makers.test(readFileSync(join(dir, f), 'utf8')))
  assert.deepEqual(found, [])
})
