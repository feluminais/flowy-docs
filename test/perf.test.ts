import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError } from '../src/core/model.ts'
import { checkRun, interpolate, parseRun, rollUp, strain } from '../src/core/perf.ts'
import { shop } from './fixtures.ts'

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
const near = (actual: number | undefined, expected: number) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`)

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

test('a run that names only things the model has has no problems', () => {
  assert.deepEqual(checkRun('ramp', ramp(), shop()), [])
})

test('checkRun reports what the model does not have, each once however many levels repeat it', () => {
  const { run } = parseRun('r', `name: R
entry: ghost
levels:
  - load: 1
    objects: { ghost: { util: 0.1 }, api: { util: 0.1 } }
    connections: [{ from: web, to: db, rate: 1 }, { from: web, to: phantom, rate: 1 }]
  - load: 2
    objects: { ghost: { util: 0.2 } }
`)
  assert.deepEqual(checkRun('r', run, shop()).map(p => `${p.file} ${p.message}`), [
    'perf/r.yaml entry "ghost" is not an object',
    'perf/r.yaml unknown object "ghost"',
    'perf/r.yaml web → db is not a connection in the model',
    'perf/r.yaml unknown object "phantom"',
  ])
})

test('interpolate gives a tested level exactly', () => {
  const at = interpolate(ramp(), 200)
  assert.equal(at.load, 200)
  assert.deepEqual(at.objects.api, { util: 0.7, queue: 2 })
  assert.deepEqual(at.overall, { rate: 190, p50: 70, p95: 150, errors: 0.01 })
})

test('interpolate runs a straight line between two tested levels, metric by metric', () => {
  const at = interpolate(ramp(), 150)
  assert.equal(at.load, 150)
  near(at.objects.db.util, 0.65)
  near(at.objects.api.queue, 1)
  near(at.overall.p95, 125)
  const webApi = at.connections.find(c => c.from === 'web' && c.to === 'api')
  near(webApi?.rate, 144)
})

test('interpolate never goes outside the tested range', () => {
  assert.equal(interpolate(ramp(), 1000).load, 400)
  near(interpolate(ramp(), 1000).objects.db.util, 0.97)
  assert.equal(interpolate(ramp(), 0).load, 100)
  assert.equal(interpolate(ramp(), NaN).load, 100) // a slider that gave no number shows the lowest level
  near(interpolate(ramp(), 0).objects.db.util, 0.5)
})

test('a metric measured at some levels only is used between the levels that carry it', () => {
  const { run } = parseRun('r', `name: R
levels:
  - { load: 0 }
  - { load: 100, objects: { x: { util: 0.2 } } }
  - { load: 200, objects: { x: { util: 0.6 } } }
  - { load: 300 }
`)
  assert.equal(interpolate(run, 50).objects.x, undefined) // before the first level that carries it
  near(interpolate(run, 150).objects.x.util, 0.4)
  assert.equal(interpolate(run, 250).objects.x, undefined) // after the last
})

test('a metric skipped by a middle level is joined across the gap', () => {
  const { run } = parseRun('r', `name: R
levels:
  - { load: 100, objects: { x: { util: 0.2 } } }
  - { load: 200 }
  - { load: 300, objects: { x: { util: 0.6 } } }
`)
  near(interpolate(run, 200).objects.x.util, 0.4)
})

test('strain is the busier of utilisation and errors, with errors counting twenty times', () => {
  assert.equal(strain({}), undefined)
  assert.equal(strain({ queue: 3, rate: 5 }), undefined)
  assert.deepEqual(strain({ util: 0.4 }), { value: 0.4, by: 'util', share: 0.4 })
  const mostlyErrors = strain({ util: 0.4, errors: 0.025 })
  assert.equal(mostlyErrors?.by, 'errors')
  near(mostlyErrors?.value, 0.5)
  assert.equal(strain({ util: 0.4, errors: 0.01 })?.by, 'util')
  assert.deepEqual(strain({ errors: 0.2 }), { value: 1, by: 'errors', share: 0.2 })
  assert.deepEqual(strain({ errors: 0 }), { value: 0, by: 'errors', share: 0 }) // only errors were measured, so it is not "by util"
})

test('rollUp gives a shape the worst of what it holds, with queues added up', () => {
  const { objects } = rollUp(shop(), ramp().levels[1], 'root')
  assert.deepEqual(objects.orders, { util: 0.3 })
  assert.deepEqual(objects.api, { util: 0.7, queue: 2 }) // its own, with orders inside it no busier
  assert.deepEqual(objects.shop, { util: 0.8, queue: 2 }) // db is the busiest thing inside it
  assert.equal(Object.hasOwn(objects, 'web'), false) // nothing measured it, nothing inside it
})

test('rollUp merges the connections that land on one line in a view', () => {
  const run = ramp()
  assert.deepEqual(rollUp(shop(), run.levels[2], 'shop').lines, [
    { from: 'web', to: 'api', rate: 300, p50: 60, p95: 200, errors: 0.08 },
    { from: 'api', to: 'db', rate: 270, p50: 50, p95: 120 }, // orders → db and auth → db: rates added, worst latency
  ])
})

test('rollUp leaves out a connection the view folds into one box, and one the model does not have', () => {
  const run = ramp()
  assert.deepEqual(rollUp(shop(), run.levels[2], 'root').lines, [])
  const { run: odd } = parseRun('r', 'name: R\nlevels:\n  - { load: 1, connections: [{ from: web, to: db, rate: 5 }] }\n  - load: 2\n')
  assert.deepEqual(rollUp(shop(), odd.levels[0], 'shop').lines, [])
})
