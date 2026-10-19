import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseNav } from '../ui/src/navstate.ts'
import { scrollToRow, visibleRows } from '../ui/src/window.ts'

test('a window shows the rows in view and a few more each side, and never more than there are', () => {
  assert.deepEqual(visibleRows(0, 300, 1000, 30), { start: 0, end: 16 }) // 10 in view + 6
  assert.deepEqual(visibleRows(3000, 300, 1000, 30), { start: 94, end: 116 })
  assert.deepEqual(visibleRows(0, 300, 5, 30), { start: 0, end: 5 })
  assert.deepEqual(visibleRows(0, 300, 0, 30), { start: 0, end: 0 })
  assert.deepEqual(visibleRows(29000, 300, 1000, 30), { start: 960, end: 983 })
  assert.deepEqual(visibleRows(29900, 300, 1000, 30), { start: 990, end: 1000 }) // the end of the list
  assert.deepEqual(visibleRows(9999999, 300, 1000, 30), { start: 1000, end: 1000 }) // scrolled past the end after the list shrank
  assert.deepEqual(visibleRows(100, 90, 100, 30, 0), { start: 3, end: 7 })
})

test('scrolling to a row moves as little as it can, and not at all when the row shows', () => {
  assert.equal(scrollToRow(5, 0, 300, 30), undefined)
  assert.equal(scrollToRow(9, 0, 300, 30), undefined) // the last row that fits
  assert.equal(scrollToRow(10, 0, 300, 30), 30) // one row below: just far enough to show it
  assert.equal(scrollToRow(2, 300, 300, 30), 60) // above: the row's top at the top
  assert.equal(scrollToRow(0, 0, 300, 30), undefined)
})

test('stored navigator state is read as far as it can be trusted', () => {
  assert.deepEqual(parseNav(null), { expanded: [] })
  assert.deepEqual(parseNav('not json'), { expanded: [] })
  assert.deepEqual(parseNav('[1,2]'), { expanded: [] })
  assert.deepEqual(parseNav('{"tab":"explorer","expanded":["root","shop"]}'), { tab: 'explorer', expanded: ['root', 'shop'] })
  assert.deepEqual(parseNav('{"tab":"flows"}'), { tab: 'flows', expanded: [] })
  assert.deepEqual(parseNav('{"tab":"details","expanded":"all"}'), { expanded: [] }) // details is never remembered
  assert.deepEqual(parseNav('{"expanded":["a",1,null,"b"]}'), { expanded: ['a', 'b'] })
  assert.equal(parseNav(JSON.stringify({ expanded: Array.from({ length: 5000 }, (_, i) => `s${i}`) })).expanded.length, 2000)
})
