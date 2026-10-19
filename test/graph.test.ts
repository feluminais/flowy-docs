import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { SHAPE_DEFS } from '../src/core/look.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { computeView } from '../src/core/views.ts'
import { arrange, BOX, fitOptions, focusEdges, frameAround, frameNode, lineEnds, membersOf, panIntoView, PANEL, ports, tangle, toGraph, untangle } from '../ui/src/graph.ts'
import type { Region } from '../ui/src/graph.ts'
import { shop } from './fixtures.ts'

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(i => [i.id, i]))

test('a view becomes boxes and lines, with outsiders marked', () => {
  const { nodes, edges } = toGraph(shop(), 'shop')
  assert.deepEqual(nodes.map(n => [n.id, n.className]), [
    ['web', undefined], ['api', undefined], ['db', undefined], ['customer', 'outsider'], ['mail', 'outsider'],
  ])
  assert.deepEqual(edges.map(e => [e.source, e.target, e.label]), [
    ['customer', 'web', 'browses'], ['web', 'api', 'REST'], ['api', 'db', '2 connections'], ['api', 'mail', 'sends receipts'],
  ])
  assert.equal(byId(nodes).api.data.inside, 2)
  assert.equal(byId(nodes).db.data.inside, 0)
})

test('a box that opens counts the boxes right inside it', () => {
  const { nodes } = toGraph(shop(), 'root')
  assert.equal(byId(nodes).shop.data.inside, 3)
  assert.equal(byId(nodes).customer.data.inside, 0)
})

test('dagre places boxes without overlaps, and a layout.yaml position wins', () => {
  const placed = toGraph(shop(), 'shop').nodes
  for (const a of placed) for (const b of placed) if (a !== b)
    assert.ok(Math.abs(a.position.x - b.position.x) >= BOX.width || Math.abs(a.position.y - b.position.y) >= BOX.height, `${a.id} overlaps ${b.id}`)
  const model = { ...shop(), layout: { shop: { web: [5, 7] as [number, number] } } }
  assert.deepEqual(byId(toGraph(model, 'shop').nodes).web.position, { x: 5, y: 7 })
})

test('a playing step lights its two boxes and its line, and dims the rest', () => {
  const { nodes, edges } = toGraph(shop(), 'shop', { ends: [['web', 'api']], step: 0 })
  assert.deepEqual(nodes.filter(n => !n.className?.includes('dim')).map(n => n.id), ['web', 'api'])
  assert.deepEqual(nodes.filter(n => n.className?.includes('lit')).map(n => n.id), ['web', 'api'])
  assert.equal(byId(nodes).customer.className, 'outsider dim')
  assert.deepEqual(edges.map(e => [e.id, e.className]), [
    ['customer web', 'dim'], ['web api', 'active'], ['api db', 'dim'], ['api mail', 'dim'],
  ])
  // The lit line draws over the faded boxes, with an arrowhead in its own colour.
  const active = byId(edges)['web api']
  assert.equal(active.zIndex, 1)
  assert.deepEqual(active.markerEnd, { type: 'arrowclosed', color: 'var(--accent)' })
})

test('an outsider in a playing step is lit like the rest of the step', () => {
  const { nodes } = toGraph(shop(), 'shop', { ends: [['api', 'mail']], step: 0 })
  assert.equal(byId(nodes).mail.className, 'outsider lit')
})

test('a step with no line of its own gets a dashed one, and an unshowable step dims everything', () => {
  const back = toGraph(shop(), 'shop', { ends: [['api', 'web']], step: 0 }).edges.at(-1)
  assert.deepEqual([back?.id, back?.source, back?.target, back?.className], ['step', 'api', 'web', 'step'])
  const { nodes, edges } = toGraph(shop(), 'shop', { ends: [null], step: 0 })
  assert.ok([...nodes, ...edges].every(item => item.className?.includes('dim')))
})

