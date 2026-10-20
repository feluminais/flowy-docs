import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { shop } from './fixtures.ts'

/** Every message check() gives for the shop once its store `db` carries this `data`. */
function problems(data: unknown): string[] {
  const m = shop()
  ;(m.objects.db as Record<string, unknown>).data = data
  return check(m).map(p => p.message)
}

const valid = [
  {
    name: 'orders', kind: 'table', limits: 'Kept 7 years, then archived', note: 'One row per order.',
    columns: [{ name: 'id', key: 'primary' }, { name: 'customer_id', to: 'customers' }, 'status', { name: 'total', note: 'Cents.' }],
    rows: [['o_1', 'c_7', 'placed', '2490'], ['o_2', 'c_8', 'accepted', '1380']],
  },
  { name: 'Keys', columns: ['Key', 'Value', 'Expires'], rows: [['menu:{id}', '{ items }', '5 min']] },
  { name: 'restaurants', sample: { _id: 'r_42', tags: ['ramen'], hours: { mon: '11-22' } }, notes: { hours: 'Inside.' } },
]

const names = (n: number) => Array.from({ length: n }, (_, i) => `c${i}`)
const fields = (n: number) => Object.fromEntries(names(n).map(k => [k, '1']))

const cases: [string, unknown, string][] = [
  ['an entry that is not a mapping', ['text'], 'data entry 1 must be a mapping'],
  ['an entry with no name', [{ columns: ['a'] }], 'data entry 1 has no name'],
  ['an entry with a blank name', [{ name: ' ', columns: ['a'] }], 'data entry 1 has no name'],
  ['two entries with one name', [{ name: 'a', columns: ['x'] }, { name: 'a', columns: ['x'] }], 'data "a" appears twice'],
  ['a limits line that is not text', [{ name: 'a', limits: ['x'], columns: ['x'] }], 'data "a": "limits" must be plain text'],
  ['neither columns nor a sample', [{ name: 'a' }], 'data "a" needs columns or a sample'],
  ['both columns and a sample', [{ name: 'a', columns: ['x'], sample: { x: '1' } }], 'data "a" has both columns and a sample'],
  ['rows without columns', [{ name: 'a', sample: { x: '1' }, rows: [['1']] }], 'data "a": rows need columns'],
  ['notes without a sample', [{ name: 'a', columns: ['x'], notes: { x: 'n' } }], 'data "a": notes need a sample'],
  ['columns that are not a list', [{ name: 'a', columns: 'x' }], 'data "a": columns must be a list'],
  ['no columns', [{ name: 'a', columns: [] }], 'data "a": columns is empty'],
  ['a column that is a list', [{ name: 'a', columns: [['x']] }], 'data "a": column 1 must be a name or a mapping'],
  ['a column with no name', [{ name: 'a', columns: [{ key: 'primary' }] }], 'data "a": column 1 has no name'],
  ['two columns with one name', [{ name: 'a', columns: ['x', 'x'] }], 'data "a": column "x" appears twice'],
  ['a key that is not primary', [{ name: 'a', columns: [{ name: 'x', key: 'foreign' }] }], 'data "a": column "x": key must be primary'],
  ['a column note that is not text', [{ name: 'a', columns: [{ name: 'x', note: ['n'] }] }], 'data "a": column "x": "note" must be plain text'],
  ['too many columns', [{ name: 'a', columns: names(13) }], 'data "a": 13 columns, at most 12'],
  ['rows that are not a list', [{ name: 'a', columns: ['x'], rows: 'r' }], 'data "a": rows must be a list of rows'],
  ['a row that is text', [{ name: 'a', columns: ['x'], rows: ['r'] }], 'data "a": row 1 must be a list of cells'],
  ['a cell that is a list', [{ name: 'a', columns: ['x'], rows: [[['n']]] }], 'data "a": row 1 must be a list of cells'],
  ['a short row', [{ name: 'a', columns: ['x', 'y'], rows: [['1']] }], 'data "a": row 1 has 1 cell but there are 2 columns'],
  ['a long row', [{ name: 'a', columns: ['x'], rows: [['1', '2', '3']] }], 'data "a": row 1 has 3 cells but there is 1 column'],
  ['too many rows', [{ name: 'a', columns: ['x'], rows: Array.from({ length: 9 }, () => ['1']) }], 'data "a": 9 rows, at most 8'],
  ['a sample that is a list', [{ name: 'a', sample: ['x'] }], 'data "a": sample must be a mapping of fields'],
  ['an empty sample', [{ name: 'a', sample: {} }], 'data "a": sample is empty'],
  ['a sample nested too deep', [{ name: 'a', sample: { a: { b: { c: { d: '1' } } } } }], 'data "a": sample is nested 4 levels deep, at most 3'],
  ['a sample with too many fields', [{ name: 'a', sample: fields(21) }], 'data "a": sample shows 21 fields, at most 20'],
  ['notes that are text', [{ name: 'a', sample: { x: '1' }, notes: 'n' }], 'data "a": notes must map a field to its note'],
  ['a note that is a list', [{ name: 'a', sample: { x: '1' }, notes: { x: ['n'] } }], 'data "a": notes must map a field to its note'],
  ['a note on no field', [{ name: 'a', sample: { hours: { mon: '1' } }, notes: { 'hours.fri': 'n' } }], 'data "a": the note on "hours.fri" names no field of the sample'],
  ['a list inside a list', [{ name: 'a', sample: { grid: [['a'], ['b']] } }], 'data "a": sample has a list inside a list, which isn\'t shown'],
  ['data that is a mapping', {}, 'data must be a list of entries'],
  ['data that is the text ~', '~', 'data must be a list of entries'],
]

for (const [title, data, message] of cases) {
  test(`check reports ${title}`, () => {
    const found = problems(data)
    assert.ok(found.includes(`db: ${message}`), `expected "db: ${message}" in ${JSON.stringify(found)}`)
  })
}

test('a valid grid, key set and document have no problems', () => {
  assert.deepEqual(problems(valid), [])
})

test('a blank data is no data', () => {
  assert.deepEqual(problems(''), [])
})

test('a field named like a prototype member is a field, and a note on nothing is still reported', () => {
  assert.deepEqual(problems([{ name: 'a', sample: { constructor: '1' }, notes: { constructor: 'n' } }]), [])
  assert.ok(problems([{ name: 'a', sample: { x: '1' }, notes: { toString: 'n' } }]).includes('db: data "a": the note on "toString" names no field of the sample'))
})

test('data on anything but a store is refused', () => {
  const m = shop()
  ;(m.objects.mail as Record<string, unknown>).data = valid
  assert.ok(check(m).some(p => p.message === 'mail: only a store can have data'))
})

test('data of any wrong shape reports problems and never throws', () => {
  const junk: unknown[] = ['x', {}, [null], [[]], [{}], [{ name: 'a', columns: 'c', rows: 'r', sample: 's', notes: 'n' }],
    [{ name: 'a', columns: [null, 3, {}, []], rows: [null, 'x', [null]] }], [{ name: 'a', sample: { x: null, y: [null, [1]], z: { w: [{}] } }, notes: [] }]]
  for (const data of junk) assert.doesNotThrow(() => problems(data), JSON.stringify(data))
})
