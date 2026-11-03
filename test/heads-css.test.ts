import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A line's arrowhead (Heads in ui/src/Line.tsx) is a filled path beside the line's own stroke, so it takes its colour from the stylesheet. Every rule that colours
 * the line in a state (picked, pointed at, lit, a problem, a failing part) has to colour the head the same, or that state shows a head in the wrong colour.
 */
const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selectors: m[1].split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean), body: m[2] }))
const valueOf = (body: string, property: string) => body.match(new RegExp(String.raw`(?:^|[;\s])${property}\s*:\s*([^;]+)`))?.[1].trim()

/** The selector for a line's head that matches the same lines as a selector for its stroke. */
const headSelector = (stroke: string) => {
  const head = stroke.replace('.react-flow__edge-path', '.head')
  return head.startsWith('.head') ? `.react-flow__edge ${head}` : head
}

test('every state that colours a line colours its arrowhead the same', () => {
  const strokes = rules.flatMap(r => {
    const colour = valueOf(r.body, 'stroke')
    return colour === undefined ? [] : r.selectors.filter(s => s.includes('.react-flow__edge-path')).map(s => ({ selector: s, colour }))
  })
  assert.ok(strokes.length >= 5, 'the states that colour a line were found')
  for (const { selector, colour } of strokes) {
    const head = headSelector(selector)
    const found = rules.filter(r => r.selectors.includes(head) && valueOf(r.body, 'fill') !== undefined)
    assert.ok(found.length > 0, `${selector} colours the line ${colour}, and nothing colours ${head}`)
    assert.equal(valueOf(found.at(-1)!.body, 'fill'), colour, head)
  }
})

test('a head is the colour of a quiet line, and takes no clicks', () => {
  const base = rules.find(r => r.selectors.includes('.react-flow__edge .head'))
  assert.equal(valueOf(base?.body ?? '', 'fill'), 'var(--edge)')
  assert.equal(valueOf(base?.body ?? '', 'pointer-events'), 'none')
  assert.match(css, /--xy-edge-stroke:\s*var\(--edge\)/)
})

test('a picked or focused line is the accent colour, head and all, though React Flow colours it itself', () => {
  assert.match(css, /--xy-edge-stroke-selected:\s*var\(--accent\)/)
  const focus = rules.find(r => r.selectors.includes('.react-flow__edge.selectable:focus .head'))
  assert.ok(focus?.selectors.includes('.react-flow__edge.selectable:focus-visible .head'))
  assert.match(valueOf(focus?.body ?? '', 'fill') ?? '', /--xy-edge-stroke-selected/)
})
