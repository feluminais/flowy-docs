import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { StepFile, StepInfo } from '../src/core/history.ts'
import { blockOf, canRestore, defaultFile, fileOrder, firstMark, neighbour, restoreLabel, rowsFor, scrollTarget, SOURCE_NAMES, timeLabel } from '../ui/src/yamlview.ts'
import type { Row } from '../ui/src/yamlview.ts'

const text = (t: string): StepFile => ({ text: t })
const step = (id: string): StepInfo => ({ id, time: '2026-10-20T10:00:00.000Z', label: id, source: 'you', app: 'browser', changed: [] })

test('files are listed with the model first, the flows by name, and the layout last', () => {
  assert.deepEqual(fileOrder(['layout.yaml', 'flows/b.yaml', 'model.yaml', 'flows/a.yaml']), ['model.yaml', 'flows/a.yaml', 'flows/b.yaml', 'layout.yaml'])
})

test('the file shown first is the open flow\'s, else the model, else the first there is', () => {
  const paths = ['model.yaml', 'flows/checkout.yaml', 'layout.yaml']
  assert.equal(defaultFile(paths, { flow: 'checkout' }), 'flows/checkout.yaml')
  assert.equal(defaultFile(paths, { flow: 'gone' }), 'model.yaml')
  assert.equal(defaultFile(paths, {}), 'model.yaml')
  assert.equal(defaultFile(['layout.yaml', 'flows/a.yaml'], {}), 'flows/a.yaml')
  assert.equal(defaultFile([], {}), 'model.yaml')
})

test('without a base the lines are plain and numbered from 1', () => {
  assert.deepEqual(rowsFor('model.yaml', { 'model.yaml': text('a: 1\nb: 2\n') }, undefined), [
    { kind: 'same', text: 'a: 1', line: 1 },
    { kind: 'same', text: 'b: 2', line: 2 },
  ])
})

test('a changed line is removed in place and the new one added', () => {
  const rows = rowsFor('model.yaml', { 'model.yaml': text('a: 1\nb: 3\n') }, { 'model.yaml': text('a: 1\nb: 2\n') })
  assert.deepEqual(rows, [
    { kind: 'same', text: 'a: 1', line: 1 },
    { kind: 'remove', text: 'b: 2' },
    { kind: 'add', text: 'b: 3', line: 2 },
  ])
})

test('a file the base lacks is all added; one the shown version lacks is all removed, after a note', () => {
  assert.deepEqual(rowsFor('flows/a.yaml', { 'flows/a.yaml': text('name: A\n') }, {}), [{ kind: 'add', text: 'name: A', line: 1 }])
  assert.deepEqual(rowsFor('flows/a.yaml', {}, { 'flows/a.yaml': text('name: A\nview: root\n') }), [
    { kind: 'note', text: 'Not in this version' },
    { kind: 'remove', text: 'name: A' },
    { kind: 'remove', text: 'view: root' },
  ])
})

test('a file that is not text is a note, and a file in neither version is nothing', () => {
  assert.deepEqual(rowsFor('model.yaml', { 'model.yaml': { notText: true } }, undefined), [{ kind: 'note', text: 'Not UTF-8 text' }])
  assert.deepEqual(rowsFor('model.yaml', { 'model.yaml': text('a: 1\n') }, { 'model.yaml': { notText: true } }), [{ kind: 'same', text: 'a: 1', line: 1 }])
  assert.deepEqual(rowsFor('model.yaml', {}, {}), [])
  assert.deepEqual(rowsFor('model.yaml', {}, undefined), [])
})

test('an empty file has no lines', () => {
  assert.deepEqual(rowsFor('layout.yaml', { 'layout.yaml': text('') }, undefined), [])
  assert.deepEqual(rowsFor('layout.yaml', { 'layout.yaml': text('') }, { 'layout.yaml': text('a: 1\n') }), [{ kind: 'remove', text: 'a: 1' }])
})

test('the first mark is the first line added or removed', () => {
  const rows = rowsFor('model.yaml', { 'model.yaml': text('a: 1\nb: 3\n') }, { 'model.yaml': text('a: 1\nb: 2\n') })
  assert.equal(firstMark(rows), 1)
  assert.equal(firstMark(rowsFor('model.yaml', { 'model.yaml': text('a: 1\n') }, undefined)), undefined)
})

