import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError } from '../src/core/model.ts'
import { AT_ONCE, capCounts, checkRun, eventsPassed, eventText, interpolate, knee, kneeText, parseRun, RADIUS_MAX, RADIUS_MIN, rollUp, runStates, scaleText, sourceKey, strain, traffic } from '../src/core/perf.ts'
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

const nameIn = (id: string) => shop().objects[id].name

test('knee is the first tested level where a shape is nearly out of capacity, and says which', () => {
  const run = ramp()
  const k = knee(run)
  assert.deepEqual(k, { index: 2, load: 400, by: { id: 'db', kind: 'util', share: 0.97 } })
  assert.equal(kneeText(run, k!, nameIn), 'First struggles at 400 req/s: Orders DB at 97% of capacity')
})

test('knee blames errors when failing calls are what is worst', () => {
  const run = structuredClone(ramp())
  run.levels[2].objects.api.errors = 0.05
  const k = knee(run)
  assert.deepEqual(k, { index: 2, load: 400, by: { id: 'api', kind: 'errors', share: 0.05 } })
  assert.equal(kneeText(run, k!, nameIn), 'First struggles at 400 req/s: API failing 5% of calls')
})

test('knee falls back to overall latency passing three times its starting point, with no shape to blame', () => {
  const run = structuredClone(ramp())
  for (const l of run.levels) l.objects = {}
  const k = knee(run)
  assert.deepEqual(k, { index: 2, load: 400, latency: { from: 100, to: 420 } })
  assert.equal(kneeText(run, k!, nameIn), 'First struggles at 400 req/s: the slowest 5% of calls go from 100 ms to 420 ms')
})

test('a run that never struggles has no knee', () => {
  const run = structuredClone(ramp())
  for (const l of run.levels) {
    l.objects = {}
    l.overall.p95 = 100
  }
  assert.equal(knee(run), undefined)
})

test('traffic turns a load into what each shape and line looks like', () => {
  const t = traffic(shop(), ramp(), 400, 'shop')
  assert.deepEqual(t.boxes.db, { strain: 0.97, queue: 0 })
  assert.deepEqual(t.boxes.api, { strain: 0.95, queue: 40 })
  assert.deepEqual(t.lines, [
    { from: 'web', to: 'api', width: 5.22, perSecond: 11.41, travelMs: 1345, failed: 0.08 },
    { from: 'api', to: 'db', width: 5.15, perSecond: 11.23, travelMs: 1278, failed: 0 },
  ])
})

test('traffic grows with load: more particles, thicker lines, slower trips', () => {
  const run = ramp()
  const low = traffic(shop(), run, 100, 'shop').lines[0]
  const high = traffic(shop(), run, 400, 'shop').lines[0]
  assert.ok(high.perSecond > low.perSecond && high.width > low.width && high.travelMs > low.travelMs)
})

test('traffic caps what a screen can draw, and floors a failure that would not show', () => {
  const { run } = parseRun('r', `name: R
levels:
  - load: 1
    connections: [{ from: web, to: api, rate: 1000000, p50: 100000, errors: 0.004 }, { from: auth, to: db, rate: 10, errors: 0.02 }, { from: orders, to: mail, p50: 10 }]
  - load: 2
    connections: [{ from: web, to: api, rate: 1000000, p50: 100000, errors: 0.004 }, { from: auth, to: db, rate: 10, errors: 0.02 }, { from: orders, to: mail, p50: 10 }]
`)
  const t = traffic(shop(), run, 1, 'shop')
  assert.deepEqual(t.boxes, {}) // nothing was measured on a shape, so none is drawn
  assert.deepEqual(t.lines, [
    { from: 'web', to: 'api', width: 6, perSecond: 14, travelMs: 4000, failed: 0 }, // capped; 0.4% failing is below what shows
    { from: 'api', to: 'db', width: 3.06, perSecond: 5.67, travelMs: 1000, failed: 0.05 }, // no p50: a middling trip; 2% failing shows as 5%
    // orders → mail has no rate, so no line of traffic
  ])
})

// ---- Colour, scale and key: a run's `source:`, the size of a call, and how a failing share fails

/** A run with two levels and `extra` between the unit and the levels, for the keys a run can add. */
const withSource = (extra: string, connections = '') => `name: R
unit: req/s
${extra}
levels:
  - load: 1
    connections: [${connections}]
  - load: 2
`
const problemsOf = (text: string) => parseRun('r', text).problems.map(p => p.message)

test('a source reads its colour and its two formulas', () => {
  const { run, problems } = parseRun('r', withSource('source: { color: blue, dot: rate / 50, size: bytes / 400 }'))
  assert.deepEqual(problems, [])
  assert.equal(run.source?.color, 'blue')
  assert.deepEqual(run.source, { color: 'blue', dot: { text: 'rate / 50' }, size: { text: 'bytes / 400' } })
  assert.deepEqual(JSON.parse(JSON.stringify(run)).source, run.source) // a run is data: it can go to the browser as JSON and back
  assert.equal(traffic(shop(), parseRun('r', 'name: R\nsource: { dot: rate / 50 }\nlevels:\n  - { load: 1, connections: [{ from: web, to: api, rate: 100 }] }\n  - { load: 2, connections: [{ from: web, to: api, rate: 100 }] }\n').run, 1, 'shop').lines[0].dots, 2)
})

