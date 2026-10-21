import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { marksOf, STATE_NAMES, statesAt } from '../src/core/states.ts'
import { stopsOf } from '../src/core/structure.ts'
import { toGraph } from '../ui/src/graph.ts'
import { shop } from './fixtures.ts'

const byId = <T extends { id: string }>(items: T[]) => Object.fromEntries(items.map(i => [i.id, i]))

test('graph: a box in a stopped state carries data.state, and the rest carry none', () => {
  const marks = marksOf(shop(), { api: 'stopped' })
  const { nodes } = toGraph(shop(), 'shop', undefined, [], marks)
  const box = byId(nodes)
  assert.deepEqual(box.api.data.state, { state: 'stopped', inside: false })
  assert.equal(Object.hasOwn(box.web.data, 'state'), false)
  assert.equal(Object.hasOwn(box.db.data, 'state'), false)
})

test('graph: a container with a stopped child carries inside, and one with a state of its own carries that', () => {
  const stopped = marksOf(shop(), { orders: 'stopped' })
  assert.deepEqual(byId(toGraph(shop(), 'root', undefined, [], stopped).nodes).shop.data.state, { state: 'stopped', inside: true })
  assert.deepEqual(byId(toGraph(shop(), 'shop', undefined, [], stopped).nodes).api.data.state, { state: 'stopped', inside: true })
  const own = marksOf(shop(), { orders: 'stopped', shop: 'degraded' })
  assert.deepEqual(byId(toGraph(shop(), 'root', undefined, [], own).nodes).shop.data.state, { state: 'degraded', inside: false })
})

test('graph: with no states the nodes are exactly what they were', () => {
  const plain = toGraph(shop(), 'shop', { ends: [['web', 'api']], steps: [0] })
  const none = toGraph(shop(), 'shop', { ends: [['web', 'api']], steps: [0] }, [], {})
  assert.deepEqual(none.nodes, plain.nodes)
  assert.ok(plain.nodes.every(n => !Object.hasOwn(n.data, 'state')))
})

test('graph: the marks of a stop on show come from the flow\'s steps', () => {
  const m = shop()
  m.flows.checkout.steps[1].states = { api: 'restarting' }
  const flow = m.flows.checkout
  const stops = stopsOf(flow)
  const at = (k: number) => byId(toGraph(m, 'shop', { ends: [['customer', 'web'], ['web', 'api'], ['api', 'db']], steps: [k] }, [], marksOf(m, statesAt(flow, stops, k))).nodes)
  assert.equal(Object.hasOwn(at(0).api.data, 'state'), false)
  assert.deepEqual(at(1).api.data.state, { state: 'restarting', inside: false })
  assert.deepEqual(at(2).api.data.state, { state: 'restarting', inside: false }) // it holds
})

/** The css with its comments taken out, and the text of every `@media (prefers-reduced-motion: no-preference)` block (brace-matched). */
function parts() {
  const css = readFileSync(join(import.meta.dirname, '../ui/src/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const inside: string[] = []
  const rest: string[] = []
  const head = '@media (prefers-reduced-motion: no-preference)'
  let from = 0
  for (let at = css.indexOf(head); at !== -1; at = css.indexOf(head, from)) {
    rest.push(css.slice(from, at))
    let depth = 0
    let i = css.indexOf('{', at)
    const start = i
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    inside.push(css.slice(start + 1, i))
    from = i + 1
  }
  rest.push(css.slice(from))
  return { css, inside: inside.join('\n'), rest: rest.join('\n') }
}

test('css: style.css defines a rule for each state class, with its colour and its dash', () => {
  const { css } = parts()
  for (const name of STATE_NAMES.filter(n => n !== 'running')) {
    const rule = new RegExp(`(^|[\\s}])\\.state-${name}\\s*\\{([^}]*)\\}`).exec(css)
    assert.ok(rule, `.state-${name} has a rule`)
    for (const property of ['--sc', '--sd', '--sk', '--sdim', '--sg']) assert.ok(rule[2].includes(`${property}:`), `.state-${name} sets ${property}`)
  }
  assert.ok(!/\.state-running\b/.test(css), 'Running draws nothing, so it has no class')
})

test('css: a reduced-motion guard around every keyframes the states use, and around everything that plays them', () => {
  const { inside, rest } = parts()
  const names = [...(inside + rest).matchAll(/@keyframes\s+(state-[\w-]+)/g)].map(m => m[1])
  assert.ok(names.length >= 6, 'the states have keyframes')
  for (const name of names) {
    assert.ok(new RegExp(`@keyframes\\s+${name}\\b`).test(inside), `@keyframes ${name} is under prefers-reduced-motion: no-preference`)
    assert.equal(new RegExp(`@keyframes\\s+${name}\\b`).test(rest), false, `@keyframes ${name} is not outside the guard`)
    assert.equal(new RegExp(`animation:[^;]*\\b${name}\\b`).test(rest), false, `${name} is played only under the guard`)
  }
})

test('css: a state beats the strain colour on the same shape', () => {
  const { css } = parts()
  assert.match(css, /\.box\.stated\.strained \.shape path\s*\{[^}]*stroke: var\(--line\)/)
  assert.match(css, /\.box\.stated\.strained \.shape\s*\{[^}]*filter: grayscale/)
})
