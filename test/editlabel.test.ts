import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeEdit } from '../src/core/editlabel.ts'
import { CASES } from '../desktop/fixtures/editlabel.ts'

// The table is in desktop/fixtures/editlabel.ts: the C# tests read the same cases.
for (const { name, before, after, label } of CASES) {
  test(`an edit is named: ${name}`, () => {
    assert.equal(describeEdit(before, after), label)
  })
}

test('naming an edit does not change the models', () => {
  for (const { before, after } of CASES) {
    const [b, a] = [JSON.stringify(before), JSON.stringify(after)]
    describeEdit(before, after)
    assert.equal(JSON.stringify(before), b)
    assert.equal(JSON.stringify(after), a)
  }
})

test('the order of keys inside an object is not a change', () => {
  const [{ before }] = CASES
  const reordered = structuredClone(before)
  reordered.objects.api = Object.fromEntries(Object.entries(reordered.objects.api).reverse()) as typeof reordered.objects.api
  assert.equal(describeEdit(before, reordered), undefined)
})