test('every key of a source is optional, and a hex colour is as good as a name', () => {
  assert.deepEqual(parseRun('r', withSource('source: { color: "#1D9E75" }')).run.source, { color: '#1D9E75' })
  assert.equal(parseRun('r', withSource('source: { dot: "rate/20" }')).run.source?.color, undefined)
  assert.equal(parseRun('r', withSource('source: { dot: "rate/20" }')).run.source?.dot?.text, 'rate/20')
  assert.equal(parseRun('r', withSource('source:')).run.source, undefined) // an empty block says nothing
  assert.equal(parseRun('r', withSource('source: ~')).run.source, undefined)
  assert.equal(parseRun('r', withSource('source: {}')).run.source, undefined)
})

test('a source that is not a mapping, or has a key it does not know, is a problem that names it', () => {
  assert.deepEqual(problemsOf(withSource('source: 5')), ['source must be a mapping of color, dot and size'])
  assert.deepEqual(problemsOf(withSource('source: [blue]')), ['source must be a mapping of color, dot and size'])
  assert.deepEqual(problemsOf(withSource('source: { colour: blue }')), ['source: unknown key "colour" (use color, dot, size)'])
  assert.equal(parseRun('r', withSource('source: { colour: blue }')).run.source, undefined) // nothing usable was left
  assert.deepEqual(problemsOf(withSource('source: { color: blue, extra: 1, more: 2 }')), ['source: unknown key "extra" (use color, dot, size)', 'source: unknown key "more" (use color, dot, size)'])
  assert.equal(parseRun('r', withSource('source: { color: blue, extra: 1 }')).run.source?.color, 'blue') // the rest of the block still counts
})

test('a colour that is neither a name nor a hex is a problem, and a very long one is not echoed', () => {
  assert.deepEqual(problemsOf(withSource('source: { color: chartreuse }')), ['source: color must be a colour name or a hex such as #1d9e75'])
  assert.deepEqual(problemsOf(withSource('source: { color: "#12" }')), ['source: color must be a colour name or a hex such as #1d9e75'])
  assert.deepEqual(problemsOf(withSource('source: { color: [red] }')), ['source: color must be a colour name or a hex such as #1d9e75'])
  const long = parseRun('r', withSource(`source: { color: ${'x'.repeat(5000)} }`))
  assert.deepEqual(long.problems.map(p => p.message), ['source: color must be a colour name or a hex such as #1d9e75'])
  assert.equal(long.run.source, undefined)
})

test('a formula that cannot be read is a problem, and the source keeps the rest and falls back to the default curve', () => {
  const { run, problems } = parseRun('r', withSource('source: { color: green, dot: "rate *", size: "bytes / 0.5" }'))
  assert.deepEqual(problems.map(p => p.message), ['source: dot formula "rate *": unexpected end'])
  assert.equal(run.source?.color, 'green')
  assert.equal(run.source?.dot, undefined)
  assert.equal(run.source?.size?.text, 'bytes / 0.5')
})

const dotFormulas: [what: string, formula: string, message: string][] = [
  ['a division by zero, which reads fine and gives no value', 'rate / 0', ''],
  ['a unary minus, which reads fine', '-rate', ''],
  ['an unclosed bracket', '((rate)', 'source: dot formula "((rate)": missing ")"'],
  ['a trailing operator', 'rate / 50 + ', 'source: dot formula "rate / 50 + ": unexpected end'],
  ['an exponent', '1e3', 'source: dot formula "1e3": unexpected "e3" at 2'],
  ['a hex number', '0x10', 'source: dot formula "0x10": unexpected "x10" at 2'],
  ['a call', 'rate()', 'source: dot formula "rate()": unexpected "(" at 5'],
  ['two dots in a number', '1.2.3', 'source: dot formula "1.2.3": bad number "1.2.3" at 1'],
  ['a name it does not know', 'speed / 2', 'source: dot formula "speed / 2": unknown name "speed" (use rate, bytes, p50)'],
]
for (const [what, formula, message] of dotFormulas) {
  test(`a dot formula with ${what}`, () => {
    assert.deepEqual(problemsOf(withSource(`source: { dot: "${formula}" }`)), message === '' ? [] : [message])
  })
}

test('an empty formula says nothing, and one of 81 characters is a problem where one of 80 is read', () => {
  assert.deepEqual(problemsOf(withSource('source: { dot: "" }')), [])
  const eighty = `rate${' + 1'.repeat(19)}`
  assert.deepEqual(problemsOf(withSource(`source: { dot: "${eighty}" }`)), [])
  assert.deepEqual(problemsOf(withSource(`source: { dot: "${eighty} " }`)), [`source: dot formula "${`${eighty} `.slice(0, 40)}…": at most 80 characters`])
})

test('a formula that is not text is a problem', () => {
  assert.deepEqual(problemsOf(withSource('source: { dot: [rate] }')), ['source: dot must be a formula such as rate / 50'])
  assert.deepEqual(problemsOf(withSource('source: { size: { a: b } }')), ['source: size must be a formula such as bytes / 400'])
})

test('a hostile source key is data, never the prototype', () => {
  const { run, problems } = parseRun('r', 'name: R\nsource: { __proto__: x, constructor: y, color: red }\nlevels:\n  - load: 1\n  - load: 2\n')
  assert.deepEqual(problems.map(p => p.message), ['source: unknown key "__proto__" (use color, dot, size)', 'source: unknown key "constructor" (use color, dot, size)'])
  assert.deepEqual(run.source, { color: 'red' })
})

