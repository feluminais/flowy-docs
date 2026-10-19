import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError } from '../src/core/model.ts'
import { parseRun } from '../src/core/perf.ts'

/** Three levels of a run against the shop fixture (test/fixtures.ts): api and db are measured, and orders inside api. */
const RAMP = `name: Ramp, 20 s per level
about: Test machine
unit: req/s
entry: web
levels:
  - load: 100
    overall: { rate: 98, p50: 60, p95: 100, errors: 0 }
    objects:
      api: { util: 0.4, queue: 0 }
      db: { util: 0.5 }
      orders: { util: 0.2 }
    connections:
      - { from: web, to: api, rate: 98, p50: 20, p95: 40, errors: 0 }
      - { from: orders, to: db, rate: 50, p50: 10, p95: 20 }
      - { from: auth, to: db, rate: 40, p50: 12, p95: 30 }
  - load: 200
    overall: { rate: 190, p50: 70, p95: 150, errors: 0.01 }
    objects:
      api: { util: 0.7, queue: 2 }
      db: { util: 0.8 }
      orders: { util: 0.3 }
    connections:
      - { from: web, to: api, rate: 190, p50: 25, p95: 60, errors: 0.01 }
      - { from: orders, to: db, rate: 100, p50: 14, p95: 28 }
      - { from: auth, to: db, rate: 80, p50: 16, p95: 44 }
  - load: 400
    overall: { rate: 300, p50: 200, p95: 420, errors: 0.08 }
    objects:
      api: { util: 0.95, queue: 40, errors: 0.02 }
      db: { util: 0.97 }
      orders: { util: 0.6 }
    connections:
      - { from: web, to: api, rate: 300, p50: 60, p95: 200, errors: 0.08 }
      - { from: orders, to: db, rate: 150, p50: 40, p95: 90 }
      - { from: auth, to: db, rate: 120, p50: 50, p95: 120 }
`
const ramp = () => parseRun('ramp', RAMP).run

test('parseRun reads a good run: text as numbers, nothing reported', () => {
  const { run, problems } = parseRun('ramp', RAMP)
  assert.deepEqual(problems, [])
  assert.equal(run.name, 'Ramp, 20 s per level')
  assert.equal(run.about, 'Test machine')
  assert.equal(run.unit, 'req/s')
  assert.equal(run.entry, 'web')
  assert.deepEqual(run.levels.map(l => l.load), [100, 200, 400])
  assert.deepEqual(run.levels[0].overall, { rate: 98, p50: 60, p95: 100, errors: 0 })
  assert.deepEqual(run.levels[1].objects.api, { util: 0.7, queue: 2 })
  assert.deepEqual(run.levels[0].connections[1], { from: 'orders', to: 'db', rate: 50, p50: 10, p95: 20 })
})

test('parseRun reports a bad number and leaves it out, and keeps reading', () => {
  const { run, problems } = parseRun('r', `unit: req/s
levels:
  - load: 10
    overall: { p50: 50, p95: 40 }
    objects:
      api: { util: 1.5, queue: -1, errors: lots }
    connections:
      - { from: web, to: api, rate: 5 }
      - { from: web, to: api, rate: 6 }
  - load: 20
`)
  assert.deepEqual(problems.map(p => `${p.file} ${p.message}`), [
    'perf/r.yaml name is missing',
    'perf/r.yaml load 10, overall: p95 is below p50',
    'perf/r.yaml load 10, api: util must be between 0 and 1',
    'perf/r.yaml load 10, api: queue must be 0 or more',
    'perf/r.yaml load 10, api: errors must be a number',
    'perf/r.yaml load 10, web → api: listed twice',
  ])
  assert.equal(run.name, 'r') // the id stands in for a missing name
  assert.equal(run.unit, 'req/s')
  assert.deepEqual(run.levels[0].objects.api, {})
  assert.deepEqual(run.levels[0].connections, [{ from: 'web', to: 'api', rate: 5 }])
  assert.deepEqual(run.levels[1], { load: 20, overall: {}, objects: {}, connections: [] })
})

test('a run without a unit counts plain "load"', () => {
  assert.equal(parseRun('r', 'name: R\nlevels:\n  - load: 1\n  - load: 2\n').run.unit, 'load')
})

const refused: [what: string, text: string, reason: string][] = [
  ['a file that is not a mapping', '- a\n', 'expected a mapping'],
  ['a name that is a list', 'name: [a]\nlevels:\n  - load: 1\n  - load: 2\n', '"name" must be plain text'],
  ['levels that are not a list', 'name: R\nlevels: 5\n', '"levels" must be a list'],
  ['a single level', 'name: R\nlevels:\n  - load: 1\n', 'needs at least two levels'],
  ['a level that is not a mapping', 'name: R\nlevels:\n  - 5\n  - load: 2\n', 'level 1 must be a mapping'],
  ['a load that is not a number', 'name: R\nlevels:\n  - load: fast\n  - load: 2\n', 'level 1: load must be a number, 0 or more'],
  ['a negative load', 'name: R\nlevels:\n  - load: -1\n  - load: 2\n', 'level 1: load must be a number, 0 or more'],
  ['levels that do not go up', 'name: R\nlevels:\n  - load: 5\n  - load: 5\n', 'level 2: load 5 must be above 5'],
  ['objects that are a list', 'name: R\nlevels:\n  - load: 1\n    objects: [a]\n  - load: 2\n', 'level 1: objects must map ids to numbers'],
  ['an object that is a list', 'name: R\nlevels:\n  - load: 1\n    objects: { api: [1] }\n  - load: 2\n', 'level 1: api must be a mapping of numbers'],
  ['connections that are a mapping', 'name: R\nlevels:\n  - load: 1\n    connections: { a: b }\n  - load: 2\n', 'level 1: connections must be a list'],
  ['a connection with no end', 'name: R\nlevels:\n  - load: 1\n    connections: [{ from: a }]\n  - load: 2\n', 'level 1: connection 1 needs a "from" and a "to"'],
  ['a merge conflict', '<<<<<<< HEAD\nname: R\n', 'unresolved merge conflict'],
]
for (const [what, text, reason] of refused) {
  test(`parseRun refuses ${what}`, () => {
    assert.throws(() => parseRun('r', text), (e: unknown) => e instanceof ParseError && e.file === 'perf/r.yaml' && e.reason.includes(reason))
  })
}

test('a merge conflict is named by its line', () => {
  assert.throws(() => parseRun('r', 'name: R\n=======\n'), (e: unknown) => e instanceof ParseError && e.line === 2)
})

test('an object called __proto__ is data, not the prototype', () => {
  const { run } = parseRun('r', 'name: R\nlevels:\n  - { load: 1, objects: { __proto__: { util: 0.5 } } }\n  - load: 2\n')
  assert.deepEqual(Object.keys(run.levels[0].objects), ['__proto__'])
  assert.equal(Object.getPrototypeOf(run.levels[0].objects), Object.prototype)
})