test('a box only the flow uses joins as an outsider for the whole flow', () => {
  const ends: [string, string][] = [['web', 'auth'], ['auth', 'db']]
  assert.equal(byId(toGraph(shop(), 'api').nodes).web, undefined)
  const first = toGraph(shop(), 'api', { ends, step: 0 })
  assert.equal(byId(first.nodes).web.className, 'outsider lit')
  assert.deepEqual(first.edges.at(-1)?.id, 'step')
  const second = toGraph(shop(), 'api', { ends, step: 1 })
  assert.equal(byId(second.nodes).web.className, 'outsider dim')
  assert.deepEqual(byId(second.nodes).web.position, byId(first.nodes).web.position)
})

test('a flow without a current step brings its boxes but dims nothing', () => {
  const { nodes, edges } = toGraph(shop(), 'api', { ends: [['web', 'auth']] })
  assert.equal(byId(nodes).web.className, 'outsider')
  assert.ok([...nodes, ...edges].every(item => !item.className?.includes('dim')))
  assert.equal(edges.some(e => e.id === 'step'), false)
})

test('a box dagre places never covers a saved one', () => {
  const free = byId(toGraph(shop(), 'shop').nodes)
  const model = { ...shop(), layout: { shop: { web: [free.api.position.x, free.api.position.y] as [number, number] } } }
  const placed = toGraph(model, 'shop').nodes
  for (const a of placed) for (const b of placed) if (a !== b)
    assert.ok(Math.abs(a.position.x - b.position.x) >= BOX.width || Math.abs(a.position.y - b.position.y) >= BOX.height, `${a.id} overlaps ${b.id}`)
})

test('boxes and lines with problems are marked', () => {
  const m = shop()
  m.objects.db.name = ''
  m.connections.push({ from: 'auth', to: 'db', label: 'checks users' })
  const problems = check(m)
  const { nodes, edges } = toGraph(m, 'shop', undefined, problems)
  assert.deepEqual(nodes.filter(n => n.className?.includes('problem')).map(n => n.id), ['db'])
  assert.deepEqual(edges.filter(e => e.className?.includes('problem')).map(e => e.id), ['api db'])
})

/** An app with two boxes inside, one person using it and `n` systems it calls: one hub with many neighbours. */
function hub(n: number): Model {
  const m = emptyModel()
  m.objects = {
    app: { type: 'system', name: 'App' },
    hub: { type: 'app', in: 'app', name: 'Hub' },
    store: { type: 'store', in: 'app', name: 'Store' },
    user: { type: 'actor', name: 'User' },
  }
  m.connections = [{ from: 'user', to: 'hub' }, { from: 'hub', to: 'store' }]
  for (let i = 0; i < n; i++) {
    m.objects[`ext${i}`] = { type: 'system', name: `Ext ${i}` }
    m.connections.push({ from: 'hub', to: `ext${i}`, label: `calls ${i}` })
  }
  return m
}

test('inside a box the members sit together, people wait above, and the rest wait on both sides', () => {
  const nodes = byId(toGraph(hub(8), 'app').nodes)
  const members = [nodes.hub, nodes.store].map(n => n.position)
  const left = Math.min(...members.map(p => p.x))
  const right = Math.max(...members.map(p => p.x)) + BOX.width
  assert.ok(nodes.user.position.y + BOX.height <= Math.min(...members.map(p => p.y)), 'the user is above the members')
  const systems = Object.values(nodes).filter(n => n.id.startsWith('ext')).map(n => n.position)
  const onLeft = systems.filter(p => p.x + BOX.width <= left).length
  const onRight = systems.filter(p => p.x >= right).length
  assert.equal(onLeft + onRight, 8, 'every system waits beside the members')
  assert.ok(onLeft >= 3 && onRight >= 3, `both sides are used (${onLeft} left, ${onRight} right)`)
  const all = Object.values(nodes).map(n => n.position)
  assert.ok(Math.max(...all.map(p => p.x)) + BOX.width - Math.min(...all.map(p => p.x)) < 5 * BOX.width, 'not one wide row')
})