test('bytes is a connection number like rate: 0 or more, read as text', () => {
  const { run, problems } = parseRun('r', withSource('', '{ from: web, to: api, bytes: 400.5, rate: 3 }'))
  assert.deepEqual(problems, [])
  assert.deepEqual(run.levels[0].connections[0], { from: 'web', to: 'api', rate: 3, bytes: 400.5 })
  assert.deepEqual(problemsOf(withSource('', '{ from: web, to: api, bytes: big }, { from: auth, to: db, bytes: -3 }')), [
    'load 1, web → api: bytes must be a number',
    'load 1, auth → db: bytes must be 0 or more',
  ])
  assert.equal(parseRun('r', 'name: R\nlevels:\n  - { load: 1, overall: { bytes: 90 } }\n  - load: 2\n').run.levels[0].overall.bytes, 90)
})

test('failure says how a line fails: lost or rejected, nothing else', () => {
  const { run, problems } = parseRun('r', withSource('', '{ from: web, to: api, failure: lost }, { from: auth, to: db, failure: rejected }, { from: orders, to: db, failure: "" }'))
  assert.deepEqual(problems, [])
  assert.deepEqual(run.levels[0].connections, [
    { from: 'web', to: 'api', failure: 'lost' },
    { from: 'auth', to: 'db', failure: 'rejected' },
    { from: 'orders', to: 'db' },
  ])
  assert.deepEqual(problemsOf(withSource('', '{ from: web, to: api, failure: weird }, { from: auth, to: db, failure: [lost] }, { from: orders, to: db, failure: Lost }')), [
    'load 1, web → api: failure must be lost or rejected',
    'load 1, auth → db: failure must be lost or rejected',
    'load 1, orders → db: failure must be lost or rejected',
  ])
})

test('a run that uses none of the new keys reads to the run it always did', () => {
  const run = ramp()
  assert.deepEqual(Object.keys(run), ['name', 'about', 'unit', 'entry', 'levels'])
  assert.deepEqual(run.levels[2].connections[0], { from: 'web', to: 'api', rate: 300, p50: 60, p95: 200, errors: 0.08 })
  assert.deepEqual(Object.keys(run.levels[0].overall), ['rate', 'p50', 'p95', 'errors'])
})

/** Two levels where web → api lists bytes at both and a failure style at the first, and two connections land on api → db. */
const SIZED = `name: Sized
levels:
  - load: 100
    connections:
      - { from: web, to: api, rate: 10, bytes: 200, failure: lost }
      - { from: orders, to: db, rate: 50, bytes: 100, failure: lost }
      - { from: auth, to: db, rate: 150, bytes: 300, failure: lost }
  - load: 200
    connections:
      - { from: web, to: api, rate: 30, bytes: 600 }
      - { from: orders, to: db, rate: 50, bytes: 100, failure: lost }
      - { from: auth, to: db, rate: 150, bytes: 300, failure: lost }
`
const sized = () => parseRun('sized', SIZED).run

test('bytes is interpolated between tested levels like rate, and the failure style is the nearest one at or below', () => {
  const at150 = interpolate(sized(), 150).connections[0]
  assert.equal(at150.bytes, 400)
  assert.equal(at150.rate, 20)
  assert.equal(at150.failure, 'lost') // level 200 names none; level 100 does
  assert.equal(interpolate(sized(), 200).connections[0].failure, 'lost')
  assert.equal(Object.hasOwn(interpolate(ramp(), 150).connections[0], 'failure'), false)
  assert.equal(Object.hasOwn(interpolate(ramp(), 150).connections[0], 'bytes'), false)
})

test('a failure style named only at a higher level still counts below it', () => {
  const { run } = parseRun('r', 'name: R\nlevels:\n  - { load: 1, connections: [{ from: web, to: api, rate: 1 }] }\n  - { load: 2, connections: [{ from: web, to: api, rate: 2, failure: rejected }] }\n')
  assert.equal(interpolate(run, 1).connections[0].failure, 'rejected')
})

test('rollUp takes the mean bytes of the connections on a line, weighted by rate', () => {
  const lines = rollUp(shop(), sized().levels[0], 'shop').lines
  assert.equal(lines.find(l => l.from === 'api' && l.to === 'db')?.bytes, 250) // (100 * 50 + 300 * 150) / 200
  assert.equal(lines.find(l => l.from === 'web' && l.to === 'api')?.bytes, 200)
})

test('with no rates to weigh by, bytes is the plain mean; a connection with no bytes does not count', () => {
  const { run } = parseRun('r', 'name: R\nlevels:\n  - { load: 1, connections: [{ from: orders, to: db, bytes: 100 }, { from: auth, to: db, bytes: 300 }] }\n  - load: 2\n')
  assert.equal(rollUp(shop(), run.levels[0], 'shop').lines[0].bytes, 200)
  const { run: one } = parseRun('r', 'name: R\nlevels:\n  - { load: 1, connections: [{ from: orders, to: db, bytes: 100, rate: 5 }, { from: auth, to: db, rate: 5 }] }\n  - load: 2\n')
  assert.equal(rollUp(shop(), one.levels[0], 'shop').lines[0].bytes, 100)
  const { run: none } = parseRun('r', 'name: R\nlevels:\n  - { load: 1, connections: [{ from: orders, to: db, rate: 5 }] }\n  - load: 2\n')
  assert.equal(Object.hasOwn(rollUp(shop(), none.levels[0], 'shop').lines[0], 'bytes'), false)
})

test('rollUp keeps a failure style the connections on a line agree on, and drops it when they disagree', () => {
  assert.equal(rollUp(shop(), sized().levels[0], 'shop').lines.find(l => l.to === 'db')?.failure, 'lost')
  const mixed = structuredClone(sized())
  mixed.levels[0].connections[2].failure = 'rejected'
  assert.equal(Object.hasOwn(rollUp(shop(), mixed.levels[0], 'shop').lines.find(l => l.to === 'db')!, 'failure'), false)
  delete mixed.levels[0].connections[2].failure
  assert.equal(rollUp(shop(), mixed.levels[0], 'shop').lines.find(l => l.to === 'db')?.failure, 'lost') // one that names none does not veto
})

