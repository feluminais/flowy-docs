import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DASHES } from '../src/core/kinds.ts'

/**
 * A line's kind is drawn by Line.tsx (the pattern as a class, the marks as `.kmark` paths) and coloured and dashed by the stylesheet. These pin the parts the
 * stylesheet owns: a mark is the colour of its line in every state the line's head is, and the dash-dot is core's, with the places it must not show.
 */
const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selectors: m[1].split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean), body: m[2] }))
const valueOf = (body: string, property: string) => body.match(new RegExp(String.raw`(?:^|[;\s])${property}\s*:\s*([^;]+)`))?.[1].trim()
const rulesFor = (selector: string) => rules.filter(r => r.selectors.includes(selector))

test("every state that colours a line's head colours its kind marks the same", () => {
  const heads = rules.flatMap(r => {
    const fill = valueOf(r.body, 'fill')
    return fill === undefined ? [] : r.selectors.filter(s => /\.head\b/.test(s)).map(s => ({ selector: s, fill }))
  })
  assert.ok(heads.length >= 6, 'the states that colour a head were found')
  for (const { selector, fill } of heads) {
    const mark = selector.replace(/\.head\b/, '.kmark')
    const found = rulesFor(mark).filter(r => valueOf(r.body, '--c') !== undefined)
    assert.ok(found.length > 0, `${selector} colours the head ${fill}, and nothing sets the colour of ${mark}`)
    assert.equal(valueOf(found.at(-1)!.body, '--c'), fill, mark)
  }
})

test('a mark paints itself in its colour: filled, only an outline, or an outline over the background', () => {
  assert.equal(valueOf(rulesFor('.kmark').at(-1)!.body, '--c'), 'var(--edge)')
  assert.equal(valueOf(rulesFor('.kmark').at(-1)!.body, 'pointer-events'), 'none')
  assert.equal(valueOf(rulesFor('.kmark.fill')[0].body, 'fill'), 'var(--c)')
  assert.equal(valueOf(rulesFor('.kmark.stroke')[0].body, 'stroke'), 'var(--c)')
  assert.equal(valueOf(rulesFor('.kmark.stroke')[0].body, 'fill'), 'none')
  assert.equal(valueOf(rulesFor('.kmark.hollow')[0].body, 'fill'), 'var(--bg)')
  assert.equal(valueOf(rulesFor('.kmark.hollow')[0].body, 'stroke'), 'var(--c)')
})

test("the dash-dot of an extension point is core's, and a lit line, a step's line, a lane and a run's traffic keep their own", () => {
  const dash = rulesFor('.react-flow__edge-path.dashdot')
  assert.equal(dash.length, 1)
  assert.equal(valueOf(dash[0].body, 'stroke-dasharray'), DASHES.dashdot.join(' '))
  const at = (selector: string) => rules.findIndex(r => r.selectors.includes(selector))
  const lit = rulesFor('.react-flow__edge.active .react-flow__edge-path')
  assert.equal(valueOf(lit[0].body, 'stroke-dasharray'), 'none', 'a lit line is solid')
  assert.ok(at('.react-flow__edge-path.dashdot') < at('.react-flow__edge.active .react-flow__edge-path'))
  assert.equal(valueOf(rulesFor('.react-flow__edge.lane .react-flow__edge-path')[0].body, 'stroke-dasharray'), '4 5')
  assert.equal(valueOf(rulesFor('.react-flow__edge.step .react-flow__edge-path').at(-1)!.body, 'stroke-dasharray'), '8 5')
  const loaded = '.canvas.loaded .react-flow__edge:not(.lane, .step) .react-flow__edge-path.dashdot'
  assert.equal(valueOf(rulesFor(loaded)[0].body, 'stroke-dasharray'), 'none', 'under traffic the pattern is solid and the marks stay')
})

test("beside a flow's card the key stops 16px short of the card's 460, and with the navigator open it gives up the navigator's width as well as its own start", () => {
  const room = (selector: string) => valueOf(rulesFor(selector).at(-1)!.body, 'max-width')
  assert.equal(room('.kind-key.beside-player'), 'max(190px, calc(50% - 230px - 16px - 60px))')
  assert.equal(room('.canvas.nav .kind-key.beside-player'), 'max(190px, calc(50% - 230px - 16px - 60px - var(--nav-w)))')
  assert.equal(valueOf(rulesFor('.player')[0].body, 'width'), 'min(460px, calc(100% - 32px))', 'the card is as wide as the key assumes')
})
