import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { ICON_GROUPS, ICONS } from '../src/core/icons.ts'
import { colorPair, COLORS, fillOpacity, iconData, isColor, isOpacity, isPathData, onFill, SHAPE_DEFS, SHAPES, shapeOf, showsTile, typeColor } from '../src/core/look.ts'
import { viewToMermaid } from '../src/core/mermaid.ts'
import { parseModelFile, serializeModelFile } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'
import { deleteIcon, OpError, putIcon, putObject } from '../src/core/ops.ts'
import { shop } from './fixtures.ts'

const problems = (m: Model) => check(m).map(p => p.message)

test('every shape has an outline and room for content, and no two shapes share a name or an outline', () => {
  assert.deepEqual(Object.keys(SHAPE_DEFS), [...SHAPES])
  assert.equal(new Set(Object.values(SHAPE_DEFS).map(d => d.path)).size, SHAPES.length)
  for (const d of Object.values(SHAPE_DEFS)) assert.ok(isPathData(d.path) && d.pad[1] + d.pad[3] < 120, 'content keeps at least 80px across')
})

test('a shape the object names wins, else the type picks one', () => {
  assert.equal(shapeOf({ type: 'actor' }), 'pill')
  assert.equal(shapeOf({ type: 'store' }), 'cylinder')
  assert.equal(shapeOf({ type: 'app' }), 'rectangle')
  assert.equal(shapeOf({ type: 'app', shape: 'diamond' }), 'diamond')
  assert.equal(shapeOf({ type: 'app', shape: 'blob' }), 'rectangle', 'a shape nobody knows draws as the type would')
})

test('colours are names or hex, in two themes, and opacity defaults from the colour', () => {
  assert.ok(isColor('blue') && isColor('#abc') && isColor('#A1B2C3'))
  assert.ok(!isColor('bluish') && !isColor('#abcd') && !isColor('abc') && !isColor(''))
  assert.deepEqual(colorPair('blue'), COLORS.blue)
  assert.deepEqual(colorPair('#ABC'), ['#aabbcc', '#aabbcc'])
  assert.ok(isOpacity('0') && isOpacity('15') && isOpacity('100'))
  assert.ok(!isOpacity('101') && !isOpacity('07') && !isOpacity('-1') && !isOpacity('1.5') && !isOpacity(''))
  assert.equal(fillOpacity({}), 0)
  assert.equal(fillOpacity({ color: 'red' }), 15)
  assert.equal(fillOpacity({ color: 'red', opacity: '40' }), 40)
  assert.equal(fillOpacity({ opacity: '40' }), 40)
  assert.equal(typeColor({ type: 'store' }), 'pink')
  assert.equal(typeColor({ type: 'store', external: 'true' }), 'gray')
})

test('text on a strong fill is near-black or near-white, whichever reads better in each theme', () => {
  assert.equal(onFill({ type: 'app' }), undefined, 'no fill: the usual text')
  assert.equal(onFill({ type: 'app', color: 'blue' }), undefined, 'a light tint: dark text on light, light text on dark, as usual')
  assert.deepEqual(onFill({ type: 'app', color: '#000000', opacity: '100' }), ['#fafaf9', '#fafaf9'])
  assert.deepEqual(onFill({ type: 'app', color: '#ffffff', opacity: '100' }), ['#1c1917', '#1c1917'])
  assert.deepEqual(onFill({ type: 'app', color: '#123', opacity: '100' })?.[0], '#fafaf9')
  assert.ok(onFill({ type: 'store', opacity: '100' }), 'an opacity alone fills with the type colour')
})

test('the icon set has the five type icons and every icon is path data', () => {
  for (const name of ['user', 'cube', 'app-window', 'database', 'puzzle', 'cloud']) assert.ok(ICONS[name], name)
  assert.deepEqual(ICON_GROUPS.flatMap(g => g.names).sort(), Object.keys(ICONS).sort(), 'every icon is in a group, once')
  for (const [name, d] of Object.entries(ICONS)) assert.ok(isPathData(d), name)
})

test('an object shows the icon it names, else a cloud when external, else its type\'s', () => {
  const m = putIcon(shop(), 'stripe', 'M4 4h16v16h-16z')
  assert.equal(iconData(m, { type: 'app', icon: 'truck' }), ICONS.truck)
  assert.equal(iconData(m, { type: 'app', icon: 'stripe' }), 'M4 4h16v16h-16z')
  assert.equal(iconData(m, { type: 'app', external: 'true' }), ICONS.cloud)
  assert.equal(iconData(m, { type: 'app', external: 'true', icon: 'truck' }), ICONS.truck)
  assert.equal(iconData(m, { type: 'store' }), ICONS.database)
  assert.equal(iconData(m, { type: 'app', icon: 'nope' }), ICONS['app-window'], 'an unknown name falls back to the type; check() reports it')
  assert.equal(iconData(m, { type: 'app', icon: 'constructor' }), ICONS['app-window'])
})

test('the icon tile shows unless the shape has no room for it and no icon is named', () => {
  assert.ok(showsTile({ type: 'app' }))
  assert.ok(!showsTile({ type: 'app', shape: 'diamond' }))
  assert.ok(showsTile({ type: 'app', shape: 'diamond', icon: 'bulb' }))
})