test('rollUp of an old run adds nothing to a line', () => {
  assert.deepEqual(Object.keys(rollUp(shop(), ramp().levels[2], 'shop').lines[0]), ['from', 'to', 'rate', 'p50', 'p95', 'errors'])
})

// ---- Traffic from a source: how many dots a line shows, how big each is, what colour, and when the screen says it is scaled down

/** Two lines in the shop view (web → api, and api → db with orders → db landing on it), at two loads, with `source` written between the unit and the levels. */
const scaled = (source: string, web = 'rate: 100, p50: 10', db = 'rate: 100, p50: 400') => parseRun('scaled', `name: Scaled
unit: req/s
${source}
levels:
  - load: 1
    connections: [{ from: web, to: api, ${web} }, { from: orders, to: db, ${db} }]
  - load: 2
    connections: [{ from: web, to: api, ${web} }, { from: orders, to: db, ${db} }]
`).run
const lineOf = (run: ReturnType<typeof scaled>, from: string, to: string, load = 1) => traffic(shop(), run, load, 'shop').lines.find(l => l.from === from && l.to === to)!

test('a dot formula says how many dots are on the line at once: rate / 50 is 2 at 100 calls a second and 20 at 1,000', () => {
  const run = parseRun('r', `name: R
source: { dot: rate / 50 }
levels:
  - { load: 1, connections: [{ from: web, to: api, rate: 100, p50: 100 }] }
  - { load: 2, connections: [{ from: web, to: api, rate: 1000, p50: 100 }] }
`).run
  const low = traffic(shop(), run, 1, 'shop').lines[0]
  const high = traffic(shop(), run, 2, 'shop').lines[0]
  assert.equal(low.dots, 2)
  assert.equal(high.dots, 20)
  assert.equal(low.capped, undefined)
  assert.ok(Math.abs(low.perSecond * (low.travelMs / 1000) - 2) < 0.02) // emitted so that, over the time a dot takes to cross, 2 are on the line
  assert.ok(Math.abs(high.perSecond * (high.travelMs / 1000) - 20) < 0.05)
})

test('two lines with equal rate but different p50 show the same number of dots, at different speeds', () => {
  const run = scaled('source: { dot: rate / 50 }')
  const fast = lineOf(run, 'web', 'api')
  const slow = lineOf(run, 'api', 'db')
  assert.equal(fast.dots, 2)
  assert.equal(slow.dots, 2)
  assert.ok(slow.travelMs > fast.travelMs * 2)
  assert.ok(fast.perSecond > slow.perSecond * 2) // the same dots cross faster, so more start each second
})

test('ten times the calls is ten times the dots, up to the cap', () => {
  const run = parseRun('r', `name: R
source: { dot: rate / 50 }
levels:
  - { load: 1, connections: [{ from: web, to: api, rate: 50, p50: 100 }, { from: orders, to: db, rate: 500, p50: 100 }] }
  - { load: 2, connections: [{ from: web, to: api, rate: 50, p50: 100 }, { from: orders, to: db, rate: 500, p50: 100 }] }
`).run
  const [a, b] = traffic(shop(), run, 1, 'shop').lines
  assert.equal(a.dots, 1)
  assert.equal(b.dots, 10)
})

test('past the cap a line is scaled down to AT_ONCE dots and says so, and a line under it is untouched', () => {
  assert.equal(AT_ONCE, 24)
  const run = scaled('source: { dot: rate / 50 }', 'rate: 1000000, p50: 100', 'rate: 600, p50: 100')
  const busy = lineOf(run, 'web', 'api')
  const calm = lineOf(run, 'api', 'db')
  assert.equal(busy.dots, AT_ONCE)
  assert.equal(busy.capped, true)
  assert.ok(Math.abs(busy.perSecond * (busy.travelMs / 1000) - AT_ONCE) < 0.05)
  assert.equal(calm.dots, 12)
  assert.equal(calm.capped, undefined)
})

test('a count at exactly the cap is not scaled down', () => {
  const run = scaled('source: { dot: rate / 50 }', 'rate: 1200, p50: 100', 'rate: 1250, p50: 100')
  assert.equal(lineOf(run, 'web', 'api').capped, undefined)
  assert.equal(lineOf(run, 'web', 'api').dots, 24)
  assert.equal(lineOf(run, 'api', 'db').capped, true)
  assert.equal(lineOf(run, 'api', 'db').dots, 24)
})

test('the sources on one line are scaled by one factor so their ratio stays true', () => {
  assert.deepEqual(capCounts([10, 5]), { counts: [10, 5], capped: false })
  assert.deepEqual(capCounts([24, 12]), { counts: [24, 12], capped: false })
  const huge = capCounts([1e307, 5e306]) // a count times AT_ONCE would overflow to Infinity: divide first
  assert.deepEqual(huge, { counts: [24, 12], capped: true })
  assert.deepEqual(capCounts([48, 12]), { counts: [24, 6], capped: true })
  assert.deepEqual(capCounts([6, 120]), { counts: [1.2, 24], capped: true })
  assert.deepEqual(capCounts([0, 0]), { counts: [0, 0], capped: false })
  assert.deepEqual(capCounts([]), { counts: [], capped: false })
})

