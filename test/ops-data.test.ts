import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { tidyData } from '../src/core/data.ts'
import type { DataInput } from '../src/core/data.ts'
import { describeEdit } from '../src/core/editlabel.ts'
import { putObject } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

const orders: DataInput = { name: 'orders', columns: ['id', 'total'], rows: [['o_1', 2490]] }

test('putObject adds data after the other fields, with numbers and booleans as text', () => {
  const m = putObject(shop(), {
    id: 'db',
    data: [orders, { name: 'r', sample: { rating: 4.6, open: true, tags: ['a'], nested: { n: 1 }, gone: null } }],
  })
  assert.deepEqual(m.objects.db.data, [
    { name: 'orders', columns: ['id', 'total'], rows: [['o_1', '2490']] },
    { name: 'r', sample: { rating: '4.6', open: 'true', tags: ['a'], nested: { n: '1' }, gone: '' } },
  ])
  assert.deepEqual(Object.keys(m.objects.db), ['type', 'in', 'name', 'tech', 'data'])
  assert.deepEqual(check(m), [])
})

test('a new store gets its keys in the file order, data last', () => {
  const m = putObject(shop(), { id: 'cache', type: 'store', name: 'Cache', in: 'shop', links: [{ url: 'https://example.com' }], data: [orders] })
  assert.deepEqual(Object.keys(m.objects.cache), ['type', 'name', 'in', 'links', 'data'])
})

test('a column with only a name is written bare, and the keys of a column are ordered', () => {
  const [entry] = tidyData([{
    name: 'a',
    columns: [{ note: 'n', to: 't', key: 'primary', type: 'uuid', name: 'id' }, { name: 'x' }, { name: 'y', to: '', note: '', type: '' }],
  }]) as { columns: unknown[] }[]
  assert.deepEqual(entry.columns, [{ name: 'id', type: 'uuid', key: 'primary', to: 't', note: 'n' }, 'x', 'y'])
  assert.deepEqual(Object.keys(entry.columns[0] as object), ['name', 'type', 'key', 'to', 'note'])
})

test('a blank kind or limits is dropped and an entry\'s keys are ordered', () => {
  const [entry] = tidyData([{ notes: { x: 'n' }, sample: { x: '1' }, note: 'n', limits: '', kind: '', name: 'a' }])
  assert.deepEqual(Object.keys(entry as object), ['name', 'note', 'sample', 'notes'])
})

test('data replaces the whole list; leaving it out keeps it; an empty list removes it', () => {
  const first = putObject(shop(), { id: 'db', data: [orders, { name: 'refunds', columns: ['id'] }] })
  const replaced = putObject(first, { id: 'db', data: [{ name: 'baskets', columns: ['id'] }] })
  assert.deepEqual((replaced.objects.db.data as { name: string }[]).map(e => e.name), ['baskets'])
  assert.deepEqual(putObject(first, { id: 'db', tech: 'MySQL' }).objects.db.data, first.objects.db.data)
  assert.equal('data' in putObject(first, { id: 'db', data: [] }).objects.db, false)
})

test('data on a system adds the problem that only a store can have it', () => {
  const m = putObject(shop(), { id: 'mail', data: [orders] })
  assert.ok(check(m).some(p => p.message === 'mail: only a store can have data'))
})

test('a note keyed like a prototype member is carried as a plain key', () => {
  const [entry] = tidyData([{ name: 'a', sample: { x: '1' }, notes: { constructor: 'n' } }]) as { notes: Record<string, string> }[]
  assert.equal(Object.hasOwn(entry.notes, 'constructor'), true)
  assert.deepEqual(entry.notes, { constructor: 'n' })
})

test('data of the wrong shape is carried through for check to report, never thrown at', () => {
  assert.doesNotThrow(() => tidyData(['x', { name: 'a', columns: 'c', rows: 'r', sample: 's', notes: 'n' }, { name: 'a', rows: ['r', [null]] }] as never))
})

test('an edit that only changes a store\'s data is named for it', () => {
  assert.equal(describeEdit(shop(), putObject(shop(), { id: 'db', data: [orders] })), 'Changed Orders DB\'s data')
})

test('a data that is not a list is carried through for check to report, not thrown at', () => {
  for (const data of ['x', '', {}]) assert.equal(JSON.stringify(tidyData(data as never)), JSON.stringify(data))
  const m = putObject(shop(), { id: 'db', data: 'oops' as never })
  assert.equal(m.objects.db.data, 'oops')
  assert.ok(check(m).some(p => p.message === 'db: data must be a list of entries'))
})

test('a hand-written __proto__ key stays an own key and changes no prototype', () => {
  const entry = JSON.parse('{"name":"x","__proto__":{"columns":["a"]},"columns":["b"]}')
  const column = JSON.parse('{"name":"c","__proto__":{"to":"t"}}')
  const [tidyEntry] = tidyData([entry, { name: 'y', columns: [column] }]) as Record<string, unknown>[]
  assert.equal(Object.getPrototypeOf(tidyEntry), Object.prototype)
  assert.equal(Object.hasOwn(tidyEntry, '__proto__'), true)
  const [, tidyColumn] = tidyData([entry, { name: 'y', columns: [column] }]) as { columns: object[] }[]
  assert.equal(Object.getPrototypeOf(tidyColumn.columns[0]), Object.prototype)
})
