import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clampWidth, MAX_WIDTH, MIN_WIDTH, openTab, parseNav, rememberedTab } from '../ui/src/navstate.ts'
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

test('Review Focus: a remembered tab opens only where it exists (not YAML on an exported page or in VS Code)', () => {
  assert.equal(openTab('yaml', { flows: true, yaml: false }), undefined)
  assert.equal(openTab('yaml', { flows: false, yaml: true }), 'yaml')
  assert.equal(openTab('flows', { flows: false, yaml: true }), undefined)
  assert.equal(openTab('flows', { flows: true, yaml: false }), 'flows')
  assert.equal(openTab('explorer', { flows: false, yaml: false }), 'explorer')
  assert.equal(openTab(undefined, { flows: true, yaml: true }), undefined)
})

test('the Performance and Failures tabs are never remembered: the address brings them back', () => {
  assert.equal(rememberedTab('failures'), undefined)
  assert.equal(rememberedTab('performance'), undefined)
  assert.equal(rememberedTab('flows'), 'flows')
  assert.equal(rememberedTab('explorer'), 'explorer')
  assert.equal(rememberedTab('yaml'), 'yaml')
  assert.equal(rememberedTab(undefined), undefined)
  assert.deepEqual(parseNav('{"tab":"failures"}'), { expanded: [] }) // a stored one is ignored too
  assert.deepEqual(parseNav('{"tab":"performance"}'), { expanded: [] })
})

test('the Performance and Failures tabs open without a run or an analysis, and Performance only while not editing', () => {
  assert.equal(openTab('performance', { flows: false, yaml: false }), 'performance')
  assert.equal(openTab('performance', { flows: false, yaml: false, performance: true }), 'performance')
  assert.equal(openTab('performance', { flows: true, yaml: true, performance: false }), undefined)
  assert.equal(openTab('failures', { flows: false, yaml: false, performance: false }), 'failures')
})

test('stored navigator state is read as far as it can be trusted', () => {
  assert.deepEqual(parseNav(null), { expanded: [] })
  assert.deepEqual(parseNav('not json'), { expanded: [] })
  assert.deepEqual(parseNav('[1,2]'), { expanded: [] })
  assert.deepEqual(parseNav('{"tab":"explorer","expanded":["root","shop"]}'), { tab: 'explorer', expanded: ['root', 'shop'] })
  assert.deepEqual(parseNav('{"tab":"flows"}'), { tab: 'flows', expanded: [] })
  assert.deepEqual(parseNav('{"tab":"yaml"}'), { tab: 'yaml', expanded: [] })
  assert.deepEqual(parseNav('{"tab":"yamls"}'), { expanded: [] })
  assert.deepEqual(parseNav('{"tab":"performance"}'), { expanded: [] }) // Performance and Failures are opened by the address, never remembered
  assert.deepEqual(parseNav('{"tab":"failures"}'), { expanded: [] })
  assert.deepEqual(parseNav('{"tab":"details","expanded":"all"}'), { expanded: [] }) // details is never remembered
  assert.deepEqual(parseNav('{"expanded":["a",1,null,"b"]}'), { expanded: ['a', 'b'] })
  assert.equal(parseNav(JSON.stringify({ expanded: Array.from({ length: 5000 }, (_, i) => `s${i}`) })).expanded.length, 2000)
})

test('dragged widths are remembered, kept between the narrowest and widest, and anything else is dropped', () => {
  assert.deepEqual(parseNav('{"navWidth":300,"detailsWidth":450.4}'), { expanded: [], navWidth: 300, detailsWidth: 450 })
  assert.deepEqual(parseNav('{"navWidth":5,"detailsWidth":99999}'), { expanded: [], navWidth: MIN_WIDTH, detailsWidth: MAX_WIDTH })
  assert.deepEqual(parseNav('{"navWidth":"wide","detailsWidth":null}'), { expanded: [] })
  assert.equal(clampWidth(400, 100), MIN_WIDTH, 'a small window never squeezes a panel below the narrowest')
  assert.equal(clampWidth(500, 350), 350, 'and the other panel and the canvas set the limit')
})