test('boxes arranged around the members never overlap', () => {
  for (const [model, view] of [[hub(8), 'app'], [hub(1), 'app'], [shop(), 'shop'], [shop(), 'api']] as const) {
    const placed = toGraph(model, view).nodes
    for (const a of placed) for (const b of placed) if (a !== b)
      assert.ok(Math.abs(a.position.x - b.position.x) >= BOX.width || Math.abs(a.position.y - b.position.y) >= BOX.height, `${view}: ${a.id} overlaps ${b.id}`)
  }
})

test('lines show a label only for the selected box, the selected or pointed-at line, and a lit step', () => {
  const { edges } = toGraph(shop(), 'shop', { ends: [['web', 'api']], step: 0 })
  const labels = (focus: Parameters<typeof focusEdges>[1]) => focusEdges(edges, focus).filter(e => e.label).map(e => e.id)
  assert.deepEqual(labels({}), ['web api'], 'only the lit line')
  assert.deepEqual(focusEdges(toGraph(shop(), 'shop').edges, {}).filter(e => e.label), [], 'a quiet view has no labels')
  const quiet = toGraph(shop(), 'shop').edges
  const shown = (focus: Parameters<typeof focusEdges>[1]) => focusEdges(quiet, focus).filter(e => e.label).map(e => e.id)
  assert.deepEqual(shown({ box: 'api' }), ['web api', 'api db', 'api mail'])
  assert.deepEqual(shown({ line: 'customer web' }), ['customer web'])
  assert.deepEqual(shown({ hover: 'api db' }), ['api db'])
  assert.equal(focusEdges(quiet, { line: 'api db' }).find(e => e.selected)?.id, 'api db')
})

test('selecting a box fades the lines that do not touch it', () => {
  const quiet = toGraph(shop(), 'shop').edges
  assert.deepEqual(focusEdges(quiet, { box: 'api' }).filter(e => e.className === 'faint').map(e => e.id), ['customer web'])
  assert.ok(focusEdges(quiet, {}).every(e => e.className === undefined))
})

test('the line pointed at stands out, also among the selected box\'s lines', () => {
  const quiet = toGraph(shop(), 'shop').edges
  assert.deepEqual(focusEdges(quiet, { box: 'api', hover: 'api db' }).filter(e => e.className?.includes('hover')).map(e => e.id), ['api db'])
})

test('a line runs between the borders of two boxes that face each other', () => {
  const a = { x: 0, y: 0, width: 180, height: 72 }
  assert.deepEqual(lineEnds(a, { ...a, x: 400 }), [{ x: 180, y: 36 }, { x: 400, y: 36 }])
  assert.deepEqual(lineEnds(a, { ...a, y: 200 }), [{ x: 90, y: 72 }, { x: 90, y: 200 }])
  const [from, to] = lineEnds(a, { ...a, x: 100, y: 200 })
  assert.ok(from.y === 72 && to.y === 200, 'leaves the bottom, enters the top')
  assert.deepEqual(lineEnds(a, a), [{ x: 90, y: 36 }, { x: 90, y: 36 }])
})

test('the view pans only as far as it takes to show a box beside the side panel', () => {
  const size = { width: 1280, height: 800 }
  const view = { x: 0, y: 0, zoom: 1 }
  const box = { x: 100, y: 100, width: 180, height: 72 }
  assert.equal(panIntoView(box, view, size), undefined, 'already in the open part')
  const hidden = panIntoView({ ...box, x: 1000 }, view, size)
  assert.deepEqual(hidden && [hidden.x, hidden.zoom], [size.width - PANEL - 24 - 1180, 1], 'its right edge ends 24px left of the panel')
  assert.deepEqual(panIntoView({ ...box, x: -50 }, view, size), { x: 74, y: 0, zoom: 1 })
  assert.deepEqual(panIntoView({ ...box, y: 780 }, view, size), { x: 0, y: -(780 + 72 + 24 - 800), zoom: 1 })
  assert.equal(panIntoView({ ...box, width: 2000 }, view, size)?.x, 24 - 100, 'a box wider than the room keeps its left edge in sight')
})

