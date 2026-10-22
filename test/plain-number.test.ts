import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLayoutFile } from '../src/core/modelfiles.ts'
import { blank, plainNumber } from '../src/core/text.ts'

test('a number in a file is plain decimal text, and nothing JavaScript would also take', () => {
  const read: [string, number | undefined][] = [
    ['0', 0], ['12', 12], ['-3.5', -3.5], ['+7', 7], ['.5', 0.5], ['5.', 5], ['-.5', -0.5], ['1e3', 1000], ['1E-3', 0.001], ['  42  ', 42], ['\t8\n', 8],
    ['0x10', undefined], ['0b11', undefined], ['0o7', undefined], ['Infinity', undefined], ['-Infinity', undefined], ['NaN', undefined],
    ['1e999', undefined], ['1_000', undefined], ['1,5', undefined], ['', undefined], [' ', undefined], ['.', undefined], ['+', undefined], ['--1', undefined],
    ['1 2', undefined], ['1e', undefined], ['e5', undefined], ['0x', undefined], ['\u00a05', undefined], ['\u3000 5', undefined], ['٣', undefined], ['１', undefined],
  ]
  for (const [text, want] of read) assert.equal(plainNumber(text), want, JSON.stringify(text))
  for (const notText of [1, null, undefined, {}, []]) assert.equal(plainNumber(notText), undefined)
})

test('a layout position is two plain numbers within a million of zero', () => {
  const point = (x: string, y: string) => parseLayoutFile(`root:\n  shop: [${x}, ${y}]\n`)
  assert.deepEqual(point('"10"', '"-20.5"').root.shop, [10, -20.5])
  assert.deepEqual(point('"1000000"', '"-1000000"').root.shop, [1_000_000, -1_000_000])
  for (const [x, y] of [['"1000001"', '"0"'], ['"0"', '"-1000001"'], ['"0x10"', '"1"'], ['"1"', '"Infinity"']]) {
    assert.throws(() => point(x, y), /root → shop must be \[x, y\], each between -1000000 and 1000000/, `${x}, ${y}`)
  }
})

test('white space is what JavaScript trims, a byte order mark included', () => {
  assert.equal(blank('\ufeff'), true)
  assert.equal(blank(' \u00a0\u2028 '), true)
  assert.equal(blank('\u0085'), false)
})