test('a formula that asks for a huge count is capped, and the numbers stay finite', () => {
  const run = scaled('source: { dot: rate * 1000000 }', 'rate: 100000000, p50: 100', 'rate: 5, p50: 3000')
  for (const l of traffic(shop(), run, 1, 'shop').lines) {
    assert.equal(l.dots, AT_ONCE)
    assert.equal(l.capped, true)
    assert.ok(Number.isFinite(l.perSecond) && l.perSecond > 0 && l.perSecond <= AT_ONCE / 0.5) // at most the cap in the shortest crossing, 500 ms
  }
})

test('a dot formula with a missing input, a negative result or no value falls back to the default curve for that line', () => {
  const plain = traffic(shop(), scaled(''), 1, 'shop').lines
  for (const dot of ['bytes / 100', '-rate', 'rate / 0', 'rate * 0 - 1']) {
    const lines = traffic(shop(), scaled(`source: { dot: "${dot}" }`), 1, 'shop').lines
    assert.deepEqual(lines, plain, dot) // the same numbers as a run with no source at all
  }
})

test('one line can fall back while another follows the formula', () => {
  const run = scaled('source: { dot: bytes / 100 }', 'rate: 100, p50: 10, bytes: 500', 'rate: 100, p50: 10')
  const plain = traffic(shop(), scaled('', 'rate: 100, p50: 10, bytes: 500', 'rate: 100, p50: 10'), 1, 'shop').lines
  const lines = traffic(shop(), run, 1, 'shop').lines
  assert.equal(lines[0].dots, 5)
  assert.deepEqual(lines[1], plain[1]) // no bytes on this one
})

test('a line with no rate at some level has no traffic, not zero dots', () => {
  const run = parseRun('r', `name: R
source: { dot: rate / 50 }
levels:
  - { load: 1, connections: [{ from: web, to: api, p50: 10 }, { from: orders, to: db, rate: 100 }] }
  - { load: 2, connections: [{ from: web, to: api, p50: 10 }, { from: orders, to: db, rate: 100 }] }
`).run
  assert.deepEqual(traffic(shop(), run, 1, 'shop').lines.map(l => `${l.from} ${l.to}`), ['api db'])
})

test('a line that was measured at zero calls has zero dots', () => {
  const line = lineOf(scaled('source: { dot: rate / 50 }', 'rate: 0, p50: 10'), 'web', 'api')
  assert.equal(line.dots, 0)
  assert.equal(line.perSecond, 0)
})

test('a size formula is a dot area: the radius is its square root, between a small dot and a big one', () => {
  const run = (bytes: number) => scaled('source: { size: bytes / 400 }', `rate: 100, p50: 10, bytes: ${bytes}`)
  assert.equal(lineOf(run(400), 'web', 'api').radius, 1)
  assert.equal(lineOf(run(1600), 'web', 'api').radius, 2) // twice the radius, four times the area
  assert.equal(lineOf(run(100), 'web', 'api').radius, 0.5)
  assert.equal(lineOf(run(10), 'web', 'api').radius, RADIUS_MIN) // 0.158: no smaller than a small dot
  assert.equal(lineOf(run(100_000_000), 'web', 'api').radius, RADIUS_MAX)
  assert.equal(RADIUS_MIN, 0.5)
  assert.equal(RADIUS_MAX, 2.5)
})

test('a size with no bytes, or no value, leaves the dot at its usual size', () => {
  assert.equal(Object.hasOwn(lineOf(scaled('source: { size: bytes / 400 }'), 'web', 'api'), 'radius'), false)
  assert.equal(Object.hasOwn(lineOf(scaled('source: { size: "-bytes" }', 'rate: 5, bytes: 9'), 'web', 'api'), 'radius'), false)
  assert.equal(Object.hasOwn(lineOf(scaled('source: { size: bytes / 0 }', 'rate: 5, bytes: 9'), 'web', 'api'), 'radius'), false)
})

test('size and dots work together, and size does not change how many dots there are', () => {
  const run = scaled('source: { dot: rate / 50, size: bytes / 400 }', 'rate: 100, p50: 10, bytes: 1600')
  const line = lineOf(run, 'web', 'api')
  assert.equal(line.dots, 2)
  assert.equal(line.radius, 2)
})

test('the colour is the one written, on every line, whether or not a formula applies', () => {
  for (const line of traffic(shop(), scaled('source: { color: blue }'), 1, 'shop').lines) assert.equal(line.color, 'blue')
  for (const line of traffic(shop(), scaled('source: { color: "#1D9E75", dot: bytes / 100 }'), 1, 'shop').lines) assert.equal(line.color, '#1D9E75')
  for (const line of traffic(shop(), scaled('source: { dot: rate / 50 }'), 1, 'shop').lines) assert.equal(Object.hasOwn(line, 'color'), false)
})

test('a source with only a colour keeps the default curve: the numbers are those of a run with no source', () => {
  const withColor = traffic(shop(), scaled('source: { color: blue }'), 1, 'shop').lines
  const plain = traffic(shop(), scaled(''), 1, 'shop').lines
  assert.deepEqual(withColor.map(({ color, ...rest }) => rest), plain)
})

test('a line says how it fails when its connections do', () => {
  const run = parseRun('r', `name: R
levels:
  - { load: 1, connections: [{ from: web, to: api, rate: 10, errors: 0.2, failure: lost }, { from: orders, to: db, rate: 10, errors: 0.2 }] }
  - { load: 2, connections: [{ from: web, to: api, rate: 10, errors: 0.2, failure: lost }, { from: orders, to: db, rate: 10, errors: 0.2 }] }
`).run
  const [web, db] = traffic(shop(), run, 1, 'shop').lines
  assert.equal(web.failure, 'lost')
  assert.equal(web.failed, 0.2)
  assert.equal(Object.hasOwn(db, 'failure'), false)
})

