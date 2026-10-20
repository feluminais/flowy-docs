import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stringify } from 'yaml'
import { fileData, parseModelFile, serializeFile, serializeModelFile } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { shop } from './fixtures.ts'

const entries = [
  {
    name: 'orders', kind: 'table', limits: 'Kept 7 years, then archived',
    columns: [{ name: 'id', key: 'primary' }, { name: 'customer_id', to: 'customers' }, 'status', { name: 'total', note: 'Cents, not decimals. Rounding broke the first tax run.' }],
    rows: [['o_1042', 'c_77', 'placed', '2490'], ['o_1043', 'c_12', '', '1380']],
  },
  { name: 'Keys', columns: ['Key', 'Value', 'Expires'], rows: [['menu:{restaurantId}', '{ items, prices, hours }', '5 min']] },
  { name: 'restaurants', sample: { _id: 'r_42', tags: ['ramen', 'vegan'], hours: { mon: '11-22' }, items: [{ name: 'Pho' }] }, notes: { hours: 'Inside the profile.' } },
]

function withData(data: unknown): Model {
  const m = shop()
  ;(m.objects.db as Record<string, unknown>).data = data
  return m
}

/** What the model reads back as after a save. */
const roundTrip = (m: Model) => parseModelFile(serializeModelFile(m)).objects.db.data

test('a model without data is written exactly as before', () => {
  assert.equal(serializeModelFile(shop()), stringify(fileData(shop(), 'model.yaml'), { schema: 'failsafe', lineWidth: 0, aliasDuplicateObjects: false }))
})

test('data is written on compact lines', () => {
  const block = `    data:
      - name: orders
        kind: table
        limits: Kept 7 years, then archived
        columns:
          - {name: id, key: primary}
          - {name: customer_id, to: customers}
          - status
          - {name: total, note: "Cents, not decimals. Rounding broke the first tax run."}
        rows:
          - [o_1042, c_77, placed, 2490]
          - [o_1043, c_12, "", 1380]
      - name: Keys
        columns: [Key, Value, Expires]
        rows:
          - ["menu:{restaurantId}", "{ items, prices, hours }", 5 min]
      - name: restaurants
        sample:
          _id: r_42
          tags: [ramen, vegan]
          hours:
            mon: 11-22
          items:
            - name: Pho
        notes:
          hours: Inside the profile.
`
  const text = serializeModelFile(withData(entries))
  assert.ok(text.includes(block), text)
})

test('data reads back unchanged and writes the same text again', () => {
  const m = withData(entries)
  const text = serializeModelFile(m)
  assert.deepEqual(roundTrip(m), entries)
  assert.equal(serializeModelFile({ ...shop(), ...parseModelFile(text) }), text)
})

test('hostile text in a cell, a note and a sample survives a save', () => {
  const cells = ['a: b', '# not a comment', '"quoted"', "it's", '- dash', '[x]', '{x}', ' leading', 'trailing ', '', 'null', '~', '007', 'a, b', 'two\nlines']
  const data = [
    { name: 'a', columns: cells.map((_, i) => ({ name: `c${i}`, note: cells[i] || 'blank' })), rows: [cells] },
    { name: 'b', sample: { list: cells, text: 'a: b # c' }, notes: { text: 'x: y, z' } },
  ]
  assert.deepEqual(roundTrip(withData(data)), data)
})

test('serializeFile writes model.yaml the same way', () => {
  const m = withData(entries)
  assert.equal(serializeFile('model.yaml', fileData(m, 'model.yaml')), serializeModelFile(m))
})

test('data of the wrong shape is written without throwing and reads back as it was', () => {
  for (const data of ['x', { a: '1' }, [['a']], ['row'], [{ name: 'a', columns: 'c', rows: 'r' }], [{ name: 'a', columns: ['x'], rows: ['r', [['n']]] }], [{ name: 'a', sample: ['x', ''] }]]) {
    assert.deepEqual(roundTrip(withData(data)), data, JSON.stringify(data))
  }
})
