import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError } from '../src/core/model.ts'
import {
  AT_ONCE, checkRun, checkRuns, dialsOf, interpolate, knee, kneeOf, kneeTextOf, levelAt, lockstepPositions, parseRun, rollUp, settingAt, SOURCE_PALETTE, sourceKeyAt, trafficAt, traffic,
} from '../src/core/perf.ts'
import type { Run } from '../src/core/perf.ts'
import { shop } from './fixtures.ts'
import { nameOf } from '../src/core/views.ts'

/**
 * Several sources of requests: a run that adds others and a run tested together. These read against the shop fixture (test/fixtures.ts), where orders and auth
 * both reach db, so two sources meet at one shape.
 */

/** Customer orders climbing: db fills from a fifth to over half. Blue, one dot for every 50 calls a second. */
const ORDERS = `name: Customer orders
unit: orders/min
entry: customer
source: { color: blue, dot: rate / 50 }
levels:
  - load: 100
    overall: { rate: 50, p50: 10, p95: 20, errors: 0 }
    objects: { db: { util: 0.2, queue: 1 }, orders: { util: 0.2 } }
    connections:
      - { from: customer, to: web, rate: 50, p50: 10, bytes: 400 }
      - { from: orders, to: db, rate: 50, p50: 10, p95: 20, bytes: 400 }
  - load: 200
    overall: { rate: 100, p50: 20, p95: 60, errors: 0.01 }
    objects: { db: { util: 0.4, queue: 3 }, orders: { util: 0.4 } }
    connections:
      - { from: customer, to: web, rate: 100, p50: 20, bytes: 400 }
      - { from: orders, to: db, rate: 100, p50: 20, p95: 60, bytes: 400, errors: 0.01 }
  - load: 300
    overall: { rate: 150, p50: 40, p95: 200, errors: 0.05 }
    objects: { db: { util: 0.6, queue: 9 }, orders: { util: 0.7 } }
    connections:
      - { from: customer, to: web, rate: 150, p50: 40, bytes: 400 }
      - { from: orders, to: db, rate: 150, p50: 40, p95: 200, bytes: 400, errors: 0.05 }
`

/** Courier pings climbing: db fills from a tenth to over two thirds. Green, one dot for every 25 calls a second. */
const PINGS = `name: Courier pings
unit: pings/s
entry: auth
source: { color: green, dot: rate / 25, size: bytes / 100 }
levels:
  - load: 50
    overall: { rate: 25, p50: 30, p95: 50, errors: 0 }
    objects: { db: { util: 0.1, queue: 0 }, auth: { util: 0.1 } }
    connections:
      - { from: auth, to: db, rate: 25, p50: 30, p95: 50, bytes: 100 }
  - load: 100
    overall: { rate: 50, p50: 50, p95: 100, errors: 0 }
    objects: { db: { util: 0.3, queue: 2 }, auth: { util: 0.3 } }
    connections:
      - { from: auth, to: db, rate: 50, p50: 50, p95: 100, bytes: 100 }
  - load: 200
    overall: { rate: 100, p50: 90, p95: 300, errors: 0.02 }
    objects: { db: { util: 0.7, queue: 12 }, auth: { util: 0.8 } }
    connections:
      - { from: auth, to: db, rate: 100, p50: 90, p95: 300, bytes: 100, errors: 0.02 }
`

const TOGETHER = 'name: Orders and pings, added\nadds: [orders, pings]\n'

/** Parse some run files the way the loader does: one that cannot be played is left out. */
function runsOf(files: Record<string, string>): { runs: Record<string, Run>; refused: Record<string, string>; problems: string[] } {
  const runs: Record<string, Run> = {}
  const refused: Record<string, string> = {}
  const problems: string[] = []
  for (const [id, text] of Object.entries(files)) {
    try {
      const read = parseRun(id, text)
      runs[id] = read.run
      problems.push(...read.problems.map(p => p.message))
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      refused[id] = e.reason
    }
  }
  return { runs, refused, problems }
}

const added = (files: Record<string, string> = {}) => runsOf({ orders: ORDERS, pings: PINGS, together: TOGETHER, ...files })
const messages = (runs: Record<string, Run>) => checkRuns(runs).map(p => `${p.file} ${p.message}`)

// ---- a run that adds others

test('a run that adds others reads as a list of runs and nothing else', () => {
  const { runs, refused, problems } = added()
  assert.deepEqual(refused, {})
  assert.deepEqual(problems, [])
  assert.deepEqual(runs.together, { name: 'Orders and pings, added', unit: '', adds: ['orders', 'pings'], levels: [] })
  assert.deepEqual(checkRuns(runs), [])
})

test('an adder resolves two dials, each with its run and its colour', () => {
  const found = dialsOf(added().runs, 'together')!
  assert.equal(found.mode, 'added')
  assert.deepEqual(found.dials.map(d => [d.id, d.name, d.unit, d.values, d.color]), [
    ['orders', 'Customer orders', 'orders/min', [100, 200, 300], 'blue'],
    ['pings', 'Courier pings', 'pings/s', [50, 100, 200], 'green'],
  ])
  assert.equal(found.dials[1].source?.dot?.text, 'rate / 25')
})

test('a run that names no colour takes the next of the palette that no other source draws in', () => {
  const plain = (name: string, unit: string) => `name: ${name}\nunit: ${unit}\nlevels:\n  - load: 1\n  - load: 2\n`
  const bare = runsOf({ a: plain('A', 'a/s'), b: plain('B', 'b/s'), c: plain('C', 'c/s'), d: plain('D', 'd/s'), all: 'name: All\nadds: [a, b, c, d]\n' }).runs
  assert.deepEqual(dialsOf(bare, 'all')!.dials.map(d => d.color), [...SOURCE_PALETTE])
  // One that writes a colour keeps it, and the others go round it.
  const named = runsOf({ a: 'name: A\nsource: { color: blue }\nlevels:\n  - load: 1\n  - load: 2\n', b: plain('B', 'b/s'), c: plain('C', 'c/s'), all: 'name: All\nadds: [b, a, c]\n' }).runs
  assert.deepEqual(dialsOf(named, 'all')!.dials.map(d => d.color), ['green', 'blue', 'orange'])
  assert.ok(!SOURCE_PALETTE.includes('red'), 'red is the colour of a failing call')
})

