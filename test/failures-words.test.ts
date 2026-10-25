import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analysedText, badgeName, BAND_RULES, bandOf, rank, rowName } from '../src/core/failures.ts'
import type { Mode } from '../src/core/model.ts'
import { shopWithFailures } from './fixtures.ts'

const rated = (severity: number, occurrence: number, detection: number): Mode =>
  ({ mode: 'x', on: 'db', severity: String(severity), occurrence: String(occurrence), detection: String(detection) })

test('the band rules say what bandOf does, at the edges', () => {
  assert.deepEqual(BAND_RULES, { high: 'Risk 150+ or severity 9+', medium: 'Risk 60 to 149', low: 'Risk under 60', unrated: 'A rating missing' })
  assert.equal(bandOf(rated(6, 5, 5)), 'high') // risk 150
  assert.equal(bandOf(rated(7, 7, 3)), 'medium') // risk 147
  assert.equal(bandOf(rated(4, 5, 3)), 'medium') // risk 60
  assert.equal(bandOf(rated(7, 4, 2)), 'low') // risk 56
  assert.equal(bandOf(rated(9, 1, 1)), 'high') // severity 9, risk 9
  assert.equal(bandOf(rated(8, 1, 1)), 'low') // severity 8, risk 8
  assert.equal(bandOf({ mode: 'x', on: 'db', severity: '5' }), 'unrated')
})

test('the coverage line names what it counts', () => {
  assert.equal(analysedText(15, 26), 'Analysed 15 of 26 shapes')
  assert.equal(analysedText(1, 1), 'Analysed 1 of 1 shape')
  assert.equal(analysedText(0, 0), 'Analysed 0 of 0 shapes')
})

test('a row is named by its part, its mode, its band with the risk, and where it sits', () => {
  const m = shopWithFailures()
  const names = Object.fromEntries(rank(m.failures.ordering).map(r => [r.id, rowName(m, r)]))
  assert.equal(names['auth-lock'], 'Auth: The login lock is never released. High, risk 150. Shop > API')
  assert.equal(names['db-down'], 'Orders DB: The database is unreachable. High, risk 40. Shop')
  assert.equal(names['mail-timeout'], "Orders to Mail service: The mail service doesn't answer. Medium, risk 126")
  assert.equal(names['orders-unrated'], 'Orders: An order is counted twice. Not rated. Shop > API')
})

test('a badge says how many modes, the worst band, and for a line which line', () => {
  assert.equal(badgeName({ band: 'medium', count: 2 }, 'Ordering to Stripe'), 'Ordering to Stripe, 2 failures, Medium')
  assert.equal(badgeName({ band: 'high', count: 1 }), '1 failure, High')
})