test('check reports a bad shape, colour, opacity or icon, and a bad icons section', () => {
  const m = shop()
  Object.assign(m.objects, {
    a: { type: 'actor', name: 'A', shape: 'blob', color: 'bluish', opacity: '101', icon: 'nope' },
    b: { type: 'actor', name: 'B', shape: 'diamond', color: '#3b82f6', opacity: '40', icon: 'truck' },
    c: { type: 'actor', name: 'C', shape: '', color: '', opacity: '', icon: '' },
  })
  m.meta.icons = { Bad: 'M0 0', truck: 'M0 0', odd: 'rm -rf', ok: 'M1 1h4v4z' }
  assert.deepEqual(problems(m), [
    'icon Bad: names use lowercase letters, digits and dashes, not starting with a dash',
    'icon truck: is a built-in icon, so pick another name',
    'icon odd: must be SVG path data (commands like M, L, C, A and Z, on a 24×24 grid, at most 4000 characters)',
    'a: unknown shape "blob" (use rectangle, pill, ellipse, diamond, hexagon, parallelogram, cylinder, queue, document, folder, note, cloud, arrow)',
    'a: color "bluish" must be a name (gray, red, orange, amber, green, teal, blue, indigo, purple, pink) or a hex like #3b82f6',
    'a: opacity "101" must be a whole number from 0 to 100',
    'a: unknown icon "nope" (use a built-in name, or define it under icons: in model.yaml)',
  ])
  m.meta.icons = ['x']
  assert.deepEqual(problems(m).slice(0, 1), ['icons must map names to SVG path data'])
})

test('an icon an object names can be one the model defines', () => {
  const m = putIcon(shop(), 'stripe', 'M4 4h16v16h-16z')
  assert.deepEqual(problems(putObject(m, { id: 'web', icon: 'stripe' })), [])
})

test('putObject sets and clears the look, in a fixed key order, and opacity is written as text', () => {
  const m = putObject(shop(), { id: 'queue', type: 'store', name: 'Jobs', in: 'shop', icon: 'mail', opacity: 40, color: 'amber', shape: 'queue', tech: 'SQS' })
  assert.deepEqual(Object.keys(m.objects.queue), ['type', 'name', 'in', 'shape', 'color', 'opacity', 'icon', 'tech'])
  assert.equal(m.objects.queue.opacity, '40')
  const cleared = putObject(m, { id: 'queue', shape: '', color: '', opacity: '', icon: '' })
  assert.deepEqual(Object.keys(cleared.objects.queue), ['type', 'name', 'in', 'tech'])
  assert.equal(putObject(m, { id: 'queue', color: 'red' }).objects.queue.opacity, '40', 'other fields stay')
})

test('the look survives a save and a read', () => {
  const m = putIcon(putObject(shop(), { id: 'web', shape: 'hexagon', color: 'teal', opacity: 25, icon: 'stripe' }), 'stripe', 'M4 4h16v16h-16z')
  const back = parseModelFile(serializeModelFile(m))
  assert.equal(back.objects.web.opacity, '25')
  assert.deepEqual(back.meta.icons, { stripe: 'M4 4h16v16h-16z' })
  assert.deepEqual(problems({ ...m, ...back, flows: m.flows, layout: m.layout }), [])
})

test('putIcon and deleteIcon', () => {
  const m = putIcon(shop(), 'stripe', ' M4 4h16v16h-16z ')
  assert.deepEqual(m.meta.icons, { stripe: 'M4 4h16v16h-16z' })
  assert.deepEqual(putIcon(m, 'stripe', 'M1 1h2').meta.icons, { stripe: 'M1 1h2' }, 'same name replaces')
  assert.throws(() => putIcon(shop(), 'cloud', 'M1 1h2'), /built-in/)
  assert.throws(() => putIcon(shop(), 'Bad Name', 'M1 1h2'), OpError)
  assert.throws(() => putIcon(shop(), 'x', 'hello'), /SVG path data/)
  assert.throws(() => deleteIcon(shop(), 'stripe'), /unknown icon/)
  const used = putObject(m, { id: 'web', icon: 'stripe' })
  assert.throws(() => deleteIcon(used, 'stripe'), /used by web/)
  assert.equal('icons' in deleteIcon(m, 'stripe').meta, false, 'the last icon takes the section with it')
  assert.deepEqual(deleteIcon(putIcon(m, 'other', 'M1 1h2'), 'stripe').meta.icons, { other: 'M1 1h2' })
})

test('Mermaid draws each shape as the closest node, and colours as a style line', () => {
  const m = shop()
  m.objects.web = { ...m.objects.web, shape: 'diamond', color: 'blue', opacity: '40' }
  m.objects.api = { ...m.objects.api, shape: 'queue' }
  m.objects.db = { ...m.objects.db, opacity: '30' }
  const text = viewToMermaid(m, 'shop')
  assert.match(text, /n0\{"Web app<br\/>app · React"\}/)
  assert.match(text, /n1@\{ shape: h-cyl, label: "API<br\/>app · Node" \}/)
  assert.match(text, /n2\[\("Orders DB<br\/>store · Postgres"\)\]/, 'a store is still a cylinder')
  assert.match(text, /style n0 fill:#378add,fill-opacity:0\.4,stroke:#378add/)
  assert.match(text, /style n2 fill:#d4537e,fill-opacity:0\.3\n/, 'an opacity alone tints with the type colour and leaves the outline')
  assert.doesNotMatch(text, /style n1/)
})
