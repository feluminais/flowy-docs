import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dataShown } from '../src/core/data.ts'
import type { FlowyObject } from '../src/core/model.ts'

const store = (data: unknown) => ({ type: 'store', name: 'S', data }) as FlowyObject

test('dataShown reads a grid', () => {
  const [orders] = dataShown(store([{
    name: 'orders',
    columns: [{ name: 'id', key: 'primary' }, { name: 'customer_id', to: 'customers' }, 'status', { name: 'total', note: 'Cents, not decimals.' }],
    rows: [['o_1', 'c_7', 'placed']],
  }]))
  assert.deepEqual(orders.columns, [{ name: 'id', key: 'primary' }, { name: 'customer_id', to: 'customers' }, { name: 'status' }, { name: 'total', note: 'Cents, not decimals.' }])
  assert.deepEqual(orders.rows, [['o_1', 'c_7', 'placed', '']])
  assert.equal(orders.summary, '4 columns')
  assert.deepEqual(orders.notes, [{ name: 'total', text: 'Cents, not decimals.' }])
  assert.deepEqual(orders.lines, [])
})

test('a column type is read, and a trailing ? makes the column nullable', () => {
  const [t] = dataShown(store([{
    name: 't',
    columns: [{ name: 'a', type: 'int' }, { name: 'b', type: 'text?' }, { name: 'c', type: ' ? ' }, { name: 'd', type: '  ' }, { name: 'e', type: ['x'] }, 'f'],
  }]))
  assert.deepEqual(t.columns, [
    { name: 'a', type: 'int' }, { name: 'b', type: 'text', nullable: true }, { name: 'c', nullable: true }, { name: 'd' }, { name: 'e' }, { name: 'f' },
  ])
})

test('a key other than primary is dropped, a blank kind or limits is left out, a kind is kept', () => {
  const [a, b] = dataShown(store([
    { name: 'a', kind: '', limits: '', note: '', columns: [{ name: 'x', key: 'foreign' }] },
    { name: 'b', kind: 'table', limits: 'Kept 7 years', note: 'One row per order.', columns: ['x'] },
  ]))
  assert.deepEqual(a.columns, [{ name: 'x' }])
  assert.deepEqual(Object.keys(a).sort(), ['columns', 'lines', 'name', 'notes', 'rows', 'summary'])
  assert.equal(b.kind, 'table')
  assert.equal(b.limits, 'Kept 7 years')
  assert.equal(b.note, 'One row per order.')
})

test('a single column or field is singular', () => {
  const [grid, doc] = dataShown(store([{ name: 'g', columns: ['id'] }, { name: 'd', sample: { id: '1' } }]))
  assert.equal(grid.summary, '1 column')
  assert.equal(doc.summary, '1 field')
})

test('a sample document is listed line by line with its notes', () => {
  const [doc] = dataShown(store([{
    name: 'restaurants',
    sample: { _id: 'r_42', tags: ['ramen', 'vegan'], hours: { mon: '11-22', tue: '11-22' }, items: [{ name: 'Pho' }] },
    notes: { hours: 'Inside the profile.' },
  }]))
  assert.deepEqual(doc.lines, [
    { depth: 1, key: '_id', value: 'r_42', path: '_id', noted: false },
    { depth: 1, key: 'tags', value: '[ramen, vegan]', path: 'tags', noted: false },
    { depth: 1, key: 'hours', value: '', path: 'hours', noted: true },
    { depth: 2, key: 'mon', value: '11-22', path: 'hours.mon', noted: false },
    { depth: 2, key: 'tue', value: '11-22', path: 'hours.tue', noted: false },
    { depth: 1, key: 'items', value: '', path: 'items', noted: false },
    { depth: 2, key: '-', value: '', noted: false },
    { depth: 3, key: 'name', value: 'Pho', noted: false },
  ])
  assert.equal('path' in doc.lines[6], false)
  assert.equal('path' in doc.lines[7], false)
  assert.equal(doc.summary, '4 fields')
  assert.deepEqual(doc.notes, [{ name: 'hours', text: 'Inside the profile.' }])
  assert.deepEqual(doc.columns, [])
  assert.deepEqual(doc.rows, [])
})

test('no data, blank data and junk read as none', () => {
  for (const data of [undefined, '', '~', [], {}, 'text']) assert.deepEqual(dataShown(store(data)), [], JSON.stringify(data))
  assert.deepEqual(dataShown(store(['text', { name: '' }, { name: 'x' }])), [])
})

test('a field named like a prototype member is not noted', () => {
  const [doc] = dataShown(store([{ name: 'd', sample: { constructor: 'x', toString: 'y' }, notes: {} }]))
  assert.deepEqual(doc.lines.map(l => l.noted), [false, false])
  assert.deepEqual(doc.notes, [])
})

test('blank is what trim() removes: a name of only U+FEFF is no name, and a kind of only U+0085 is kept', () => {
  const [entry] = dataShown(store([{ name: 'a', columns: ['x'], kind: String.fromCharCode(0x85) }, { name: String.fromCharCode(0xfeff), columns: ['x'] }]))
  assert.equal(entry.kind, String.fromCharCode(0x85))
  assert.equal(dataShown(store([{ name: String.fromCharCode(0xfeff), columns: ['x'] }])).length, 0)
})