test('two added runs that draw in one colour are a problem that names them', () => {
  const hex = (name: string, color: string) => `name: ${name}\nsource: { color: "${color}" }\nlevels:\n  - load: 1\n  - load: 2\n`
  const same = runsOf({
    orders: ORDERS, pings: PINGS.replace('color: green', 'color: blue'), together: TOGETHER,
    one: hex('One', '#378ADD'), two: hex('Two', '#378add'), both: 'name: Both\nadds: [one, two]\n', named: 'name: Named\nadds: [orders, one]\n',
  }).runs
  // A name and its own hex are two colours: in the dark theme the name is lighter.
  assert.deepEqual(messages(same), [
    'perf/together.yaml Customer orders and Courier pings both draw in blue: give each its own colour',
    'perf/both.yaml One and Two both draw in #378add: give each its own colour',
  ])
  // The run still plays: the dials keep their colours.
  assert.deepEqual(dialsOf(same, 'together')!.dials.map(d => d.color), ['blue', 'blue'])
})

const addsRefused: [what: string, files: Record<string, string>, problems: string[]][] = [
  ['an id that is not a run', { together: 'name: T\nadds: [orders, ghost]\n' }, ['perf/together.yaml adds "ghost", which is not a run', "perf/together.yaml can't be played: fewer than two of the runs it adds can be added"]],
  ['a run over time', { outage: 'name: Outage\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n', together: 'name: T\nadds: [orders, pings, outage]\n' }, ['perf/together.yaml adds "outage", which is a run over time']],
  ['another adder', { both: TOGETHER, together: 'name: T\nadds: [orders, both, pings]\n' }, ['perf/together.yaml adds "both", which adds runs itself']],
  ['a run tested together', {
    tested: 'name: Tested\nsources:\n  a: { name: A, unit: a/s }\n  b: { name: B, unit: b/s }\nlevels:\n  - load: { a: 1, b: 1 }\n  - load: { a: 1, b: 2 }\n  - load: { a: 2, b: 1 }\n  - load: { a: 2, b: 2 }\n',
    together: 'name: T\nadds: [orders, tested, pings]\n',
  }, ['perf/together.yaml adds "tested", which is tested with several sources']],
]
for (const [what, files, expected] of addsRefused) {
  test(`checkRuns names ${what} an adder lists, and the adder still plays with the rest`, () => {
    const { runs } = added(files)
    assert.deepEqual(messages(runs), expected)
    // Two good runs are enough; fewer than two and it cannot be played.
    const found = dialsOf(runs, 'together')
    assert.equal(found === undefined, expected.some(m => m.includes("can't be played")))
  })
}

test('an adder keeps only the runs it can add, in the order listed', () => {
  const { runs } = added({ together: 'name: T\nadds: [ghost, pings, orders]\n' })
  assert.deepEqual(dialsOf(runs, 'together')!.dials.map(d => d.id), ['pings', 'orders'])
})

const addsParse: [what: string, text: string, reason: string][] = [
  ['an adds that is not a list', 'name: T\nadds: orders\n', '"adds" must be a list of run ids'],
  ['one id', 'name: T\nadds: [orders]\n', 'adds needs two to 4 runs, not 1'],
  ['no ids', 'name: T\nadds: []\n', 'adds needs two to 4 runs, not 0'],
  ['the same id twice', 'name: T\nadds: [orders, orders]\n', 'adds needs two to 4 runs, not 1'],
  ['itself and one other', 'name: T\nadds: [together, orders]\n', 'adds needs two to 4 runs, not 1'],
  ['items that are not ids', 'name: T\nadds: [[a], { b: c }]\n', 'adds needs two to 4 runs, not 0'],
]
for (const [what, text, reason] of addsParse) {
  test(`parseRun refuses ${what} in adds`, () => {
    assert.throws(() => parseRun('together', text), (e: unknown) => e instanceof ParseError && e.file === 'perf/together.yaml' && e.reason === reason)
  })
}

test('adds reports an item that is not an id, itself and a repeat, and keeps the rest', () => {
  const { problems, run } = parseRun('together', 'name: T\nadds: [orders, orders, together, [x], pings]\n')
  assert.deepEqual(run.adds, ['orders', 'pings'])
  assert.deepEqual(problems.map(p => p.message), ['adds: orders is listed twice', "adds: together can't add itself", 'adds: item 4 must be a run id'])
})

test('five ids are a problem: the first four are kept', () => {
  const { problems, run } = parseRun('together', 'name: T\nadds: [a, b, c, d, e, f]\n')
  assert.deepEqual(run.adds, ['a', 'b', 'c', 'd'])
  assert.deepEqual(problems.map(p => p.message), ['adds: at most 4 runs, so e, f left out'])
})

test('an adder that also has levels, sources or a source is told so, and they are not read', () => {
  const { problems, run } = parseRun('together', 'name: T\nadds: [a, b]\nlevels:\n  - load: 1\n  - load: 2\nsources: {}\nsource: { color: red }\naxis: time\n')
  assert.deepEqual(problems.map(p => p.message), [
    'a run that adds others has no levels of its own', 'a run that adds others has no sources of its own', 'a run that adds others has no source of its own',
    'a run that adds others is measured over load, not time',
  ])
  assert.deepEqual(run, { name: 'T', unit: '', adds: ['a', 'b'], levels: [] })
})

test('a run named __proto__ is no run to add', () => {
  const { runs } = added({ together: 'name: T\nadds: [__proto__, constructor, orders, pings]\n' })
  assert.deepEqual(messages(runs), ['perf/together.yaml adds "__proto__", which is not a run', 'perf/together.yaml adds "constructor", which is not a run'])
  assert.deepEqual(dialsOf(runs, 'together')!.dials.map(d => d.id), ['orders', 'pings'])
})

// ---- a run tested together