test('the fit leaves room for the side panels and the flow player only when they are open, as wide as they are', () => {
  assert.deepEqual(fitOptions(0, false).padding, { top: '40px', left: '40px', right: '40px', bottom: '40px' })
  assert.deepEqual(fitOptions(PANEL, true).padding, { top: '40px', left: '40px', right: `${PANEL + 40}px`, bottom: '200px' })
  assert.deepEqual(fitOptions(500, false, 260).padding, { top: '40px', left: '300px', right: '540px', bottom: '40px' })
})

test('the view also keeps a box out from under the navigator on the left', () => {
  const size = { width: 1280, height: 800 }
  const box = { x: 100, y: 100, width: 180, height: 72 }
  assert.equal(panIntoView(box, { x: 0, y: 0, zoom: 1 }, size, PANEL, 24, 0), undefined)
  assert.deepEqual(panIntoView(box, { x: 0, y: 0, zoom: 1 }, size, PANEL, 24, 320), { x: 244, y: 0, zoom: 1 }, 'its left edge ends 24px right of the navigator')
})

test('curved and angled lines leave from the middle of the side that faces the other box', () => {
  const a = { x: 0, y: 0, width: BOX.width, height: BOX.height }
  assert.deepEqual(ports(a, { ...a, x: 400 }), {
    from: { x: BOX.width, y: BOX.height / 2 }, fromSide: 'right', to: { x: 400, y: BOX.height / 2 }, toSide: 'left',
  })
  assert.deepEqual(ports(a, { ...a, x: 40, y: 300 }), {
    from: { x: BOX.width / 2, y: BOX.height }, fromSide: 'bottom', to: { x: 40 + BOX.width / 2, y: 300 }, toSide: 'top',
  })
})

const spots = (at: Record<string, [number, number]>) => new Map(Object.entries(at).map(([id, [x, y]]) => [id, { x, y }]))
const W = BOX.width
const H = BOX.height

test('tangle counts lines that cross and lines that run through a box', () => {
  const square = spots({ a: [0, 0], b: [2 * W, 0], c: [0, 3 * H], d: [2 * W, 3 * H] })
  assert.equal(tangle(square, [{ from: 'a', to: 'd' }, { from: 'b', to: 'c' }]), 1)
  assert.equal(tangle(square, [{ from: 'a', to: 'c' }, { from: 'b', to: 'd' }]), 0)
  assert.equal(tangle(square, [{ from: 'a', to: 'd' }, { from: 'a', to: 'c' }]), 0, 'lines from the same box never cross')
  const row = spots({ a: [0, 0], m: [2 * W, 0], c: [4 * W, 0] })
  assert.equal(tangle(row, [{ from: 'a', to: 'c' }]), 1, 'a → c runs through m')
})

test('untangle swaps boxes in a row until nothing crosses, using the same spots', () => {
  const square = spots({ a: [0, 0], b: [2 * W, 0], c: [0, 3 * H], d: [2 * W, 3 * H] })
  const lines = [{ from: 'a', to: 'd' }, { from: 'b', to: 'c' }]
  const tidy = untangle(square, lines)
  assert.equal(tangle(tidy, lines), 0)
  const where = (at: Map<string, { x: number; y: number }>) => [...at.values()].map(p => `${p.x},${p.y}`).sort()
  assert.deepEqual(where(tidy), where(square))
})

test('untangle moves boxes up or down only in the columns it is given', () => {
  // Every box is alone in its row. Swapping w and z fixes the crossing; swapping t and u would too,
  // but t and u stand for a view's own boxes, whose order top to bottom is dagre's.
  const at = spots({ t: [0, 0], u: [0, 6 * H], w: [3 * W, 2 * H], z: [3 * W, 4 * H] })
  const lines = [{ from: 't', to: 'z' }, { from: 'u', to: 'w' }]
  assert.equal(tangle(at, lines), 1)
  assert.deepEqual(untangle(at, lines), at)
  assert.equal(tangle(untangle(at, lines, [], [['w', 'z']]), lines), 0)
})

