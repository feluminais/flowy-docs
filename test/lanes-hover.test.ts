import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SIBLING_OPACITY } from '../src/core/lanes.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { computeView } from '../src/core/views.ts'
import { inPair } from '../ui/src/graph.ts'

// Pointing at one line of a pair of lines side by side: it is drawn above the others of its pair and they fade to 85 percent. The lines are ordered by the stylesheet (React Flow gives each
// line an svg of its own) and by the rules below it; Line.tsx names the states. browser-tests/pairs.spec.ts checks the rendered page.

const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

const body = (selector: string): string => {
  const rule = css.split('}').map(r => r.trim()).find(r => r.startsWith(`${selector} {`))
  assert.ok(rule, `style.css has a rule for ${selector}`)
  return rule.slice(rule.indexOf('{') + 1)
}

test('the other lines of a pair fade to the opacity the core names, and the same in the desktop', () => {
  assert.equal(SIBLING_OPACITY, 0.85)
  assert.match(body('.lane-mate'), new RegExp(`opacity:\\s*${SIBLING_OPACITY}\\s*;`))
})

test('the line pointed at is lifted over its pair, and over a lit line (z-index 1)', () => {
  const lifted = body('.react-flow__edges svg:has(.react-flow__edge-path.raised)')
  const z = Number(lifted.match(/z-index:\s*(\d+)\s*!important/)?.[1])
  assert.ok(z > 1, 'a lit line has z-index 1 (litLine in ui/src/graph.ts), and the inline z-index of React Flow needs !important to be beaten')
})

test('a line of a pair is told from the lines of other pairs by its id, even when one pair id starts with another', () => {
  const connect = (from: string, to: string, label: string) => ({ from, to, label })
  const model: Model = {
    ...emptyModel(), meta: { pairs: 'separate' },
    objects: { a: { type: 'system', name: 'A' }, b: { type: 'system', name: 'B' }, bc: { type: 'system', name: 'BC' } },
    connections: [connect('a', 'b', 'one'), connect('a', 'b', 'two'), connect('a', 'bc', 'three'), connect('a', 'bc', 'four')],
  }
  const strands = computeView(model, 'root').strands!
  assert.equal(strands.length, 4)
  for (const s of strands) {
    for (const other of strands) assert.equal(inPair(other.id, s.pair), other.pair === s.pair, `${other.id} in ${s.pair}`)
    assert.equal(inPair(s.pair, s.pair), false) // the pair's own id is not one of its lines
  }
})