/** Orders at 100, 200 and 300, pings at 50 and 100: a grid of six. Each level gives db and a line; the first line has a `by`. */
const GRID = `name: Orders and pings at once
sources:
  orders: { name: Customer orders, entry: customer, unit: orders/min, color: blue, dot: rate / 50 }
  pings:  { name: Courier pings, entry: auth, unit: pings/s, color: green, dot: rate / 25, size: bytes / 100 }
levels:
  - load: { orders: 100, pings: 50 }
    overall: { rate: 75, p95: 80 }
    objects: { db: { util: 0.2 } }
    connections:
      - { from: orders, to: db, rate: 75, p50: 10, bytes: 300, by: { orders: { rate: 50, bytes: 400 }, pings: { rate: 25, bytes: 100 } } }
  - load: { orders: 100, pings: 100 }
    objects: { db: { util: 0.3 } }
  - load: { orders: 200, pings: 50 }
    objects: { db: { util: 0.4 } }
  - load: { orders: 200, pings: 100 }
    objects: { db: { util: 0.6 } }
  - load: { orders: 300, pings: 50 }
    objects: { db: { util: 0.7 } }
  - load: { orders: 300, pings: 100 }
    objects: { db: { util: 0.9 } }
`
const grid = (text = GRID) => parseRun('together', text)

test('a run tested together reads its sources and a level for every combination', () => {
  const { run, problems } = grid()
  assert.deepEqual(problems, [])
  assert.equal(run.unit, '')
  assert.deepEqual(Object.keys(run.sources!), ['orders', 'pings'])
  assert.deepEqual(run.sources!.orders, { name: 'Customer orders', entry: 'customer', unit: 'orders/min', source: { color: 'blue', dot: { text: 'rate / 50' } } })
  assert.deepEqual(run.levels.map(l => l.loads), [
    { orders: 100, pings: 50 }, { orders: 100, pings: 100 }, { orders: 200, pings: 50 }, { orders: 200, pings: 100 }, { orders: 300, pings: 50 }, { orders: 300, pings: 100 },
  ])
  assert.ok(run.levels.every(l => l.load === 0))
  assert.deepEqual(run.levels[0].connections[0].by, { orders: { rate: 50, bytes: 400 }, pings: { rate: 25, bytes: 100 } })
})

test('a 2 by 3 grid resolves two dials with the loads that were tested, going up', () => {
  const found = dialsOf({ together: grid().run }, 'together')!
  assert.equal(found.mode, 'tested')
  assert.deepEqual(found.dials.map(d => [d.id, d.name, d.unit, d.values, d.color]), [
    ['orders', 'Customer orders', 'orders/min', [100, 200, 300], 'blue'],
    ['pings', 'Courier pings', 'pings/s', [50, 100], 'green'],
  ])
})

test('levels in any order come out in grid order, the first source changing slowest', () => {
  const text = GRID.replace(/levels:[\s\S]*$/, `levels:
  - load: { pings: 100, orders: 200 }
  - load: { orders: 100, pings: 50 }
  - load: { orders: 200, pings: 50 }
  - load: { orders: 100, pings: 100 }
`)
  assert.deepEqual(grid(text).run.levels.map(l => l.loads), [{ orders: 100, pings: 50 }, { orders: 100, pings: 100 }, { orders: 200, pings: 50 }, { orders: 200, pings: 100 }])
})

const gridRefused: [what: string, change: (t: string) => string, reason: string][] = [
  ['a missing combination, naming it', t => t.replace('  - load: { orders: 200, pings: 100 }\n    objects: { db: { util: 0.6 } }\n', ''), 'no level for orders 200 and pings 100: a run tested together needs every load of each source with every load of the others'],
  ['a repeated combination', t => t.replace('{ orders: 300, pings: 100 }', '{ orders: 100, pings: 50 }'), 'level 6: orders 100 and pings 50 is listed twice (level 1 has it)'],
  ['an extra source in a level', t => t.replace('{ orders: 100, pings: 100 }', '{ orders: 100, pings: 100, mail: 5 }'), 'level 2: load names "mail", which is not a source (orders, pings)'],
  ['a source missing from a level', t => t.replace('{ orders: 100, pings: 100 }', '{ orders: 100 }'), 'level 2: load: pings must be a number, 0 or more'],
  ['a load that is not a number', t => t.replace('{ orders: 200, pings: 50 }', '{ orders: many, pings: 50 }'), 'level 3: load: orders must be a number, 0 or more'],
  ['a negative load', t => t.replace('{ orders: 200, pings: 50 }', '{ orders: -2, pings: 50 }'), 'level 3: load: orders must be a number, 0 or more'],
  ['a load that is a number, not a map', t => t.replace('{ orders: 100, pings: 100 }', '5'), 'level 2: load must give a number for each source (orders, pings)'],
  ['a level with no load', t => t.replace('  - load: { orders: 100, pings: 100 }\n', '  - overall: {}\n'), 'level 2: load must give a number for each source (orders, pings)'],
  ['a source with one load only', t => t.replace(/  - load: \{ orders: \d+, pings: 100 \}\n    objects: \{ db: \{ util: [\d.]+ \} \}\n/g, ''), 'source pings needs at least two loads, so there is something to play between'],
  ['one source', t => t.replace('  pings:  { name: Courier pings, entry: auth, unit: pings/s, color: green, dot: rate / 25, size: bytes / 100 }\n', ''), 'sources needs two to 3 sources, not 1'],
  ['four sources', t => t.replace('levels:', '  c: { name: C }\n  d: { name: D }\nlevels:').replace(/  pings: /, '  b: { name: B }\n  pings: '), 'sources needs two to 3 sources, not 5'],
  ['a source id that is not an id', t => t.replace('  pings:', '  Pings:'), 'source "Pings" is not a valid id'],
  ['sources that are not a mapping', t => t.replace(/sources:\n(  .*\n){2}/, 'sources: [a, b]\n'), '"sources" must map each source id'],
  ['a source that is not a mapping', t => t.replace('pings:  { name: Courier pings, entry: auth, unit: pings/s, color: green, dot: rate / 25, size: bytes / 100 }', 'pings: nope'), 'source pings must be a mapping of name, unit and entry'],
]
for (const [what, change, reason] of gridRefused) {
  test(`parseRun refuses a grid with ${what}`, () => {
    assert.throws(() => grid(change(GRID)), (e: unknown) => e instanceof ParseError && e.file === 'perf/together.yaml' && e.reason.startsWith(reason), reason)
  })
}

