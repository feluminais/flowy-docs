import { test } from 'node:test'
import assert from 'node:assert/strict'
import { changedFiles, emptyModel, fileData, isRemovableFile, modelFiles, ParseError, parseAnalysisFile, parseFile, serializeAnalysis } from '../src/core/model.ts'
import { shop, shopWithFailures } from './fixtures.ts'

const CANONICAL = `name: Ordering
about: Made-up ratings for a test.
scope: shop
scale:
  severity:
    low: Nobody notices
    high: A customer loses money
modes:
  db-down:
    mode: The database is unreachable
    on: db
    effect: Orders can't be saved.
    severity: 10
    occurrence: 2
    detection: 2
    status: planned
    after:
      severity: 10
      occurrence: 1
    affects:
      - web
      - api
    description: |
      First line.

      Second paragraph.
  mail-timeout:
    mode: The mail service doesn't answer
    from: orders
    to: mail
`

const refused = (text: string, reason: RegExp) =>
  assert.throws(() => parseAnalysisFile('x', text), (e: unknown) => e instanceof ParseError && e.message.startsWith('failures/x.yaml') && reason.test(e.reason))

test('an analysis file parses and serialises back to the same text', () => {
  const a = parseAnalysisFile('ordering', CANONICAL)
  assert.equal(a.name, 'Ordering')
  assert.equal(a.modes['db-down'].severity, '10')
  assert.deepEqual(a.modes['db-down'].affects, ['web', 'api'])
  assert.equal(serializeAnalysis(a), CANONICAL)
})

test('an empty file, or one that is only a comment, is an analysis with no modes', () => {
  for (const text of ['', '# nothing yet\n', 'modes:\n', 'modes: ~\n']) {
    const a = parseAnalysisFile('x', text)
    assert.deepEqual(a.modes, {})
    assert.equal(a.name, '')
  }
})

test('parse refuses a file that is not a mapping, bad modes, a bad known field, a bad after and a bad affects', () => {
  refused('- a\n- b\n', /expected a mapping/)
  refused('name: [x]\n', /"name" must be plain text/)
  refused('modes: [a]\n', /"modes" must map ids to mappings/)
  refused('modes:\n  a: text\n', /mode "a" must be a mapping/)
  refused('modes:\n  a:\n    mode: [x]\n', /mode "a": "mode" must be plain text/)
  refused('modes:\n  a:\n    after: text\n', /mode "a": "after" must be a mapping/)
  refused('modes:\n  a:\n    after:\n      severity: [1]\n', /mode "a" after: "severity" must be plain text/)
  refused('modes:\n  a:\n    affects: web\n', /mode "a": "affects" must be a list of ids/)
  refused('modes:\n  a:\n    affects:\n      - [web]\n', /mode "a": "affects" must be a list of ids/)
  refused('scale: text\n', /"scale" must map/)
  refused('scale:\n  severity: text\n', /scale "severity" must be a mapping/)
  refused('name: A\n<<<<<<< ours\n', /merge conflict/)
})

test('a mode id of __proto__ or constructor is a mode, not the prototype', () => {
  const a = parseAnalysisFile('x', 'modes:\n  __proto__:\n    mode: one\n  constructor:\n    mode: two\n')
  assert.deepEqual(Object.keys(a.modes), ['__proto__', 'constructor'])
  assert.equal(Object.getPrototypeOf(a.modes), Object.prototype)
  assert.equal((a.modes as Record<string, { mode?: string }>)['__proto__'].mode, 'one')
  assert.equal(({} as { mode?: string }).mode, undefined)
})

test('parseFile, fileData, modelFiles and changedFiles all know failures/<id>.yaml', () => {
  const m = shopWithFailures()
  const text = modelFiles(m)['failures/ordering.yaml']
  assert.match(text, /^name: Ordering\n/)
  assert.deepEqual(fileData(m, 'failures/ordering.yaml'), m.failures.ordering)
  assert.deepEqual(parseFile('failures/ordering.yaml', text), m.failures.ordering)
  assert.deepEqual(changedFiles(shop(), m), [['failures/ordering.yaml', text]])
  assert.deepEqual(changedFiles(m, shop()), [['failures/ordering.yaml', null]])
  assert.deepEqual(changedFiles(m, m), [])
})

test('isRemovableFile is true for flows and failures files only', () => {
  assert.equal(isRemovableFile('flows/a.yaml'), true)
  assert.equal(isRemovableFile('failures/a.yaml'), true)
  assert.equal(isRemovableFile('model.yaml'), false)
  assert.equal(isRemovableFile('layout.yaml'), false)
})

test('emptyModel has failures: {}', () => {
  assert.deepEqual(emptyModel().failures, {})
})
