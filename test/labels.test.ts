import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clip, MAX_LABEL, placeLabels } from '../ui/src/labels.ts'
import type { LabelItem } from '../ui/src/labels.ts'

const BOX = { width: 200, height: 72 }
const box = (x: number, y: number) => ({ x, y, ...BOX })
const centre = (b: { x: number; y: number }) => ({ x: b.x + BOX.width / 2, y: b.y + BOX.height / 2 })

/** A straight line from the bottom of `from` to the top of `to`, as the label sees it. */
function line(id: string, from: ReturnType<typeof box>, to: ReturnType<typeof box>, chars: number, pinned = false): LabelItem {
  const [a, b] = [{ x: centre(from).x, y: from.y + BOX.height }, { x: centre(to).x, y: to.y }]
  return { id, path: `M${a.x},${a.y}L${b.x},${b.y}`, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, chars, pinned }
}

const labelBox = (s: { x: number; y: number }, chars: number) => ({ x: s.x - (chars * 6.2 + 10) / 2, y: s.y - 9, width: chars * 6.2 + 10, height: 18 })
const touch = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** One box above a row of boxes 224 apart, a line to each: the shape of a selected box with many lines. */
function fan(count: number, chars: number) {
  const from = box(400, 0)
  const to = Array.from({ length: count }, (_, i) => box(i * 224, 220))
  const items = to.map((t, i) => line(`l${i}`, from, t, chars))
  return { from, to, items, boxes: [from, ...to] }
}

test('labels of the lines that leave one box are placed clear of each other and of every box', () => {
  const { items, boxes } = fan(5, 50)
  const spots = placeLabels(items, boxes)
  // Where they sat before, at the middle of each line, they overlap: that is the bug.
  assert.ok(items.some((a, i) => items.some((b, j) => i < j && touch(labelBox(a.mid, 50), labelBox(b.mid, 50)))))
  const drawn = items.map(i => labelBox(spots.get(i.id)!, 50))
  drawn.forEach((a, i) => {
    drawn.forEach((b, j) => i < j && assert.ok(!touch(a, b), `labels ${i} and ${j} overlap`))
    boxes.forEach((b, j) => assert.ok(!touch(a, b), `label ${i} covers box ${j}`))
  })
})

test('a label stays on its line, wherever it moves along it', () => {
  const { items, boxes } = fan(5, 50)
  const spots = placeLabels(items, boxes)
  for (const i of items) {
    const [from, to] = i.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number).reduce<number[][]>((acc, n, k) => (k % 2 ? (acc.at(-1)!.push(n), acc) : [...acc, [n]]), [])
    const s = spots.get(i.id)!
    const t = (s.x - from[0]) / (to[0] - from[0] || 1)
    assert.ok(Math.abs(s.y - (from[1] + (to[1] - from[1]) * t)) < 0.01, `${i.id} left its line`)
  }
})

test('a label with nothing in its way stays at the middle of its line', () => {
  const [a, b] = [box(0, 0), box(0, 220)]
  const only = line('only', a, b, 12)
  assert.deepEqual(placeLabels([only], [a, b]).get('only'), only.mid)
})

test('a pinned label stays where it is, and the others keep clear of it', () => {
  const { items, boxes } = fan(3, 40)
  items[1].pinned = true
  const spots = placeLabels(items, boxes)
  assert.deepEqual(spots.get('l1'), items[1].mid)
  const pinned = labelBox(items[1].mid, 40)
  for (const i of [items[0], items[2]]) assert.ok(!touch(labelBox(spots.get(i.id)!, 40), pinned), `${i.id} overlaps the pinned label`)
})

test('when no place along the lines is clear, two labels still do not share a spot', () => {
  // Two lines between boxes so close that no place along them is clear.
  const [a, b] = [box(0, 0), box(0, 100)]
  const items = [line('a', a, b, 60), line('b', a, b, 60)]
  const spots = placeLabels(items, [a, b])
  assert.notDeepEqual(spots.get('a'), spots.get('b'))
})

test('a label longer than the limit is cut short with an ellipsis, and a shorter one is left alone', () => {
  assert.equal(clip('REST'), 'REST')
  const long = 'publishes onboarding and queries courier records, then waits'
  assert.ok(clip(long).length <= MAX_LABEL)
  assert.ok(clip(long).endsWith('…'))
  assert.ok(!clip(long).endsWith(' …'), 'no space before the ellipsis')
  assert.equal(clip('x'.repeat(MAX_LABEL)), 'x'.repeat(MAX_LABEL))
})