const MODEL = [
  'title: Demo',
  'objects:',
  '  # the shop',
  '  shop:',
  '    type: system',
  '    name: Shop',
  '',
  '  web:',
  '    type: app',
  '    in: shop',
  '  web-2: { type: app, name: Second, in: shop }',
  "  'quoted':",
  '    type: actor',
  '',
  'connections: []',
].join('\n')

test('the block of a shape is its key and what is indented under it', () => {
  assert.deepEqual(blockOf(MODEL, 'shop'), { start: 4, end: 6 })
  assert.deepEqual(blockOf(MODEL, 'web'), { start: 8, end: 10 }) // not web-2, and not the blank line after
  assert.deepEqual(blockOf(MODEL, 'web-2'), { start: 11, end: 11 }) // flow style, on one line
  assert.deepEqual(blockOf(MODEL, 'quoted'), { start: 12, end: 13 })
  assert.equal(blockOf(MODEL, 'missing'), undefined)
  assert.equal(blockOf('title: x\nconnections: []\n', 'shop'), undefined)
  assert.equal(blockOf('objects: {}\n', 'shop'), undefined)
})

test('a time reads as the clock on the same day, and with the date on another', () => {
  const now = new Date('2026-10-20T20:00:00.000Z')
  assert.equal(timeLabel('2026-10-20T10:15:00.000Z', now, 'en-GB', 'UTC'), '10:15')
  const earlier = timeLabel('2026-10-19T22:56:00.000Z', now, 'en-GB', 'UTC')
  assert.ok(earlier.includes('19') && earlier.includes('22:56'), earlier)
  assert.equal(restoreLabel('2026-10-20T10:15:00.000Z', now, 'en-GB', 'UTC'), 'Restored the version from 10:15')
})

test('formatting a long list of times builds its formatters once, not once per row', () => {
  const real = Intl.DateTimeFormat
  let built = 0
  Intl.DateTimeFormat = new Proxy(real, { construct: (target, args) => { built++; return Reflect.construct(target, args) } }) as typeof Intl.DateTimeFormat
  try {
    const now = new Date('2026-10-20T20:00:00.000Z')
    for (let i = 0; i < 300; i++) timeLabel(`2026-10-1${i % 9}T10:15:00.000Z`, now, 'en-GB', 'UTC')
  } finally {
    Intl.DateTimeFormat = real
  }
  assert.ok(built <= 3, `built ${built}`)
})

test('a new version, file or comparison brings its first mark into view; a new selection only its shape\'s block', () => {
  const rows: Row[] = [
    { kind: 'same', text: 'a', line: 1 }, { kind: 'same', text: 'b', line: 2 }, { kind: 'remove', text: 'c' }, { kind: 'add', text: 'C', line: 3 }, { kind: 'same', text: 'd', line: 4 },
  ]
  const block = { start: 2, end: 2 }
  assert.equal(scrollTarget(rows, block, 'version'), 2) // the first mark wins over the block
  assert.equal(scrollTarget(rows, block, 'selection'), 1) // the block, even with marks in the file
  assert.equal(scrollTarget(rows, undefined, 'selection'), undefined) // nothing to go to: the scroll stays
  assert.equal(scrollTarget(rows, undefined, 'version'), 2)
  const plain = rows.filter(r => r.kind === 'same')
  assert.equal(scrollTarget(plain, block, 'version'), 1) // no marks: the block
  assert.equal(scrollTarget(plain, undefined, 'version'), 0) // nothing: the top
})

test('a step\'s chip names where it came from; the first look has none', () => {
  assert.deepEqual(SOURCE_NAMES, { you: 'You', ai: 'AI', outside: 'Outside', restore: 'Restored', first: undefined })
})

test('the arrow keys move between steps, newest first, and stop at the ends', () => {
  const steps = [step('c'), step('b'), step('a')]
  assert.equal(neighbour(steps, 'b', 1), 'a')
  assert.equal(neighbour(steps, 'b', -1), 'c')
  assert.equal(neighbour(steps, 'a', 1), undefined)
  assert.equal(neighbour(steps, 'c', -1), undefined)
  assert.equal(neighbour(steps, undefined, 1), 'c')
  assert.equal(neighbour(steps, 'gone', -1), 'c')
  assert.equal(neighbour([], 'a', 1), undefined)
})

test('restore is allowed while editing, or while the model is broken and editing cannot be turned on', () => {
  assert.equal(canRestore({ editing: true, broken: false }), true)
  assert.equal(canRestore({ editing: false, broken: true }), true)
  assert.equal(canRestore({ editing: true, broken: true }), true)
  assert.equal(canRestore({ editing: false, broken: false }), false)
})