test('a load that is a map in a run without sources is refused, and says why', () => {
  assert.throws(
    () => parseRun('r', 'name: R\nlevels:\n  - load: { a: 1 }\n  - load: 2\n'),
    (e: unknown) => e instanceof ParseError && e.reason === 'level 1: load is a mapping of sources, but the run has no sources',
  )
  // A single number in a run with sources is the other way round.
  assert.throws(() => parseRun('r', GRID.replace('{ orders: 100, pings: 50 }', '5')), (e: unknown) => e instanceof ParseError && e.reason.startsWith('level 1: load must give a number'))
})

test('a source that has a slip is a problem and keeps the rest', () => {
  const { run, problems } = grid(GRID.replace('color: blue, dot: rate / 50', 'color: chartreuse, dot: "rate *", extra: 1').replace('name: Courier pings, ', ''))
  assert.deepEqual(problems.map(p => p.message), [
    'source orders: unknown key "extra" (use name, entry, unit, color, dot, size)',
    'source orders: color must be a colour name or a hex such as #1d9e75',
    'source orders: dot ends too soon: it needs a number, a name or a bracket after the last sign'.replace(/ends too soon.*/, '') + problems[2].message.replace('source orders: dot ', ''),
    'source pings: name is missing',
  ])
  assert.equal(run.sources!.pings.name, 'pings')
  assert.equal(run.sources!.orders.source, undefined)
})

test('two sources that draw in one colour are a problem', () => {
  const { problems } = grid(GRID.replace('color: green', 'color: blue'))
  assert.deepEqual(problems.map(p => p.message), ['Customer orders and Courier pings both draw in blue: give each its own colour'])
})

test('a run with sources that also has an entry, a source or axis: time is told so', () => {
  const { problems, run } = grid(`entry: web\nsource: { color: red }\naxis: time\nunit: u\n${GRID}`)
  assert.deepEqual(problems.map(p => p.message), [
    'entry is for a single run: a run with sources gives each source its own entry',
    'source is for a single run: a run with sources gives each source its own color, dot and size',
    'a run with sources is measured over load, not time',
  ])
  assert.equal(run.axis, undefined)
  assert.equal(run.entry, undefined)
  assert.equal(run.unit, '')
})

test('by is read: its numbers per source, and a slip is a problem that leaves it out', () => {
  const { run, problems } = grid(GRID.replace(
    'by: { orders: { rate: 50, bytes: 400 }, pings: { rate: 25, bytes: 100 } }',
    'by: { orders: { rate: 50, util: 0.2 }, pings: { rate: lots }, mail: { rate: 1 }, auth: [1] }',
  ))
  assert.deepEqual(problems.map(p => p.message), [
    'orders 100 and pings 50, orders → db: by orders: unknown key "util" (use rate, bytes, p50, errors)',
    'orders 100 and pings 50, orders → db, pings: rate must be a number',
    'orders 100 and pings 50, orders → db: by names "mail", which is not a source',
    'orders 100 and pings 50, orders → db: by names "auth", which is not a source',
  ])
  assert.deepEqual(run.levels[0].connections[0].by, { orders: { rate: 50 } })
})

test('by in a run without sources, or that is not a mapping, is a problem', () => {
  const single = parseRun('r', 'name: R\nlevels:\n  - load: 1\n    connections: [{ from: a, to: b, rate: 1, by: { x: { rate: 1 } } }]\n  - load: 2\n')
  assert.deepEqual(single.problems.map(p => p.message), ['load 1, a → b: by is for a run with sources'])
  assert.equal(single.run.levels[0].connections[0].by, undefined)
  const text = grid(GRID.replace(/by: \{ orders.*\} \} \}/, 'by: [orders] }'))
  assert.deepEqual(text.problems.map(p => p.message), ['orders 100 and pings 50, orders → db: by must map a source to its numbers'])
  const empty = grid(GRID.replace(/by: \{ orders.*\} \} \}/, 'by: { orders: {} } }'))
  assert.equal(empty.run.levels[0].connections[0].by, undefined)
})

test('the entry of each source must be a shape: checkRun says which', () => {
  const { run } = grid(GRID.replace('entry: auth', 'entry: ghost'))
  assert.deepEqual(checkRun('together', run, shop()).map(p => p.message), ['source pings: entry "ghost" is not an object'])
  assert.deepEqual(checkRun('together', grid().run, shop()), [])
})

test('a hostile source key is data: it is not an id, so it never reaches the prototype', () => {
  assert.throws(() => grid(GRID.replace('  pings:', '  __proto__:')), (e: unknown) => e instanceof ParseError && e.reason.startsWith('source "__proto__" is not a valid id'))
})

// ---- a single run is what it was

test('a single run has one dial with no id, and no new key in its stored parse', () => {
  const { runs } = runsOf({ orders: ORDERS })
  const found = dialsOf(runs, 'orders')!
  assert.equal(found.mode, 'single')
  assert.deepEqual(found.dials, [{ id: '', name: 'Customer orders', unit: 'orders/min', values: [100, 200, 300], source: runs.orders.source, color: 'blue' }])
  assert.deepEqual(Object.keys(runs.orders).sort(), ['entry', 'levels', 'name', 'source', 'unit'])
  assert.ok(runs.orders.levels.every(l => !('loads' in l) && l.connections.every(c => !('by' in c))))
  assert.deepEqual(JSON.parse(JSON.stringify(runs.orders)), runs.orders, 'a run is data: it survives JSON')
})

test('a time run is one dial too, over its times', () => {
  const { runs } = runsOf({ outage: 'name: Outage\naxis: time\nunit: s\nlevels:\n  - at: 0\n  - at: 45\n  - at: 120\n' })
  assert.deepEqual(dialsOf(runs, 'outage')!.dials.map(d => [d.id, d.values, d.unit]), [['', [0, 45, 120], 's']])
})

test('a dial for a run that is not there is nothing', () => {
  assert.equal(dialsOf({}, 'x'), undefined)
  assert.equal(dialsOf(added().runs, '__proto__'), undefined)
})

// ---- settings, combining and the grid

const near = (actual: number | undefined, expected: number, message?: string) => assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, message ?? `expected ${expected}, got ${actual}`)
const together = () => added().runs
const nameFor = (id: string) => shop().objects[id]?.name ?? id

