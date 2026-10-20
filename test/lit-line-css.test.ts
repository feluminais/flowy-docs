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

test('the rule that reads --lit leaves faint and dim edges to their own fade', () => {
  const rules = [...css.matchAll(/([^{}]+)\{[^{}]*var\(--lit[^{}]*\}/g)].map(m => m[1].trim())
  assert.equal(rules.length, 1, 'one rule reads --lit')
  const selectors = rules[0].split(/,(?![^(]*\))/).map(s => s.trim())
  assert.deepEqual(selectors.map(s => s.replace(/:not\([^)]*\)/g, '')), ['.react-flow__edge.active', '.react-flow__edge.step'])
  for (const selector of selectors) {
    const not = selector.match(/:not\(([^)]*)\)/)?.[1] ?? ''
    for (const cls of ['.faint', '.dim']) assert.ok(not.includes(cls), `${selector} must leave ${cls} edges alone`)
  }
})