test('an old run draws exactly what it did: no new key on a line', () => {
  for (const line of traffic(shop(), ramp(), 250, 'shop').lines) assert.deepEqual(Object.keys(line), ['from', 'to', 'width', 'perSecond', 'travelMs', 'failed'])
})

test('the scale in words is said only for a formula that is a constant times rate', () => {
  assert.equal(scaleText(scaled('source: { dot: rate / 50 }')), '1 dot = 50 calls/s')
  assert.equal(scaleText(scaled('source: { dot: rate * 2 }')), '1 dot = 0.5 calls/s')
  assert.equal(scaleText(scaled('source: { dot: rate / 3 }')), '1 dot = 3 calls/s')
  assert.equal(scaleText(scaled('source: { dot: rate / 12.5 }')), '1 dot = 12.5 calls/s')
  assert.equal(scaleText(scaled('source: { dot: "rate / 50 + 1" }')), undefined)
  assert.equal(scaleText(scaled('source: { dot: bytes / 400 }')), undefined)
  assert.equal(scaleText(scaled('source: { dot: "rate / 1000000000000" }')), undefined) // not a scale anyone reads
  assert.equal(scaleText(scaled('source: { color: red }')), undefined)
  assert.equal(scaleText(scaled('')), undefined)
})

test('the key has the pieces the source puts on screen, and only those', () => {
  const run = scaled('source: { color: blue, dot: rate / 50, size: bytes / 400 }', 'rate: 100, p50: 10, bytes: 800')
  const lines = traffic(shop(), run, 1, 'shop').lines
  assert.deepEqual(sourceKey(run, lines), { name: 'Scaled', color: 'blue', scale: '1 dot = 50 calls/s', bigger: true, scaledDown: false })
  const capped = traffic(shop(), scaled('source: { color: blue, dot: rate / 50 }', 'rate: 99999'), 1, 'shop').lines
  assert.deepEqual(sourceKey(scaled('source: { color: blue, dot: rate / 50 }'), capped), { name: 'Scaled', color: 'blue', scale: '1 dot = 50 calls/s', bigger: false, scaledDown: true })
})

test('the key says nothing of a source that has nothing on screen, or no source at all', () => {
  assert.equal(sourceKey(scaled(''), traffic(shop(), scaled(''), 1, 'shop').lines), undefined)
  const run = scaled('source: { color: blue, dot: rate / 50 }')
  assert.equal(sourceKey(run, []), undefined)
  assert.equal(sourceKey(run, traffic(shop(), run, 1, 'root').lines), undefined) // the overview folds the lines into one box
})

test('a key with a colour only is a dot and a name', () => {
  const run = scaled('source: { color: teal }')
  assert.deepEqual(sourceKey(run, traffic(shop(), run, 1, 'shop').lines), { name: 'Scaled', color: 'teal', bigger: false, scaledDown: false })
})

test('a run that went through JSON, as one does on its way to the browser, draws the same traffic and says the same key', () => {
  const run = scaled('source: { color: blue, dot: rate / 50, size: bytes / 400 }', 'rate: 100, p50: 10, bytes: 800')
  const sent: typeof run = JSON.parse(JSON.stringify(run))
  assert.deepEqual(traffic(shop(), sent, 1, 'shop'), traffic(shop(), run, 1, 'shop'))
  assert.equal(scaleText(sent), '1 dot = 50 calls/s')
  assert.deepEqual(sourceKey(sent, traffic(shop(), sent, 1, 'shop').lines), sourceKey(run, traffic(shop(), run, 1, 'shop').lines))
})

// ---- Runs over time

/** The spec's outage: levels at 0, 45 and 120 seconds, and Stripe killed, restarted and answering again at 40, 70 and 85 (written out of order on purpose). */
const OUTAGE = `name: Payments killed at 40 s
axis: time
unit: s
events:
  - { at: 85, on: stripe, state: running, text: Answers again }
  - { at: 40, on: stripe, state: stopped, text: Payments killed }
  - { at: 70, on: stripe, state: starting, text: Restart begins }
levels:
  - at: 0
    overall: { rate: 98, p50: 60, p95: 140, errors: 0 }
    objects:
      stripe: { util: 0.4 }
  - at: 45
    objects:
      stripe: { util: 0 }
      api: { util: 0.9, errors: 0.6 }
  - at: 120
`
const outage = () => parseRun('outage', OUTAGE).run
/** The shop with a Stripe shape, which the outage's events name. */
const withStripe = () => ({ ...shop(), objects: { ...shop().objects, stripe: { type: 'system' as const, name: 'Stripe' } } })

test('a time run reads its axis, its times and its events, in time order', () => {
  const { run, problems } = parseRun('outage', OUTAGE)
  assert.deepEqual(problems, [])
  assert.equal(run.axis, 'time')
  assert.equal(run.unit, 's')
  assert.deepEqual(run.levels.map(l => l.load), [0, 45, 120]) // a time run's levels keep their time in `load`
  assert.deepEqual(run.events, [
    { at: 40, on: 'stripe', state: 'stopped', text: 'Payments killed' },
    { at: 70, on: 'stripe', state: 'starting', text: 'Restart begins' },
    { at: 85, on: 'stripe', state: 'running', text: 'Answers again' },
  ])
  assert.deepEqual(run.levels[1].objects.stripe, { util: 0 })
})

