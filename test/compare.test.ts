import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareOf, compareProblem, linkedIds, partnersOf, withCompare } from '../src/core/compare.ts'

test('compareOf reads the short and the long form', () => {
  assert.deepEqual(compareOf('a'), { with: 'a' })
  assert.deepEqual(compareOf({ with: 'a' }), { with: 'a' })
  assert.deepEqual(compareOf({ with: 'a', note: 'why' }), { with: 'a', note: 'why' })
})

test('compareOf drops a blank note and reads anything else as no tag', () => {
  assert.deepEqual(compareOf({ with: 'a', note: ' ' }), { with: 'a' })
  assert.deepEqual(compareOf({ with: 'a', note: 3 }), { with: 'a' })
  for (const bad of [undefined, null, '', '  ', 3, ['a'], {}, { note: 'x' }, { with: '' }, { with: 3 }]) assert.equal(compareOf(bad), undefined)
})

test('compareProblem is quiet for an absent or readable value and names the kind otherwise', () => {
  assert.equal(compareProblem(undefined, 'flow'), undefined)
  assert.equal(compareProblem('a', 'flow'), undefined)
  assert.equal(compareProblem({ with: 'a', note: 'x' }, 'run'), undefined)
  assert.equal(compareProblem(['a'], 'flow'), 'compare must be a flow id, or { with, note } with text')
  assert.equal(compareProblem({ note: 'x' }, 'run'), 'compare must be a run id, or { with, note } with text')
  assert.equal(compareProblem('', 'flow'), 'compare must be a flow id, or { with, note } with text')
})

test('partnersOf lists every item that tags the id, in key order', () => {
  assert.deepEqual(partnersOf({ a: {}, b: { compare: 'a' }, c: { compare: 'a' } }, 'a'), [
    { id: 'b', side: 'after' },
    { id: 'c', side: 'after' },
  ])
})

test('partnersOf lists what the id tags first, as the older side, with its note', () => {
  const items = { a: { compare: { with: 'z', note: 'n' } }, b: { compare: 'a', x: 1 }, z: {} }
  assert.deepEqual(partnersOf(items, 'a'), [{ id: 'z', side: 'before', note: 'n' }, { id: 'b', side: 'after' }])
})

test('a mutual pair lists once, as the id\'s own tag', () => {
  const items = { a: { compare: 'b' }, b: { compare: 'a' } }
  assert.deepEqual(partnersOf(items, 'a'), [{ id: 'b', side: 'before' }])
  assert.deepEqual(partnersOf(items, 'b'), [{ id: 'a', side: 'before' }])
})

test('an item never lists itself', () => {
  assert.deepEqual(partnersOf({ a: { compare: 'a' } }, 'a'), [])
  assert.deepEqual(partnersOf({ a: { compare: 'a' }, b: { compare: 'a' } }, 'a'), [{ id: 'b', side: 'after' }])
})

test('a tag to a missing item is still listed, so the UI can grey it out', () => {
  assert.deepEqual(partnersOf({ a: { compare: 'gone' } }, 'a'), [{ id: 'gone', side: 'before' }])
  assert.deepEqual(partnersOf({}, 'nobody'), [])
})

test('linkedIds holds every id that tags or is tagged, where the target exists', () => {
  const items = { a: { compare: 'b' }, b: {}, c: {}, d: { compare: 'gone' }, e: { compare: 'e' } }
  assert.deepEqual([...linkedIds(items)].sort(), ['a', 'b'])
})

test('withCompare sets the tag last, keeping the other keys in order', () => {
  const out = withCompare({ name: 'x', steps: [] as string[] }, { with: 'a' })
  assert.deepEqual(Object.keys(out), ['name', 'steps', 'compare'])
  assert.equal((out as { compare?: unknown }).compare, 'a')
})

test('withCompare writes the long form only when there is a note', () => {
  const out = withCompare({ name: 'x' }, { with: 'a', note: 'why' }) as { compare?: unknown }
  assert.deepEqual(out.compare, { with: 'a', note: 'why' })
})

test('withCompare changes a tag where it stands and removes it for undefined', () => {
  const tagged = { name: 'x', compare: 'a', steps: [] as string[] }
  assert.deepEqual(Object.keys(withCompare(tagged, { with: 'b' })), ['name', 'compare', 'steps'])
  assert.equal((withCompare(tagged, { with: 'b' }) as { compare?: unknown }).compare, 'b')
  const removed = withCompare(tagged, undefined)
  assert.deepEqual(Object.keys(removed), ['name', 'steps'])
  assert.ok(!('compare' in removed))
  assert.equal(tagged.compare, 'a')
})
