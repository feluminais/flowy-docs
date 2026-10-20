import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bandOf, coverage, partName, rank, ratingOf, ratingsAfter, ratingsOf, risk } from '../src/core/failures.ts'
import type { Analysis, Mode } from '../src/core/model.ts'
import { shopWithFailures } from './fixtures.ts'

const rated = (severity: number, occurrence: number, detection: number, extra: Mode = {}): Mode =>
  ({ mode: 'x', on: 'db', severity: String(severity), occurrence: String(occurrence), detection: String(detection), ...extra })
const analysis = (modes: Record<string, Mode>): Analysis => ({ name: 'A', modes })

test('ratingOf accepts 1 to 10 and nothing else', () => {
  assert.equal(ratingOf('1'), 1)
  assert.equal(ratingOf('10'), 10)
  for (const bad of ['0', '11', '5.5', '07', '1e1', ' 7 ', '', undefined, 7, null]) assert.equal(ratingOf(bad), undefined, String(bad))
})

test('risk is the product, and none when a rating is missing', () => {
  assert.equal(risk({ severity: 8, occurrence: 4, detection: 3 }), 96)
  assert.equal(risk({ severity: 8, occurrence: 4 }), undefined)
  assert.equal(risk({}), undefined)
})

test('band thresholds', () => {
  assert.equal(bandOf(rated(6, 5, 5)), 'high') // 150
  assert.equal(bandOf(rated(7, 7, 3)), 'medium') // 147
  assert.equal(bandOf(rated(4, 5, 3)), 'medium') // 60
  assert.equal(bandOf(rated(7, 4, 2)), 'low') // 56
})

test('severity 9 or 10 is High even with the other ratings missing, and with a low product', () => {
  assert.equal(bandOf({ mode: 'x', severity: '10' }), 'high')
  assert.equal(bandOf({ mode: 'x', severity: '9' }), 'high')
  assert.equal(bandOf(rated(9, 1, 1)), 'high')
  assert.equal(bandOf(rated(8, 1, 1)), 'low')
})

test('a mode missing a rating is Not rated, and so is one whose rating is not a rating', () => {
  assert.equal(bandOf({ mode: 'x', severity: '5' }), 'unrated')
  assert.equal(bandOf({ mode: 'x' }), 'unrated')
  assert.equal(bandOf(rated(5, 5, 5, { severity: '5.5' })), 'unrated')
  assert.deepEqual(ratingsOf(rated(5, 5, 5, { detection: '0' })), { severity: 5, occurrence: 5 })
})

test('done uses the after ratings, per key; open, planned and accepted use the current ones', () => {
  const m = (status: string) => rated(6, 5, 5, { status, after: { occurrence: '1' } })
  assert.equal(bandOf(m('done')), 'low') // 6 * 1 * 5 = 30
  for (const s of ['open', 'planned', 'accepted']) assert.equal(bandOf(m(s)), 'high', s)
  assert.equal(bandOf(rated(6, 5, 5)), 'high') // no status counts as open
  assert.deepEqual(ratingsAfter(m('done')), { severity: 6, occurrence: 1, detection: 5 })
  assert.deepEqual(ratingsAfter(rated(6, 5, 5, { after: { occurrence: '11' } })), { severity: 6, occurrence: 5, detection: 5 })
})

test('rank orders by band, then risk, then keeps file order for ties; a High mode with no risk number sorts after the High modes that have one', () => {
  const a = shopWithFailures().failures.ordering
  assert.deepEqual(rank(a).map(r => r.id), ['auth-lock', 'db-down', 'mail-timeout', 'api-slow', 'web-glitch', 'orders-unrated'])
  assert.deepEqual(rank(a).map(r => r.band), ['high', 'high', 'medium', 'medium', 'low', 'unrated'])
  assert.deepEqual(rank(a).map(r => r.risk), [150, 40, 126, 60, 12, undefined])
  const ties = analysis({ b: rated(3, 3, 3), a: rated(3, 3, 3), c: rated(4, 3, 3) })
  assert.deepEqual(rank(ties).map(r => r.id), ['c', 'b', 'a'])
  const severe = analysis({ half: { mode: 'x', severity: '10' }, full: rated(6, 5, 5) })
  assert.deepEqual(rank(severe).map(r => `${r.id}:${r.band}`), ['full:high', 'half:high'])
})

test('coverage counts childless, non-actor shapes inside scope that a mode names, as on or as an end of a line', () => {
  const m = shopWithFailures()
  assert.deepEqual(coverage(m, m.failures.ordering), { analysed: ['web', 'db', 'auth', 'orders'], left: [] })
  const { 'web-glitch': _, ...rest } = m.failures.ordering.modes
  assert.deepEqual(coverage(m, { ...m.failures.ordering, modes: rest }), { analysed: ['db', 'auth', 'orders'], left: ['web'] })
  const everywhere = { ...m.failures.ordering, scope: 'root' }
  assert.deepEqual(coverage(m, everywhere), { analysed: ['web', 'db', 'auth', 'orders', 'mail'], left: [] }) // the line mode names mail as an end
  const { 'mail-timeout': __, ...noMail } = m.failures.ordering.modes
  assert.deepEqual(coverage(m, { ...everywhere, modes: noMail }), { analysed: ['web', 'db', 'auth', 'orders'], left: ['mail'] }) // customer is an actor, so never counted
  assert.deepEqual(coverage(m, { ...everywhere, scope: undefined, modes: noMail }).left, ['mail'])
  assert.deepEqual(coverage(m, { ...m.failures.ordering, scope: 'nowhere' }), { analysed: [], left: [] })
})

test('partName is the path of names for a shape and "A to B" for a line, and falls back to the id', () => {
  const m = shopWithFailures()
  assert.equal(partName(m, { on: 'auth' }), 'Shop > API > Auth')
  assert.equal(partName(m, { on: 'shop' }), 'Shop')
  assert.equal(partName(m, { from: 'orders', to: 'mail' }), 'Orders to Mail service')
  assert.equal(partName(m, { on: 'gone' }), 'gone')
  assert.equal(partName(m, {}), '')
})