test('a time run with no unit counts seconds, and a load run still counts plain "load"', () => {
  assert.equal(parseRun('r', 'name: R\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n').run.unit, 's')
  assert.equal(parseRun('r', 'name: R\nlevels:\n  - load: 1\n  - load: 2\n').run.unit, 'load')
})

test('the state at a time is the latest event at or before it, and Running stays an entry of its own', () => {
  const run = outage()
  assert.deepEqual(runStates(run, -1), {})
  assert.deepEqual(runStates(run, 0), {})
  assert.deepEqual(runStates(run, 39), {})
  assert.deepEqual(runStates(run, 39.999), {})
  assert.deepEqual(runStates(run, 40), { stripe: 'stopped' })
  assert.deepEqual(runStates(run, 60), { stripe: 'stopped' })
  assert.deepEqual(runStates(run, 70), { stripe: 'starting' })
  assert.deepEqual(runStates(run, 85), { stripe: 'running' })
  assert.deepEqual(runStates(run, 120), { stripe: 'running' })
  assert.deepEqual(runStates(run, Number.NaN), {})
})

test('eventsPassed gives the events at or before a time, in time order', () => {
  const run = outage()
  assert.deepEqual(eventsPassed(run, 39).map(e => e.at), [])
  assert.deepEqual(eventsPassed(run, 40).map(e => e.at), [40])
  assert.deepEqual(eventsPassed(run, 84.9).map(e => e.at), [40, 70])
  assert.deepEqual(eventsPassed(run, 1000).map(e => e.at), [40, 70, 85])
  assert.deepEqual(eventsPassed(run, Number.NaN), [])
})

test('two events for one shape at one time: the later one in the file wins', () => {
  const { run } = parseRun('r', 'name: R\naxis: time\nevents:\n  - { at: 5, on: a, state: stopped }\n  - { at: 5, on: a, state: degraded }\n  - { at: 5, on: b, state: starting }\n  - { at: 9, on: a, state: running }\n  - { at: 9, on: a, state: stopping }\nlevels:\n  - at: 0\n  - at: 10\n')
  assert.deepEqual(runStates(run, 5), { a: 'degraded', b: 'starting' })
  assert.deepEqual(runStates(run, 9), { a: 'stopping', b: 'starting' })
})

test('an event at exactly the first or last time is kept, and one a millisecond outside is a problem', () => {
  const text = (first: string, last: string) => `name: R\naxis: time\nunit: s\nevents:\n  - { at: ${first}, on: a, state: stopped }\n  - { at: ${last}, on: a, state: running }\nlevels:\n  - at: 0\n  - at: 150\n`
  const edges = parseRun('r', text('0', '150'))
  assert.deepEqual(edges.problems, [])
  assert.deepEqual(edges.run.events?.map(e => e.at), [0, 150])
  assert.deepEqual(runStates(edges.run, 0), { a: 'stopped' })
  const out = parseRun('r', text('-0.001', '150.001'))
  assert.equal(out.run.events, undefined)
  assert.deepEqual(out.problems.map(p => p.message), [
    'event 1: at -0.001 is outside the run (0 to 150 s)',
    'event 2: at 150.001 is outside the run (0 to 150 s)',
  ])
})

/** What a run can get wrong about its axis and events, and the one problem that tells the author. Each run still loads. */
const slips: [what: string, text: string, said: string[]][] = [
  ['a level with load where the run is over time', 'name: R\naxis: time\nlevels:\n  - at: 0\n  - load: 5\n', ['level 2: a time run uses at, not load']],
  ['a level with at where the run is over load', 'name: R\nlevels:\n  - load: 1\n  - at: 5\n', ['level 2: a load run uses load, not at']],
  ['both keys on a level', 'name: R\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n    load: 9\n', ['level 2: a time run uses at, not load']],
  ['an axis that is neither', 'name: R\naxis: weird\nlevels:\n  - load: 1\n  - load: 2\n', ['axis must be load or time']],
  ['an axis that is a number', 'name: R\naxis: 5\nlevels:\n  - load: 1\n  - load: 2\n', ['axis must be load or time']],
  ['an axis that is a list', 'name: R\naxis: [time]\nlevels:\n  - load: 1\n  - load: 2\n', ['axis must be load or time']],
  ['events on a load run', 'name: R\nevents:\n  - { at: 1, on: a, state: stopped }\nlevels:\n  - load: 1\n  - load: 2\n', ['events are only for a time run (set axis: time)']],
  ['events that are not a list', 'name: R\naxis: time\nevents: { at: 1 }\nlevels:\n  - at: 0\n  - at: 2\n', ['events must be a list']],
  ['an event that is not a mapping', 'name: R\naxis: time\nevents: [soon]\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1 must be a mapping of at, on, state and text']],
  ['an event with no time', 'name: R\naxis: time\nevents:\n  - { on: a, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1: at must be a number']],
  ['an event with a time that is a word', 'name: R\naxis: time\nevents:\n  - { at: soon, on: a, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1: at must be a number']],
  ['an event with no shape', 'name: R\naxis: time\nevents:\n  - { at: 1, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1: on must name a shape']],
  ['an event with an unknown state', 'name: R\naxis: time\nevents:\n  - { at: 1, on: a, state: asleep }\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1: unknown state "asleep" (use running, starting, stopping, stopped, restarting, degraded)']],
  ['an event with no state', 'name: R\naxis: time\nevents:\n  - { at: 1, on: a }\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1: state needs a state word (use running, starting, stopping, stopped, restarting, degraded)']],
  ['an event with text that is a list', 'name: R\naxis: time\nevents:\n  - { at: 1, on: a, state: stopped, text: [x] }\nlevels:\n  - at: 0\n  - at: 2\n', ['event 1: text must be plain text']],
]
for (const [what, text, said] of slips) {
  test(`${what} is a problem for the author, and the run still loads`, () => {
    const { run, problems } = parseRun('r', text)
    assert.deepEqual(problems.map(p => p.message), said)
    assert.ok(problems.every(p => p.file === 'perf/r.yaml'))
    assert.ok(run.levels.length >= 2)
  })
}