test('the computed layout of every fixture view is untangled, and keeps lines pointing down', () => {
  for (const view of ['root', 'shop', 'api']) {
    const { nodes } = toGraph(shop(), view)
    const at = new Map(nodes.map(n => [n.id, n.position]))
    assert.equal(tangle(at, computeView(shop(), view).edges), 0, view)
  }
  const { nodes } = toGraph(shop(), 'shop')
  assert.ok(byId(nodes).web.position.y < byId(nodes).api.position.y)
})

test('outsiders stay around the view, never between its own boxes', () => {
  for (const name of ['shop', 'api']) {
    const view = computeView(shop(), name)
    const at = new Map(toGraph(shop(), name).nodes.map(n => [n.id, n.position]))
    const inner = view.members.map(id => at.get(id)!)
    const [left, right] = [Math.min(...inner.map(p => p.x)), Math.max(...inner.map(p => p.x)) + BOX.width]
    const [top, bottom] = [Math.min(...inner.map(p => p.y)), Math.max(...inner.map(p => p.y)) + BOX.height]
    for (const id of view.outsiders) {
      const p = at.get(id)!
      assert.ok(p.x + BOX.width <= left || p.x >= right || p.y + BOX.height <= top || p.y >= bottom, `${name}: ${id}`)
    }
  }
})

test('the frame wraps the boxes with room to spare', () => {
  assert.deepEqual(frameAround([{ x: 0, y: 0, width: 200, height: 72 }, { x: 300, y: 150, width: 200, height: 72 }], 28),
    { x: -28, y: -28, width: 556, height: 278 })
})

test('toGraph names the view\'s own boxes', () => {
  assert.deepEqual(toGraph(shop(), 'shop').members, ['web', 'api', 'db'])
})

test('the frame node sits behind the boxes and lets clicks through to the canvas', () => {
  const frame = frameNode('Shop', [{ x: 0, y: 0, width: 200, height: 72 }])
  assert.deepEqual([frame.position, frame.width, frame.height], [{ x: -28, y: -28 }, 256, 128])
  assert.equal(frame.style?.pointerEvents, 'none')
  assert.equal(frame.data.name, 'Shop')
  assert.equal(frame.selectable, false)
})

/** A seeded random number below n, so a failing case repeats. */
function random(seed: number) {
  return (n: number) => {
    seed = (seed * 16807) % 2147483647
    return seed % n
  }
}

test('scoring only the boxes that moved gives the same change as scoring everything', () => {
  const rnd = random(1)
  for (let round = 0; round < 200; round++) {
    // 12 boxes on a grid with gaps, 18 lines between them, then 1 to 3 boxes jump to free cells.
    const cells = Array.from({ length: 40 }, (_, i) => ({ x: (i % 8) * (W + 40), y: Math.floor(i / 8) * (H + 60) }))
    const free = [...cells]
    const before = new Map(Array.from({ length: 12 }, (_, i) => [`b${i}`, free.splice(rnd(free.length), 1)[0]]))
    const lines = Array.from({ length: 18 }, () => ({ from: `b${rnd(12)}`, to: `b${rnd(12)}` }))
    const after = new Map(before)
    const moved = new Set<string>()
    for (let k = 0; k <= rnd(3); k++) {
      const id = `b${rnd(12)}`
      moved.add(id)
      after.set(id, free.splice(rnd(free.length), 1)[0])
    }
    assert.equal(tangle(after, lines, moved) - tangle(before, lines, moved), tangle(after, lines) - tangle(before, lines), `round ${round}`)
  }
})

