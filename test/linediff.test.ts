import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffLines } from '../src/core/linediff.ts'

test('identical text is all same, numbered from 1', () => {
  assert.deepEqual(diffLines('a\nb\n', 'a\nb\n'), [
    { kind: 'same', text: 'a', line: 1 },
    { kind: 'same', text: 'b', line: 2 },
  ])
})

test('a changed line is removed, then added', () => {
  assert.deepEqual(diffLines('a\nb\nc\n', 'a\nB\nc\n'), [
    { kind: 'same', text: 'a', line: 1 },
    { kind: 'remove', text: 'b' },
    { kind: 'add', text: 'B', line: 2 },
    { kind: 'same', text: 'c', line: 3 },
  ])
})

test('a tie goes to the removal', () => {
  assert.deepEqual(diffLines('a\nx\n', 'x\na\n'), [
    { kind: 'remove', text: 'a' },
    { kind: 'same', text: 'x', line: 1 },
    { kind: 'add', text: 'a', line: 2 },
  ])
})

test('an empty base is all adds and an empty next is all removes', () => {
  assert.deepEqual(diffLines('', 'a\nb\n'), [
    { kind: 'add', text: 'a', line: 1 },
    { kind: 'add', text: 'b', line: 2 },
  ])
  assert.deepEqual(diffLines('a\nb\n', ''), [
    { kind: 'remove', text: 'a' },
    { kind: 'remove', text: 'b' },
  ])
})

test('two empty strings give no marks', () => {
  assert.deepEqual(diffLines('', ''), [])
})

test('line endings and the final newline are not compared', () => {
  const marks = diffLines('a\r\nb', 'a\nb\n')
  assert.deepEqual(marks, [
    { kind: 'same', text: 'a', line: 1 },
    { kind: 'same', text: 'b', line: 2 },
  ])
})

test('a blank line is a line', () => {
  assert.deepEqual(diffLines('a\n\nb\n', 'a\nb\n'), [
    { kind: 'same', text: 'a', line: 1 },
    { kind: 'remove', text: '' },
    { kind: 'same', text: 'b', line: 2 },
  ])
})

test('a moved block is a remove and an add', () => {
  assert.deepEqual(diffLines('a\nb\nc\nd\n', 'c\nd\na\nb\n'), [
    { kind: 'remove', text: 'a' },
    { kind: 'remove', text: 'b' },
    { kind: 'same', text: 'c', line: 1 },
    { kind: 'same', text: 'd', line: 2 },
    { kind: 'add', text: 'a', line: 3 },
    { kind: 'add', text: 'b', line: 4 },
  ])
})

test('a middle over 4,000,000 cells falls back to all removes, then all adds', () => {
  const lines = (prefix: string) => Array.from({ length: 2100 }, (_, i) => `${prefix}${i}`).join('\n')
  const marks = diffLines(lines('a'), lines('b'))
  assert.equal(marks.length, 4200)
  assert.ok(marks.slice(0, 2100).every(m => m.kind === 'remove'))
  assert.ok(marks.slice(2100).every(m => m.kind === 'add'))
  assert.deepEqual(marks[2100], { kind: 'add', text: 'b0', line: 1 })
})
