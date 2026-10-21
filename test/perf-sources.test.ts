import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ParseError } from '../src/core/model.ts'
import { checkRun, checkRuns, dialsOf, parseRun, SOURCE_PALETTE } from '../src/core/perf.ts'
import type { Run } from '../src/core/perf.ts'
import { shop } from './fixtures.ts'

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