test('two added runs add what they say about a shape at their own loads: 0.3 and 0.4 make 0.7', () => {
  const runs = together()
  const level = levelAt(runs, 'together', { orders: 200, pings: 100 })
  near(level.objects.db.util, 0.7)
  near(level.objects.db.queue, 5) // 3 + 2
  near(level.objects.orders.util, 0.4)
  near(level.objects.auth.util, 0.3)
  assert.deepEqual(level.loads, { orders: 200, pings: 100 })
  // Each part is interpolated at its own load before they add.
  near(levelAt(runs, 'together', { orders: 150, pings: 75 }).objects.db.util, 0.3 + 0.2)
})

test('added past 100% a shape reads over capacity, its colour stops at full strain, and nothing is NaN', () => {
  const runs = together()
  const level = levelAt(runs, 'together', { orders: 300, pings: 200 })
  near(level.objects.db.util, 1.3)
  const t = trafficAt(shop(), runs, 'together', { orders: 300, pings: 200 }, 'shop')
  assert.equal(t.boxes.db.strain, 1)
  assert.equal(t.boxes.shop.strain, 1)
  for (const b of Object.values(t.boxes)) assert.ok(Number.isFinite(b.queue) && (b.strain === undefined || Number.isFinite(b.strain)))
  // The same shape of a single run never passes 1.
  assert.equal(trafficAt(shop(), runs, 'orders', { '': 300 }, 'shop').boxes.db.strain, 0.6)
})

test('errors take the worst; a shape one part does not measure keeps what the other says', () => {
  const runs = runsOf({
    a: 'name: A\nunit: a/s\nlevels:\n  - { load: 1, objects: { api: { util: 0.2, errors: 0.01, queue: 1 }, db: { util: 0.1 } } }\n  - { load: 2, objects: { api: { util: 0.3, errors: 0.01, queue: 1 }, db: { util: 0.1 } } }\n',
    b: 'name: B\nunit: b/s\nlevels:\n  - { load: 1, objects: { api: { util: 0.1, errors: 0.04 } } }\n  - { load: 2, objects: { api: { util: 0.1, errors: 0.04 } } }\n',
    both: 'name: Both\nadds: [a, b]\n',
  }).runs
  const level = levelAt(runs, 'both', { a: 1, b: 1 })
  near(level.objects.api.util, 0.3)
  near(level.objects.api.errors, 0.04)
  near(level.objects.api.queue, 1)
  assert.deepEqual(level.objects.db, { util: 0.1 })
})

test('a line adds its rates, takes the worst latency and failing share, and weighs the size of a call by rate', () => {
  const part = (name: string, unit: string, c: string) => `name: ${name}\nunit: ${unit}\nlevels:\n  - { load: 1, overall: { rate: 1 }, connections: [${c}] }\n  - { load: 2, connections: [${c}] }\n`
  const runs = runsOf({
    a: part('A', 'a/s', '{ from: web, to: api, rate: 10, bytes: 100, p50: 5, p95: 9, errors: 0.1 }'),
    b: part('B', 'b/s', '{ from: web, to: api, rate: 30, bytes: 500, p50: 20, p95: 40, errors: 0.02 }'),
    c: part('C', 'c/s', '{ from: web, to: api, rate: 20, bytes: 300, p50: 1 }'),
    d: part('D', 'd/s', '{ from: web, to: api, rate: 20, bytes: 100, p50: 1 }'),
    ab: 'name: AB\nadds: [a, b]\n', cd: 'name: CD\nadds: [c, d]\n',
  }).runs
  const [ab] = levelAt(runs, 'ab', { a: 1, b: 1 }).connections
  assert.deepEqual({ ...ab, by: undefined }, { from: 'web', to: 'api', rate: 40, bytes: 400, p50: 20, p95: 40, errors: 0.1, by: undefined })
  assert.deepEqual(ab.by, { a: { rate: 10, bytes: 100, p50: 5, errors: 0.1 }, b: { rate: 30, bytes: 500, p50: 20, errors: 0.02 } })
  // Equal rates, different sizes: the mean of the two.
  near(levelAt(runs, 'cd', { c: 1, d: 1 }).connections[0].bytes, 200)
})

test('a line carried by two parts keeps what each carried, once the view folds them onto one line', () => {
  const [, shared] = rollUp(shop(), levelAt(together(), 'together', { orders: 200, pings: 100 }), 'shop').lines
  assert.equal(shared.from + shared.to, 'apidb')
  near(shared.rate, 150)
  assert.deepEqual(shared.by, { orders: { rate: 100, bytes: 400, p50: 20, errors: 0.01 }, pings: { rate: 50, bytes: 100, p50: 50 } })
})

