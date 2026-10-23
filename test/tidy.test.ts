import { test } from 'node:test'
import assert from 'node:assert/strict'
import { neighbourSides, sideOf, sideProblems, sideReport, tidySpots } from '../src/core/layout.ts'
import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { connect, OpError, placeBoxes, putObject, tidyLayout, tidyViews } from '../src/core/ops.ts'
import { meeting } from '../src/core/views.ts'
import { shop } from './fixtures.ts'

/** Two systems, each with two apps, that talk both ways: each one is a neighbour in the other's view. */
function pair(): Model {
  let m = emptyModel()
  for (const [id, name] of [['ordering', 'Ordering'], ['backoffice', 'Back office']]) m = putObject(m, { id, type: 'system', name })
  for (const [id, name, parent] of [['api', 'Order API', 'ordering'], ['web', 'Website', 'ordering'], ['admin', 'Admin', 'backoffice'], ['console', 'Console', 'backoffice']]) {
    m = putObject(m, { id, type: 'app', name, in: parent })
  }
  for (const [from, to] of [['web', 'api'], ['admin', 'api'], ['console', 'api'], ['api', 'admin']]) m = connect(m, { from, to })
  return m
}

const opposite = { left: 'right', right: 'left', above: 'below', below: 'above' } as const

test('an outsider meets the view in the view both share, as two boxes side by side', () => {
  const m = pair()
  assert.deepEqual(meeting(m, 'ordering', 'backoffice'), { view: 'root', here: 'ordering', there: 'backoffice' })
  assert.deepEqual(meeting(m, 'ordering', 'admin'), { view: 'root', here: 'ordering', there: 'backoffice' })
  assert.equal(meeting(m, 'ordering', 'api'), undefined, 'a member is not an outsider')
  assert.equal(meeting(m, 'ordering', 'root'), undefined, 'the top level is above, not beside')
  assert.equal(meeting(m, 'ordering', 'ordering'), undefined)
})

test('two neighbours sit on opposite sides of each other, whatever side the top level puts them on', () => {
  const m = pair()
  const [a, b] = [neighbourSides(m, 'ordering', ['backoffice']).get('backoffice')!, neighbourSides(m, 'backoffice', ['ordering']).get('ordering')!]
  assert.equal(b, opposite[a])
  // The same holds when the top level has them the other way round.
  const swapped = placeBoxes(m, 'root', { ordering: [0, 0], backoffice: [600, 0] })
  assert.equal(neighbourSides(swapped, 'ordering', ['backoffice']).get('backoffice'), 'right')
  assert.equal(neighbourSides(swapped, 'backoffice', ['ordering']).get('ordering'), 'left')
  const turned = placeBoxes(m, 'root', { ordering: [0, 0], backoffice: [0, 400] })
  assert.equal(neighbourSides(turned, 'ordering', ['backoffice']).get('backoffice'), 'below')
  assert.equal(neighbourSides(turned, 'backoffice', ['ordering']).get('ordering'), 'above')
})

test('sideOf reads the side from the centres, with the box wider than it is tall', () => {
  assert.equal(sideOf({ x: 0, y: 0 }, { x: 300, y: 100 }), 'right')
  assert.equal(sideOf({ x: 0, y: 0 }, { x: -300, y: 100 }), 'left')
  assert.equal(sideOf({ x: 0, y: 0 }, { x: 100, y: 200 }), 'below')
  assert.equal(sideOf({ x: 0, y: 0 }, { x: 100, y: -200 }), 'above')
})

test('tidyViews lays out the views that disagree, and a second run finds nothing', () => {
  const m = placeBoxes(pair(), 'root', { ordering: [0, 0], backoffice: [600, 0] })
  const { model: tidy, found } = tidyViews(m)
  assert.ok(found.length > 0, 'the default layout is not consistent here')
  for (const p of found) assert.equal(p.wanted, p.view === 'ordering' ? 'right' : 'left')
  for (const view of ['root', 'ordering', 'backoffice']) assert.deepEqual(sideProblems(tidy, view), [])
  const again = tidyViews(tidy)
  assert.deepEqual(again.found, [])
  assert.equal(again.model, tidy, 'nothing to change: the same model comes back')
})

test('tidyViews leaves a view that already agrees as it is, dragged positions and all', () => {
  const tidy = tidyViews(pair()).model
  const dragged = placeBoxes(tidy, 'ordering', { web: [0, 0], api: [0, 142], backoffice: [0, 600] })
  const again = tidyViews(dragged)
  assert.equal(again.model, dragged)
  assert.deepEqual(again.model.layout.ordering.web, [0, 0])
})

test('a view the user dragged the wrong way is found, and tidyViews can be limited to one view', () => {
  const tidy = tidyViews(pair()).model
  const wrong = placeBoxes(tidy, 'backoffice', { ordering: [0, 600] }) // the view above has Ordering above Back office
  assert.deepEqual(sideProblems(wrong, 'ordering'), [])
  assert.deepEqual(sideProblems(wrong, 'backoffice').map(p => [p.box, p.drawn, p.wanted]), [['ordering', 'below', 'above']])
  assert.deepEqual(tidyViews(wrong, 'ordering').found, [])
  const fixed = tidyViews(wrong, 'backoffice')
  assert.equal(fixed.found.length, 1)
  assert.deepEqual(sideProblems(fixed.model, 'backoffice'), [])
})

test('tidyLayout saves every box of the view as whole numbers and replaces what was dragged', () => {
  const m = placeBoxes(pair(), 'ordering', { web: [11.4, 7.6] })
  const next = tidyLayout(m, 'ordering')
  assert.deepEqual(Object.keys(next.layout.ordering).sort(), ['api', 'backoffice', 'web'])
  for (const [x, y] of Object.values(next.layout.ordering)) assert.ok(Number.isInteger(x) && Number.isInteger(y))
  assert.notDeepEqual(next.layout.ordering.web, [11, 8])
  const spots = tidySpots(m, 'ordering')
  assert.deepEqual(next.layout.ordering.api, [Math.round(spots.get('api')!.x), Math.round(spots.get('api')!.y)])
  assert.throws(() => tidyLayout(m, 'nowhere'), (e: unknown) => e instanceof OpError && /unknown view "nowhere"/.test(e.message))
})

test('tidyLayout on the top level has no neighbours to place and still saves the layout', () => {
  const next = tidyLayout(shop(), 'root')
  assert.deepEqual(Object.keys(next.layout.root).sort(), ['customer', 'mail', 'shop'])
})

test('the report names the views and what moves, and says when nothing does', () => {
  const m = placeBoxes(pair(), 'root', { ordering: [0, 0], backoffice: [600, 0] })
  const found = tidyViews(m).found
  const fixed = sideReport(m, found, true)
  assert.match(fixed, /^Tidied \d views?:\n- (Ordering|Back office): (Ordering|Back office) was \w+, now \w+/)
  assert.match(sideReport(m, found, false), /was \w+, the view above has it \w+/)
  assert.equal(sideReport(m, [], true), 'Every neighbour is on the side it has in the view above.')
})
