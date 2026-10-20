import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineKey } from '../src/core/failures.ts'
import { parseRun } from '../src/core/perf.ts'
import { activeAnalysis, afterText, bandCounts, firstErrorAt, modeCount, modeIn, neighbour, ratingCells, rowsFor, STATUS_NAMES } from '../ui/src/failuresview.ts'
import { lineId } from '../ui/src/graph.ts'
import { shopWithFailures } from './fixtures.ts'

const m = shopWithFailures()
const a = m.failures.ordering
const ids = (rows: { id: string }[]) => rows.map(r => r.id)

const run = parseRun('r', `name: R
unit: req/s
levels:
  - load: 10
    objects: { db: { util: 0.2, errors: 0 } }
    connections: [{ from: orders, to: mail, rate: 5, errors: 0 }]
  - load: 20
    objects: { db: { util: 0.5, errors: 0.02 } }
    connections: [{ from: orders, to: mail, rate: 8, errors: 0 }]
  - load: 40
    objects: { db: { util: 0.9, errors: 0.05 } }
    connections: [{ from: orders, to: mail, rate: 10, errors: 0.1 }]
`).run

test('activeAnalysis keeps a known id, else the first, else none', () => {
  const two = { ...m.failures, other: { name: 'Other', modes: {} } }
  assert.equal(activeAnalysis(two, 'other'), 'other')
  assert.equal(activeAnalysis(two, 'gone'), 'ordering')
  assert.equal(activeAnalysis(two, ''), 'ordering')
  assert.equal(activeAnalysis({}, 'x'), undefined)
  assert.equal(activeAnalysis(two, 'constructor'), 'ordering')
})

test('modeIn finds a mode by analysis and id, and nothing for a name that is not there, however it is spelt', () => {
  assert.equal(modeIn(m, 'ordering', 'db-down'), a.modes['db-down'])
  for (const [analysis, mode] of [['nope', 'db-down'], ['ordering', 'nope'], ['ordering', undefined], [undefined, 'db-down'], ['constructor', 'db-down'], ['ordering', 'constructor'], ['ordering', '__proto__']] as const)
    assert.equal(modeIn(m, analysis, mode), undefined, `${analysis} ${mode}`)
})

test('modeCount adds up the modes of every analysis', () => {
  assert.equal(modeCount(m), 6)
  assert.equal(modeCount({ ...m, failures: { ...m.failures, other: { name: 'O', modes: { x: { mode: 'x' } } } } }), 7)
  assert.equal(modeCount({ ...m, failures: {} }), 0)
})

test('rowsFor puts what the view holds under here and the rest under elsewhere, worst first', () => {
  const shop = rowsFor(m, a, 'shop', {})
  assert.deepEqual(ids(shop.here), ['auth-lock', 'db-down', 'mail-timeout', 'api-slow', 'web-glitch', 'orders-unrated'])
  assert.deepEqual(shop.elsewhere, [])
  const api = rowsFor(m, a, 'api', {})
  assert.deepEqual(ids(api.here), ['auth-lock', 'mail-timeout', 'api-slow', 'orders-unrated'])
  assert.deepEqual(ids(api.elsewhere), ['db-down', 'web-glitch'])
})

test('rowsFor filters by band, and by a part to what that shape or line carries', () => {
  assert.deepEqual(ids(rowsFor(m, a, 'shop', { band: 'high' }).here), ['auth-lock', 'db-down'])
  assert.deepEqual(ids(rowsFor(m, a, 'api', { band: 'high' }).elsewhere), ['db-down'])
  const part = rowsFor(m, a, 'shop', { part: { box: 'api' } })
  assert.deepEqual(ids(part.here), ['auth-lock', 'api-slow', 'orders-unrated'])
  assert.deepEqual(part.elsewhere, [])
  assert.deepEqual(ids(rowsFor(m, a, 'shop', { part: { line: ['api', 'mail'] } }).here), ['mail-timeout'])
  assert.deepEqual(ids(rowsFor(m, a, 'shop', { part: { box: 'api' }, band: 'unrated' }).here), ['orders-unrated'])
  assert.deepEqual(rowsFor(m, a, 'shop', { part: { box: 'mail' } }), { here: [], elsewhere: [] })
})

test('bandCounts counts each band', () => {
  assert.deepEqual(bandCounts(a), { high: 2, medium: 2, low: 1, unrated: 1 })
  assert.deepEqual(bandCounts({ name: 'E', modes: {} }), { high: 0, medium: 0, low: 0, unrated: 0 })
})

test('ratingCells is ten cells filled up to the rating', () => {
  assert.deepEqual(ratingCells(6), [true, true, true, true, true, true, false, false, false, false])
  assert.equal(ratingCells(10).every(Boolean), true)
  assert.equal(ratingCells(undefined).some(Boolean), false)
  assert.equal(ratingCells(undefined).length, 10)
})

test('afterText shows the risk before and after, and only when the mode has an after and both can be worked out', () => {
  assert.equal(afterText({ mode: 'x', severity: '6', occurrence: '5', detection: '5', after: { occurrence: '1' } }), '150 to 30')
  assert.equal(afterText({ mode: 'x', severity: '6', occurrence: '5', detection: '5' }), undefined)
  assert.equal(afterText({ mode: 'x', severity: '6', after: { occurrence: '1' } }), undefined)
})

test('the status names are what a reader sees', () => {
  assert.deepEqual(STATUS_NAMES, { open: 'Open', planned: 'Planned', done: 'Done', accepted: 'Accepted' })
})

test('neighbour steps along the list, stays at the ends, and starts at the first', () => {
  const list = ['a', 'b', 'c']
  assert.equal(neighbour(list, 'a', 1), 'b')
  assert.equal(neighbour(list, 'b', -1), 'a')
  assert.equal(neighbour(list, 'a', -1), 'a')
  assert.equal(neighbour(list, 'c', 1), 'c')
  assert.equal(neighbour(list, undefined, 1), 'a')
  assert.equal(neighbour(list, undefined, -1), 'a')
  assert.equal(neighbour(list, 'gone', 1), 'a')
  assert.equal(neighbour([], 'a', 1), undefined)
})

test('firstErrorAt is the first tested level where the mode\'s part has errors', () => {
  assert.equal(firstErrorAt(m, run, a.modes['db-down']), 1)
  assert.equal(firstErrorAt(m, run, a.modes['mail-timeout']), 2)
  assert.equal(firstErrorAt(m, run, a.modes['web-glitch']), undefined) // never measured
  assert.equal(firstErrorAt(m, run, { mode: 'x', on: 'gone' }), undefined)
  assert.equal(firstErrorAt(m, run, { mode: 'x' }), undefined)
})

test('a line is known by the same text in the core and on the canvas', () => {
  assert.equal(lineKey('api', 'mail'), lineId('api', 'mail'))
})
