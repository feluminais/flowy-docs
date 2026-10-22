import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { animationOf } from '../src/core/animation.ts'
import { linksOf } from '../src/core/model.ts'
import { loadState } from '../src/node/files.ts'

/** Plum shows how a request can end, every kind of step and a link and a drawn shape, so the guide and the screenshots have a real example of each. */
const state = await loadState(join(import.meta.dirname, '../docs/demo/flowy'))
assert.ok('model' in state && 'flows' in state, 'the demo folder should load')
const animations = Object.values(state.flows).flatMap(f => f.steps.map(s => animationOf(s))).filter(a => a !== undefined)

test('the demo loads with nothing wrong in it', () => {
  assert.deepEqual(state.problems, [])
})

test('Plum has a flow for every way a request ends', () => {
  const outcomes = new Set(animations.map(a => a.outcome).filter(o => o !== undefined))
  assert.deepEqual([...outcomes].sort(), ['delayed', 'duplicated', 'fail', 'intercepted', 'lost', 'rejected', 'timeout'])
})

test('an intercepted request names who took it', () => {
  const taken = animations.find(a => a.outcome === 'intercepted')
  assert.deepEqual(taken?.by, { name: 'Hotel wifi portal' })
})

test('Plum plays every kind of step, and a callback that something outside set off', () => {
  assert.deepEqual([...new Set(animations.map(a => a.kind))].sort(), ['call', 'callback', 'event', 'send'])
  assert.ok(animations.some(a => a.kind === 'callback' && a.trigger === 'outside'), 'a callback from outside')
  assert.ok(animations.some(a => a.kind === 'callback' && a.trigger === 'inside'), 'a callback that the step before set off')
})

test('a flow link, a link on a shape, a drawn shape and an icon are on show', () => {
  const objects = Object.values(state.model.objects)
  assert.ok(objects.some(o => linksOf(o).some(l => l.url.startsWith('https://'))), 'a link to a site')
  assert.ok(objects.some(o => linksOf(o).some(l => !l.url.startsWith('http'))), 'a link to a file in the repo')
  assert.equal(state.model.objects['templates'].shape, 'document')
  assert.equal(state.model.objects['courier'].icon, 'truck')
})