test('random views never overlap, and their outsiders stay out of the members\' block', () => {
  const rnd = random(7)
  for (let round = 0; round < 80; round++) {
    const model: Model = { ...emptyModel(), objects: { s: { type: 'system', name: 'S' } } }
    const [inside, outside] = [2 + rnd(9), 1 + rnd(16)]
    for (let i = 0; i < inside; i++) model.objects[`a${i}`] = { type: 'app', name: `A${i}`, in: 's' }
    for (let i = 0; i < outside; i++) model.objects[`x${i}`] = { type: i % 3 === 0 ? 'actor' : 'system', name: `X${i}` }
    for (let i = 0; i < inside * 2; i++) {
      const from = `a${rnd(inside)}`
      const to = rnd(2) ? `x${rnd(outside)}` : `a${rnd(inside)}`
      if (from !== to) model.connections.push(model.objects[to].type === 'actor' ? { from: to, to: from } : { from, to })
    }
    const view = computeView(model, 's')
    const placed = toGraph(model, 's').nodes
    for (const a of placed) for (const b of placed) if (a !== b)
      assert.ok(Math.abs(a.position.x - b.position.x) >= W || Math.abs(a.position.y - b.position.y) >= H, `round ${round}: ${a.id} overlaps ${b.id}`)
    const at = new Map(placed.map(n => [n.id, n.position]))
    const inner = view.members.map(id => at.get(id)!)
    const [left, right] = [Math.min(...inner.map(p => p.x)), Math.max(...inner.map(p => p.x)) + W]
    const [top, bottom] = [Math.min(...inner.map(p => p.y)), Math.max(...inner.map(p => p.y)) + H]
    for (const id of view.outsiders) {
      const p = at.get(id)!
      assert.ok(p.x + W <= left || p.x >= right || p.y + H <= top || p.y >= bottom, `round ${round}: ${id} sits among the members`)
    }
  }
})

test('rows below and above clear tall side columns', () => {
  // One member, a column of five on the left, one on the right, four below and one above.
  const ids = ['l1', 'l2', 'l3', 'l4', 'l5', 'r1', 'b1', 'b2', 'b3', 'b4', 'u1']
  const lines = ids.map(id => ({ from: 'a', to: id }))
  const sides: Record<string, Region> = { l: 'left', r: 'right', b: 'below', u: 'above' }
  const { at } = arrange(membersOf(spots({ a: [0, 0] }), ids, lines), id => sides[id[0]])
  const placed = [...at]
  for (const [a, p] of placed) for (const [b, q] of placed) if (a !== b)
    assert.ok(Math.abs(p.x - q.x) >= W || Math.abs(p.y - q.y) >= H, `${a} overlaps ${b}`)
})

test('a straight line meets a shape on its outline, not on the box around it', () => {
  const a = { x: 0, y: 0, width: 200, height: 72 }
  const diamond = SHAPE_DEFS.diamond.edge
  assert.deepEqual(lineEnds(a, { ...a, x: 400 }, diamond)[0], { x: 199, y: 36 }, 'out of its right tip')
  assert.deepEqual(lineEnds(a, { ...a, y: 200 }, diamond)[0], { x: 100, y: 71 }, 'out of its bottom tip')
  const [slanted] = lineEnds(a, { ...a, x: 400, y: 200 }, diamond)
  assert.ok(Math.abs(Math.abs(slanted.x - 100) / 99 + Math.abs(slanted.y - 36) / 35 - 1) < 1e-9, 'on the diamond\'s slanted side')
  const [round] = lineEnds(a, { ...a, x: 300, y: 200 }, SHAPE_DEFS.ellipse.edge)
  assert.ok(Math.abs(((round.x - 100) / 99) ** 2 + ((round.y - 36) / 35) ** 2 - 1) < 0.01, 'on the ellipse')
  assert.deepEqual(lineEnds(a, { ...a, x: 400 }, SHAPE_DEFS.rectangle.edge), lineEnds(a, { ...a, x: 400 }), 'a rectangle is the box')
  assert.deepEqual(lineEnds(a, a, diamond), [{ x: 100, y: 36 }, { x: 100, y: 36 }], 'on top of each other: no line')
})

test('curved and angled lines leave from the middle of the side on the outline', () => {
  const a = { x: 0, y: 0, width: 200, height: 72 }
  assert.deepEqual(ports(a, { ...a, x: 400 }, SHAPE_DEFS.diamond.edge, SHAPE_DEFS.parallelogram.edge), {
    from: { x: 199, y: 36 }, fromSide: 'right', to: { x: 413.5, y: 36 }, toSide: 'left',
  })
})
