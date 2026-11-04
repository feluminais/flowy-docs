import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { FILES, MARK_NAMES, SHEET_COLOURS, kindsSvg, marksSvg } from '../docs/images/kinds-svg.ts'
import { DASHES, KIND_IDS, KINDS, PLAIN_NAME, markPath } from '../src/core/kinds.ts'

const read = (file: string) => readFileSync(join(import.meta.dirname, '../docs/images', file), 'utf8').replaceAll('\r\n', '\n')

test('the committed pictures of the kinds guide are what the generator makes (run: node docs/images/kinds-svg.ts)', () => {
  for (const [file, make] of Object.entries(FILES)) assert.equal(read(file), make(), `${file} is stale`)
})

test('the kinds picture has every kind, with its name, its word and the marks core draws it with', () => {
  const svg = kindsSvg()
  for (const id of KIND_IDS) {
    assert.ok(svg.includes(`>${KINDS[id].name}<`), `${id}: name`)
    assert.ok(svg.includes(`>kind: ${id}<`), `${id}: word`)
    for (const mark of [KINDS[id].look.head, KINDS[id].look.tail]) if (mark !== 'none') assert.ok(svg.includes(`d="${markPath(mark)}"`), `${id}: ${mark}`)
  }
  assert.ok(svg.includes(`>${PLAIN_NAME}<`))
  assert.ok(svg.includes(`stroke-dasharray="${DASHES.dashdot.join(' ')}"`), 'the dash-dot of the extension point')
  assert.equal(svg.match(/stroke-dasharray/g)?.length, 1, 'only the extension point is dashed')
})

test('the marks picture names every mark once and draws each of the five marks and the dash-dot', () => {
  const svg = marksSvg()
  for (const { name } of MARK_NAMES) assert.ok(svg.includes(`>${name}<`), name)
  for (const shape of ['filled', 'open', 'double', 'ring', 'diamond'] as const) assert.ok(svg.includes(`d="${markPath(shape)}"`), shape)
  assert.ok(svg.includes('stroke-dasharray'))
})

test("the colours of both pictures are the app's tokens, light and dark", () => {
  const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8')
  const block = (start: string) => css.slice(css.indexOf(start), css.indexOf('}', css.indexOf(start)))
  const token = (b: string, name: string) => b.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`))![1]
  for (const [scheme, start] of [['light', ':root {'], ['dark', ":root[data-theme='dark'] {"]] as const) {
    const b = block(start)
    for (const [name, value] of Object.entries(SHEET_COLOURS[scheme])) assert.equal(value, token(b, name), `${scheme} --${name}`)
  }
  for (const svg of [kindsSvg(), marksSvg()]) assert.ok(!/[–—]/.test(svg), 'no dashes in the words')
})