test('a slip in an event leaves that event out and keeps the others; a slip in the text only keeps the event', () => {
  const { run } = parseRun('r', 'name: R\naxis: time\nevents:\n  - { at: 1, on: a, state: asleep }\n  - { at: 2, on: a, state: stopped }\n  - { at: 3, on: a, state: running, text: [x] }\n  - nope\nlevels:\n  - at: 0\n  - at: 4\n')
  assert.deepEqual(run.events, [{ at: 2, on: 'a', state: 'stopped', text: '' }, { at: 3, on: 'a', state: 'running', text: '' }])
})

test('a wrong key still gives the level its number, so a time run with load levels still plays', () => {
  const { run } = parseRun('r', 'name: R\naxis: time\nlevels:\n  - load: 0\n  - load: 5\n')
  assert.deepEqual(run.levels.map(l => l.load), [0, 5])
})

test('a time run is as strict as a load run about the time of a level', () => {
  assert.equal(parseRun('r', 'name: R\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n').run.events, undefined)
  assert.throws(() => parseRun('r', 'name: R\naxis: time\nlevels:\n  - at: 0\n  - objects: {}\n'), (e: unknown) => e instanceof ParseError && e.reason.includes('level 2: at must be a number, 0 or more'))
  assert.throws(() => parseRun('r', 'name: R\naxis: time\nlevels:\n  - at: 5\n  - at: 5\n'), (e: unknown) => e instanceof ParseError && e.reason.includes('level 2: at 5 must be above 5 (levels go up in time)'))
})

test('a run that says axis: load reads to the run it always did, and a time run adds only its axis and events', () => {
  assert.deepEqual(parseRun('ramp', `axis: load\n${RAMP}`).run, ramp())
  assert.deepEqual(Object.keys(parseRun('r', 'name: R\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n').run), ['name', 'unit', 'axis', 'levels'])
})

test('a shape called __proto__ in an event is data, never the prototype', () => {
  const { run } = parseRun('r', 'name: R\naxis: time\nevents:\n  - { at: 1, on: __proto__, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n')
  const states = runStates(run, 1)
  assert.deepEqual(Object.keys(states), ['__proto__'])
  assert.equal(Object.getPrototypeOf(states), Object.prototype)
  assert.equal(({} as Record<string, unknown>).state, undefined)
})

test('checkRun reports an event that names a shape the model does not have, once', () => {
  const { run } = parseRun('r', 'name: R\naxis: time\nevents:\n  - { at: 1, on: ghost, state: stopped }\n  - { at: 2, on: ghost, state: running }\n  - { at: 3, on: stripe, state: stopped }\nlevels:\n  - at: 0\n  - at: 4\n')
  assert.deepEqual(checkRun('r', run, withStripe()).map(p => p.message), ['unknown object "ghost"'])
  assert.deepEqual(checkRun('outage', outage(), withStripe()), [])
})

test('an event says what it wrote, or the shape and the state', () => {
  const [stopped, , running] = outage().events ?? []
  const name = (id: string) => (id === 'stripe' ? 'Stripe' : id)
  assert.equal(eventText(stopped, name), 'Payments killed')
  assert.equal(eventText(running, name), 'Answers again')
  const bare = parseRun('r', 'name: R\naxis: time\nevents:\n  - { at: 1, on: stripe, state: restarting }\n  - { at: 2, on: stripe, state: degraded, text: "  " }\nlevels:\n  - at: 0\n  - at: 3\n').run.events ?? []
  assert.deepEqual(bare.map(e => eventText(e, name)), ['Stripe: Restarting', 'Stripe: Degraded'])
})

test('a time run that went through JSON, as one does on its way to the browser, says the same states', () => {
  const sent: ReturnType<typeof outage> = JSON.parse(JSON.stringify(outage()))
  assert.deepEqual(runStates(sent, 70), runStates(outage(), 70))
  assert.deepEqual(eventsPassed(sent, 70), eventsPassed(outage(), 70))
})

test('a load run has no events and no states', () => {
  assert.deepEqual(eventsPassed(ramp(), 200), [])
  assert.deepEqual(runStates(ramp(), 200), {})
})

test('a time run plays through interpolate and knee like any run', () => {
  const run = outage()
  assert.equal(interpolate(run, 22.5).objects.stripe.util, 0.2)
  assert.equal(interpolate(run, 200).load, 120) // clamped to the last time, as ever
  assert.equal(knee(run)?.load, 45) // api is failing at 45 s
  assert.equal(kneeText(run, knee(run)!, id => id), 'First struggles at 45 s: api failing 60% of calls')
})

test('a size that overflows when weighted by the rate is no number, not Infinity', () => {
  const m = shop()
  const { from, to } = m.connections[0]
  const level = { load: 1, overall: {}, objects: {}, connections: [{ from, to, rate: 1e308, bytes: 1e308 }, { from, to, rate: 1e308, bytes: 1e308 }] }
  const lines = rollUp(m, level, 'root').lines
  assert.ok(lines.length > 0)
  assert.equal(lines[0].bytes, undefined)
})
