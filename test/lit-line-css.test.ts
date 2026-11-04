import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A step that times out dims the lines it lit through the custom property `--lit` (ui/src/StepMotion.tsx). The rule that reads it has the
 * same specificity as the ones that fade an edge (`faint`, `dim`) and comes after them, so unless it leaves those edges alone it wins
 * and a lit line stops fading when another box is picked or the Failures tab dims it, as the desktop's BackLayer.Fade does.
 */
const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

test('the rules that read --lit leave faint and dim edges to their own fade', () => {
  const rules = [...css.matchAll(/([^{}]+)\{[^{}]*var\((--lit(?:-several)?)[,)][^{}]*\}/g)].map(m => ({ selector: m[1].trim(), property: m[2] }))
  assert.deepEqual(rules.map(r => r.property), ['--lit', '--lit-several'], 'one rule reads --lit and one reads --lit-several')
  const [plain, several] = rules.map(r => r.selector.split(/,(?![^(]*\))/).map(s => s.trim()))
  assert.deepEqual(plain.map(s => s.replace(/:not\([^)]*\)/g, '')), ['.react-flow__edge.active', '.react-flow__edge.step'])
  // A lit line among the other lines of its pair fades to half (LIT_FLOOR_LANES), through its own property; the first rule keeps the quarter every other line fades to.
  assert.deepEqual(several.map(s => s.replace(/:not\([^)]*\)/g, '')), ['.react-flow__edge.active.several'])
  for (const selector of [...plain, ...several]) {
    const not = selector.match(/:not\(([^)]*)\)/)?.[1] ?? ''
    for (const cls of ['.faint', '.dim']) assert.ok(not.includes(cls), `${selector} must leave ${cls} edges alone`)
  }
})