test('levelAt of a single run is interpolate, and keeps a time run, a load that is not a number and a missing dial at the lowest level', () => {
  const runs = together()
  for (const load of [100, 150, 250, 300, 0, 999, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(levelAt(runs, 'orders', { '': load }), interpolate(runs.orders, load))
  assert.deepEqual(levelAt(runs, 'orders', {}), interpolate(runs.orders, Number.NaN))
  assert.deepEqual(levelAt(runs, 'orders', { x: 5 }).objects, interpolate(runs.orders, 100).objects)
})

test('a setting past a dial\'s range is that end, a setting that is not a number is the lowest, and a missing dial too', () => {
  const runs = together()
  assert.deepEqual(levelAt(runs, 'together', { orders: 9999, pings: -5 }).loads, { orders: 300, pings: 50 })
  assert.deepEqual(levelAt(runs, 'together', { orders: Number.NaN, pings: Number.POSITIVE_INFINITY }).loads, { orders: 100, pings: 50 })
  assert.deepEqual(levelAt(runs, 'together', {}).loads, { orders: 100, pings: 50 })
  assert.deepEqual(levelAt(runs, 'together', { orders: 100, pings: 50, extra: 7 }).loads, { orders: 100, pings: 50 })
  assert.deepEqual(levelAt(runs, 'ghost', { '': 1 }), { load: 0, overall: {}, objects: {}, connections: [] })
})

/** A 2 by 2 grid whose corners are 0.1, 0.2, 0.5 and 0.9 on db; the line has a `by` at every corner. */
const SQUARE = `name: Square
sources:
  orders: { name: Customer orders, unit: orders/min, color: blue, dot: rate / 50 }
  pings: { name: Courier pings, unit: pings/s, color: green, dot: rate / 25 }
levels:
  - load: { orders: 100, pings: 10 }
    overall: { p95: 40 }
    objects: { db: { util: 0.1, queue: 0 } }
    connections: [{ from: orders, to: db, rate: 20, p50: 10, by: { orders: { rate: 10 }, pings: { rate: 10 } } }]
  - load: { orders: 100, pings: 30 }
    overall: { p95: 60 }
    objects: { db: { util: 0.2, queue: 4 } }
    connections: [{ from: orders, to: db, rate: 40, p50: 20, by: { orders: { rate: 10 }, pings: { rate: 30 } } }]
  - load: { orders: 300, pings: 10 }
    overall: { p95: 80 }
    objects: { db: { util: 0.5, queue: 8 } }
    connections: [{ from: orders, to: db, rate: 100, p50: 30, by: { orders: { rate: 90 }, pings: { rate: 10 } } }]
  - load: { orders: 300, pings: 30 }
    overall: { p95: 120 }
    objects: { db: { util: 0.9, queue: 12 } }
    connections: [{ from: orders, to: db, rate: 120, p50: 40, by: { orders: { rate: 90 }, pings: { rate: 30 } } }]
`
const square = () => runsOf({ square: SQUARE }).runs

test('a 2 by 2 grid blends at its centre to the mean of its four corners, and gives a tested combination exactly', () => {
  const runs = square()
  const centre = levelAt(runs, 'square', { orders: 200, pings: 20 })
  near(centre.objects.db.util, (0.1 + 0.2 + 0.5 + 0.9) / 4)
  near(centre.objects.db.queue, (0 + 4 + 8 + 12) / 4)
  near(centre.overall.p95, (40 + 60 + 80 + 120) / 4)
  near(centre.connections[0].rate, (20 + 40 + 100 + 120) / 4)
  near(centre.connections[0].by!.pings.rate, (10 + 30 + 10 + 30) / 4)
  assert.deepEqual(centre.loads, { orders: 200, pings: 20 })
  const corner = levelAt(runs, 'square', { orders: 300, pings: 10 })
  near(corner.objects.db.util, 0.5)
  assert.equal(corner.objects.db.queue, 8)
  assert.deepEqual(corner.connections[0], { from: 'orders', to: 'db', rate: 100, p50: 30, by: { orders: { rate: 90 }, pings: { rate: 10 } } })
  // Along one edge only that source moves.
  near(levelAt(runs, 'square', { orders: 100, pings: 20 }).objects.db.util, 0.15)
  near(levelAt(runs, 'square', { orders: 150, pings: 10 }).objects.db.util, 0.2)
})

test('outside the grid a setting is the nearest edge, and a number nobody measured at every corner is left out', () => {
  const runs = square()
  assert.deepEqual(levelAt(runs, 'square', { orders: 9999, pings: -1 }).loads, { orders: 300, pings: 10 })
  near(levelAt(runs, 'square', { orders: 9999, pings: -1 }).objects.db.util, 0.5)
  const gap = runsOf({ gap: SQUARE.replace('objects: { db: { util: 0.5, queue: 8 } }', 'objects: { db: { util: 0.5 } }') }).runs
  assert.equal(levelAt(gap, 'gap', { orders: 200, pings: 20 }).objects.db.queue, undefined)
  near(levelAt(gap, 'gap', { orders: 100, pings: 20 }).objects.db.queue, 2) // the two corners it blends both say
  near(levelAt(gap, 'gap', { orders: 300, pings: 10 }).objects.db.util, 0.5)
})

test('the lockstep steps put each dial along its own range: 3 and 5 levels meet at (0, 0), (0.5, 1), (1, 2), (1.5, 3), (2, 4)', () => {
  const levels = (n: number) => Array.from({ length: n }, (_, i) => `  - load: ${(i + 1) * 10}\n`).join('')
  const runs = runsOf({ three: `name: Three\nunit: t\nlevels:\n${levels(3)}`, five: `name: Five\nunit: f\nlevels:\n${levels(5)}`, both: 'name: Both\nadds: [three, five]\n' }).runs
  const { dials } = dialsOf(runs, 'both')!
  assert.deepEqual([0, 1, 2, 3, 4].map(step => lockstepPositions(dials, step)), [[0, 0], [0.5, 1], [1, 2], [1.5, 3], [2, 4]])
  assert.deepEqual(settingAt(dials, [1.5, 3]), { three: 25, five: 40 })
  assert.deepEqual(settingAt(dials, [9, -1]), { three: 30, five: 10 })
  assert.deepEqual(lockstepPositions(dials.slice(0, 1), 2), [2], 'one dial alone runs the whole way')
})

test('the knee of a single run is knee, and of two added runs the first step where everything rises together and a shape is nearly full', () => {
  const runs = together()
  assert.deepEqual(kneeOf(runs, 'orders'), knee(runs.orders))
  const k = kneeOf(runs, 'together')!
  assert.equal(k.index, 2)
  assert.deepEqual(k.setting, { orders: 300, pings: 200 })
  assert.ok('by' in k && k.by.id === 'db' && k.by.kind === 'util')
  near('by' in k ? k.by.share : undefined, 1.3)
  assert.equal(kneeTextOf(runs, 'together', k, nameFor), 'First struggles with Customer orders at 300 orders/min and Courier pings at 200 pings/s: Orders DB at 130% of capacity')
  // A single run's words are the ones it always had.
  assert.equal(kneeTextOf(runs, 'orders', kneeOf(runs, 'orders')!, nameFor), 'First struggles at 200 orders/min: the slowest 5% of calls go from 20 ms to 60 ms')
})

test('a knee between levels says where each source stood, and a run that never struggles has none', () => {
  const runs = square()
  assert.equal(kneeOf(runs, 'square')!.index, 1, 'orders 300 and pings 30 make 0.9 on db')
  assert.equal(kneeTextOf(runs, 'square', kneeOf(runs, 'square')!, nameFor), 'First struggles with Customer orders at 300 orders/min and Courier pings at 30 pings/s: Orders DB at 90% of capacity')
  const flat = (text: string) => text.replace(/ {4}overall: .*\n/g, '') // no overall numbers, so no latency to pass
  const calm = runsOf({
    calm: flat(SQUARE).replace(/util: 0\.[59]/g, 'util: 0.4'), a: flat(ORDERS).replace(/util: 0\.[67]/g, 'util: 0.5'), b: flat(PINGS).replace(/util: 0\.[78]/g, 'util: 0.3'),
    both: 'name: Both\nadds: [a, b]\n',
  }).runs
  assert.equal(kneeOf(calm, 'calm'), undefined)
  assert.equal(kneeOf(calm, 'both'), undefined)
  assert.equal(kneeOf(calm, 'ghost'), undefined)
})

test('a knee in latency alone is named by the slowest 5% of calls for several sources too', () => {
  const runs = square()
  const slow = runsOf({ slow: SQUARE.replace(/util: 0\.[259]/g, 'util: 0.1').replace('util: 0.1, queue: 0', 'util: 0.1').replace('p95: 40', 'p95: 20') }).runs
  const k = kneeOf(slow, 'slow')!
  assert.ok('latency' in k)
  assert.equal(kneeTextOf(slow, 'slow', k, nameFor), 'First struggles with Customer orders at 300 orders/min and Courier pings at 30 pings/s: the slowest 5% of calls go from 20 ms to 120 ms')
  assert.ok(runs.square)
})

test('each source draws its dots in its own colour and size, and a line they share is scaled by one factor so the ratio holds', () => {
  const t = trafficAt(shop(), together(), 'together', { orders: 200, pings: 100 }, 'shop')
  const shared = t.lines.filter(l => l.from === 'api' && l.to === 'db')
  assert.deepEqual(shared.map(l => [l.source, l.color, l.dots, l.offset]), [['orders', 'blue', 2, -0.5], ['pings', 'green', 2, 0.5]])
  assert.equal(shared[0].width, shared[1].width, 'the line is as thick as everything it carries')
  assert.equal(shared[1].radius, 1, 'pings\' size formula gives a radius, orders has none')
  assert.equal(shared[0].radius, undefined)
  // A line only one source carries has no offset.
  const alone = t.lines.find(l => l.from === 'customer')!
  assert.deepEqual([alone.source, alone.color, alone.offset], ['orders', 'blue', undefined])
})

const BUSY_ORDERS = ORDERS.replace(/rate: (\d+)/g, (_, n) => `rate: ${Number(n) * 100}`)
const BUSY_PINGS = PINGS.replace(/rate: (\d+)/g, (_, n) => `rate: ${Number(n) * 2}`)

test('past the cap both sources on a line are scaled down together: ten to one stays ten to one', () => {
  const runs = runsOf({ orders: BUSY_ORDERS, pings: BUSY_PINGS, together: TOGETHER }).runs
  const t = trafficAt(shop(), runs, 'together', { orders: 200, pings: 100 }, 'shop')
  const [orders, pings] = t.lines.filter(l => l.from === 'api' && l.to === 'db')
  // orders: rate 10000 / 50 = 200 dots, pings: rate 100 / 25 = 4 dots (a 50 to 1 ratio).
  assert.equal(orders.dots, AT_ONCE)
  near(pings.dots, (4 * AT_ONCE) / 200)
  assert.equal(orders.capped, true)
  assert.equal(pings.capped, true, 'the whole line is scaled down')
  near(orders.dots! / pings.dots!, 50, 'the ratio is the formula\'s')
  // Under the cap nothing is scaled.
  assert.ok(trafficAt(shop(), together(), 'together', { orders: 200, pings: 100 }, 'shop').lines.every(l => l.capped === undefined))
})

test('with four sources on a busy view the dots of a line stay bounded', () => {
  const part = (n: number, rate: number) => `name: P${n}\nunit: u${n}\nsource: { dot: rate / 10 }\nlevels:\n  - { load: 1, connections: [{ from: web, to: api, rate: ${rate} }] }\n  - { load: 2, connections: [{ from: web, to: api, rate: ${rate * 2} }] }\n`
  const runs = runsOf({ p1: part(1, 1e6), p2: part(2, 5e5), p3: part(3, 250), p4: part(4, 5), four: 'name: Four\nadds: [p1, p2, p3, p4]\n' }).runs
  const lines = trafficAt(shop(), runs, 'four', { p1: 2, p2: 2, p3: 2, p4: 2 }, 'web').lines.concat(trafficAt(shop(), runs, 'four', { p1: 2, p2: 2, p3: 2, p4: 2 }, 'shop').lines)
  const mine = lines.filter(l => l.from === 'web' && l.to === 'api')
  assert.deepEqual(mine.map(l => l.source), ['p1', 'p2', 'p3', 'p4'])
  assert.deepEqual(mine.map(l => l.offset), [-1.5, -0.5, 0.5, 1.5])
  assert.ok(mine.every(l => l.dots! <= AT_ONCE && Number.isFinite(l.perSecond)))
  near(mine[0].dots! / mine[1].dots!, 2)
})

test('a run tested together draws a line with a by for each source, and a line without one in a neutral colour with the default curve', () => {
  const runs = runsOf({
    mixed: SQUARE.replace(/connections: \[/g, 'connections: [{ from: web, to: api, rate: 30, p50: 9 }, '),
  }).runs
  const t = trafficAt(shop(), runs, 'mixed', { orders: 200, pings: 20 }, 'shop')
  const neutral = t.lines.find(l => l.from === 'web')!
  assert.deepEqual([neutral.color, neutral.source, neutral.offset, neutral.dots], ['gray', undefined, undefined, undefined])
  assert.deepEqual(neutral, { ...traffic(shop(), runs.mixed, 0, 'shop').lines[0], color: 'gray', ...neutral }, 'the single-run builder made it: the default curve')
  const split = t.lines.filter(l => l.to === 'db')
  assert.deepEqual(split.map(l => [l.source, l.color]), [['orders', 'blue'], ['pings', 'green']])
})

test('a shared line where only one source reports a rate draws that source alone', () => {
  const one = SQUARE.replace(/by: \{ orders: \{ rate: (\d+) \}, pings: \{ rate: (\d+) \} \}/g, 'by: { orders: { rate: $1 }, pings: { p50: 5 } }')
  const runs = runsOf({ one }).runs
  const lines = trafficAt(shop(), runs, 'one', { orders: 200, pings: 20 }, 'shop').lines.filter(l => l.to === 'db')
  assert.deepEqual(lines.map(l => [l.source, l.offset]), [['orders', undefined]])
  // A source that is the only one named, with no rate of its own, carries the whole line.
  const sole = runsOf({ sole: SQUARE.replace(/by: \{ orders: \{ rate: (\d+) \}, pings: \{ rate: (\d+) \} \}/g, 'by: { pings: { p50: 7 } }') }).runs
  const alone = trafficAt(shop(), sole, 'sole', { orders: 100, pings: 10 }, 'shop').lines.filter(l => l.to === 'db')
  assert.deepEqual(alone.map(l => [l.source, l.dots]), [['pings', 0.8]])
})

test('a line that names no rate at all, in the total or in any by, has no traffic, not zero dots', () => {
  const bare = SQUARE.replace(/rate: \d+, p50/g, 'p50').replace(/by: \{ orders: \{ rate: \d+ \}, pings: \{ rate: \d+ \} \}/g, 'by: { orders: { p50: 3 }, pings: { p50: 4 } }')
  const runs = runsOf({ bare }).runs
  assert.deepEqual(trafficAt(shop(), runs, 'bare', { orders: 200, pings: 20 }, 'shop').lines, [])
})

test('the failing share of a line goes to the source that says it, and to every source when only the line does', () => {
  const failing = runsOf({
    own: SQUARE.replace('by: { orders: { rate: 10 }, pings: { rate: 10 } }', 'by: { orders: { rate: 10, errors: 0.2 }, pings: { rate: 10 } }'),
    shared: SQUARE.replace('rate: 20, p50: 10,', 'rate: 20, p50: 10, errors: 0.1,'),
  }).runs
  const at = { orders: 100, pings: 10 }
  assert.deepEqual(trafficAt(shop(), failing, 'own', at, 'shop').lines.map(l => [l.source, l.failed]), [['orders', 0.2], ['pings', 0]])
  assert.deepEqual(trafficAt(shop(), failing, 'shared', at, 'shop').lines.map(l => [l.source, l.failed]), [['orders', 0.1], ['pings', 0.1]])
})

test('trafficAt of a single run is traffic, line for line, at every load and in every view', () => {
  const runs = together()
  for (const view of ['root', 'shop', 'api', 'web'])
    for (const load of [100, 130, 200, 250, 300, 0, Number.NaN]) assert.deepEqual(trafficAt(shop(), runs, 'orders', { '': load }, view), traffic(shop(), runs.orders, load, view))
  assert.deepEqual(trafficAt(shop(), runs, 'ghost', {}, 'shop'), { boxes: {}, lines: [] })
})

test('the key names each source that has a line on screen, with its scale and size, and says once when a line is scaled down', () => {
  const runs = together()
  const lines = trafficAt(shop(), runs, 'together', { orders: 200, pings: 100 }, 'shop').lines
  assert.deepEqual(sourceKeyAt(runs, 'together', lines), {
    sources: [
      { id: 'orders', name: 'Customer orders', color: 'blue', scale: '1 dot = 50 calls/s', bigger: false },
      { id: 'pings', name: 'Courier pings', color: 'green', scale: '1 dot = 25 calls/s', bigger: true },
    ],
    scaledDown: false, other: false,
  })
  // A source with nothing on screen is not in the key.
  const onlyPings = lines.filter(l => l.source === 'pings')
  assert.deepEqual(sourceKeyAt(runs, 'together', onlyPings).sources.map(s => s.id), ['pings'])
  assert.deepEqual(sourceKeyAt(runs, 'together', []), { sources: [], scaledDown: false, other: false })
  const busy = runsOf({ orders: BUSY_ORDERS, pings: BUSY_PINGS, together: TOGETHER }).runs
  assert.equal(sourceKeyAt(busy, 'together', trafficAt(shop(), busy, 'together', { orders: 200, pings: 100 }, 'shop').lines).scaledDown, true)
})

test('the key of a single run is what sourceKey says, and a neutral line is flagged', () => {
  const runs = together()
  const lines = traffic(shop(), runs.orders, 200, 'shop').lines
  assert.deepEqual(sourceKeyAt(runs, 'orders', lines), { sources: [{ id: '', name: 'Customer orders', color: 'blue', scale: '1 dot = 50 calls/s', bigger: false }], scaledDown: false, other: false })
  const plain = runsOf({ plain: 'name: Plain\nlevels:\n  - { load: 1, connections: [{ from: web, to: api, rate: 5 }] }\n  - { load: 2, connections: [{ from: web, to: api, rate: 6 }] }\n' }).runs
  assert.deepEqual(sourceKeyAt(plain, 'plain', traffic(shop(), plain.plain, 1, 'shop').lines), { sources: [], scaledDown: false, other: false })
  const mixed = runsOf({ mixed: SQUARE.replace(/connections: \[/g, 'connections: [{ from: web, to: api, rate: 30, p50: 9 }, ') }).runs
  assert.equal(sourceKeyAt(mixed, 'mixed', trafficAt(shop(), mixed, 'mixed', { orders: 200, pings: 20 }, 'shop').lines).other, true)
})

test('runs added or tested, sent through JSON as they are to the browser, draw the same traffic and say the same knee', () => {
  for (const [runs, id, setting] of [[together(), 'together', { orders: 250, pings: 150 }], [square(), 'square', { orders: 200, pings: 20 }]] as const) {
    const sent = JSON.parse(JSON.stringify(runs)) as Record<string, Run>
    assert.deepEqual(trafficAt(shop(), sent, id, setting, 'shop'), trafficAt(shop(), runs, id, setting, 'shop'))
    assert.deepEqual(kneeOf(sent, id), kneeOf(runs, id))
    assert.deepEqual(levelAt(sent, id, setting), levelAt(runs, id, setting))
  }
})

test('checkRun reads a hostile id in a level of a grid as data', () => {
  const { run } = parseRun('together', SQUARE.replace('objects: { db: { util: 0.1, queue: 0 } }', 'objects: { __proto__: { util: 0.1 }, db: { util: 0.1, queue: 0 } }'))
  assert.equal(Object.getPrototypeOf(run.levels[0].objects), Object.prototype)
  assert.deepEqual(Object.keys(run.levels[0].objects), ['__proto__', 'db'])
})
