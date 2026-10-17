import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, isRepoPath, newProblems, typesIn } from '../src/core/check.ts'
import type { Model } from '../src/core/model.ts'
import { shop } from './fixtures.ts'

/** Lets tests add objects that break the types on purpose. */
const raw = (objects: Record<string, unknown>) => objects as Model['objects']

function assertProblem(m: Model, text: string) {
  const all = check(m).map(p => `${p.file} ${p.message}`)
  assert.ok(all.some(msg => msg.includes(text)), `expected a problem containing ${JSON.stringify(text)}, got ${JSON.stringify(all, null, 2)}`)
}

test('the shop fixture has no problems', () => {
  assert.deepEqual(check(shop()), [])
})

test('object rules', () => {
  const m = shop()
  Object.assign(m.objects, raw({
    'Bad Id': { type: 'actor', name: 'X' },
    root: { type: 'actor', name: 'R' },
    thing: { type: 'gizmo', name: 'T' },
    nameless: { type: 'actor', name: '' },
    floating: { type: 'app', name: 'F' },
    lost: { type: 'store', name: 'L', in: 'nowhere' },
    deep: { type: 'component', name: 'D', in: 'shop' },
    boxed: { type: 'system', name: 'B', in: 'shop' },
  }))
  assertProblem(m, 'Bad Id: ids use lowercase')
  assertProblem(m, 'root: ids use lowercase')
  assertProblem(m, 'thing: unknown type "gizmo"')
  assertProblem(m, 'nameless: name is missing')
  assertProblem(m, 'floating: app must be inside system')
  assertProblem(m, 'lost: "in" points to unknown object "nowhere"')
  assertProblem(m, 'deep: component must be inside app or store, not system')
  assertProblem(m, "boxed: system can't be inside anything")
})

test('connection rules', () => {
  const m = shop()
  m.connections.push({ from: 'web', to: 'ghost' }, { from: 'web', to: 'web' }, { from: 'web', to: 'api', label: 'REST' })
  assertProblem(m, 'connection web → ghost: unknown object "ghost"')
  assertProblem(m, 'connection web → web: connects an object to itself')
  assertProblem(m, 'connection web → api: duplicate "REST"')
})

test('flow rules', () => {
  const m = shop()
  m.flows['Bad Flow'] = { name: 'B', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'x' }] }
  m.flows.leaf = { name: '', view: 'db', steps: [] }
  m.flows.broken = {
    name: 'Broken',
    view: 'api',
    steps: [
      { from: 'ghost', to: 'auth', text: 'a' },
      { from: 'auth', to: 'orders', text: '' },
      { from: 'auth', to: 'auth', text: 'loop' },
      { from: 'customer', to: 'web', text: 'far away' },
    ],
  }
  assertProblem(m, 'flows/Bad Flow.yaml "Bad Flow" is not a valid flow id')
  assertProblem(m, 'flows/leaf.yaml name is missing')
  assertProblem(m, 'flows/leaf.yaml view "db" must be "root" or an object with children')
  assertProblem(m, 'flows/leaf.yaml has no steps')
  assertProblem(m, 'flows/broken.yaml step 1: unknown object "ghost"')
  assertProblem(m, 'flows/broken.yaml step 2: text is missing')
  assertProblem(m, 'flows/broken.yaml step 3: goes from an object to itself (leave out "to" for a step one box does on its own)')
  assertProblem(m, `flows/broken.yaml step 4: customer → web can't be shown in view "api"`)
})

test('valid edge cases are not problems', () => {
  const m = shop()
  m.objects.cache = { type: 'store', in: 'shop', name: 'Cache' }
  m.objects.index = { type: 'component', in: 'cache', name: 'Index' }
  m.connections.push({ from: 'web', to: 'api', label: 'websocket' }, { from: 'api', to: 'web', label: 'REST' })
  m.flows.visit = { name: 'Visit', view: 'root', steps: [{ from: 'customer', to: 'shop', text: 'Visits' }] }
  assert.deepEqual(check(m), [])
})

test('exact problems for a small broken model, with no crash on missing fields', () => {
  const m = shop()
  Object.assign(m.objects, raw({
    blank: { type: 'actor', name: '   ' },
    proto: { type: 'constructor', name: 'P' },
    typeless: { name: 'T' },
    misplaced: { type: 'store', in: 'web', name: 'M' },
  }))
  m.connections.push({ from: 'ghost', to: 'ghost' }, { from: 'web' } as never)
  m.flows.empty = { steps: [] } as never
  assert.deepEqual(check(m).map(p => `${p.file} ${p.message}`), [
    'model.yaml blank: name is missing',
    'model.yaml proto: unknown type "constructor" (use actor, system, app, store, component)',
    'model.yaml typeless: type is missing',
    'model.yaml misplaced: store must be inside system, not app',
    'model.yaml connection ghost → ghost: unknown object "ghost"',
    'model.yaml connection ghost → ghost: connects an object to itself',
    'model.yaml connection web → ?: "to" is missing',
    'flows/empty.yaml name is missing',
    'flows/empty.yaml view is missing',
    'flows/empty.yaml has no steps',
  ])
})

test('unrelated edits never make old problems look new', () => {
  const before = shop()
  before.connections.push({ from: 'web', to: 'ghost' }, { from: 'web', to: 'web' })
  before.objects.floating = { type: 'app', name: 'F' }
  const after = structuredClone(before)
  after.connections.unshift({ from: 'customer', to: 'mail', label: 'emails' })
  after.connections.reverse()
  after.objects.api.description = 'Changed'
  after.objects.extra = { type: 'actor', name: 'Extra' }
  assert.deepEqual(newProblems(check(before), check(after)), [])
})

test('newProblems compares file, id and message, and counts repeats', () => {
  const a = { file: 'model.yaml', id: 'x', message: 'x: name is missing' }
  assert.deepEqual(newProblems([a], [a]), [])
  assert.deepEqual(newProblems([a], []), [])
  assert.equal(newProblems([a], [{ ...a, message: 'x: type is missing' }]).length, 1)
  assert.equal(newProblems([a], [{ ...a, file: 'flows/x.yaml' }]).length, 1)
  assert.equal(newProblems([a], [{ ...a, id: 'y' }]).length, 1)
  assert.deepEqual(newProblems([a], [a, a]), [a])
  assert.deepEqual(newProblems([a, a], [a, a]), [])
})

test('blank values read as missing', () => {
  const m = shop()
  Object.assign(m.objects, raw({ blank: { type: '', name: 'B' }, homeless: { type: 'app', name: 'H', in: '' } }))
  m.connections.push({ from: '', to: 'web' })
  m.flows.draft = { name: 'Draft', view: '', steps: [{ from: 'web', to: '', text: 'x' }] }
  assert.deepEqual(check(m).map(p => `${p.file} ${p.message}`), [
    'model.yaml blank: type is missing',
    'model.yaml homeless: app must be inside system',
    'model.yaml connection ? → web: "from" is missing',
    'flows/draft.yaml view is missing',
    'flows/draft.yaml step 1: "to" is missing',
  ])
})

test('newProblems ignores problems that were already there', () => {
  const before = shop()
  before.connections.push({ from: 'web', to: 'web' })
  const after = structuredClone(before)
  after.objects.floating = { type: 'app', name: 'F' }
  assert.deepEqual(newProblems(check(before), check(after)).map(p => p.message), ['floating: app must be inside system'])
})

test('connection and step problems say where they are, and newProblems ignores that', () => {
  const before = shop()
  before.connections.push({ from: 'web', to: 'web' })
  before.flows.checkout.steps[1].text = ''
  const at = check(before).map(p => [p.message, p.connection, p.step])
  assert.deepEqual(at, [
    ['connection web → web: connects an object to itself', 5, undefined],
    ['step 2: text is missing', undefined, 1],
  ])
  const after = structuredClone(before)
  after.connections.shift()
  assert.equal(check(after)[0].connection, 4)
  assert.deepEqual(newProblems(check(before), check(after)), [])
})

test('typesIn follows the nesting rules', () => {
  const m = shop()
  assert.deepEqual(typesIn(m, 'root'), ['actor', 'system'])
  assert.deepEqual(typesIn(m, 'shop'), ['app', 'store'])
  assert.deepEqual(typesIn(m, 'api'), ['component'])
  assert.deepEqual(typesIn(m, 'db'), ['component'])
  assert.deepEqual(typesIn(m, 'auth'), [])
  assert.deepEqual(typesIn(m, 'ghost'), [])
  assert.deepEqual(typesIn(m, 'constructor'), [])
})

test('a step problem that only got a new number is not new', () => {
  const before = shop()
  before.flows.checkout.steps[2].text = ''
  const after = structuredClone(before)
  after.flows.checkout.steps.shift()
  assert.deepEqual(newProblems(check(before), check(after)).map(p => p.message), [])
  after.flows.checkout.steps[0].text = ''
  assert.equal(newProblems(check(before), check(after)).length, 1) // two steps miss their text now, one did before
})

test('code paths: a list of repo paths that exist', () => {
  const m = shop()
  Object.assign(m.objects, raw({
    a: { type: 'actor', name: 'A', code: 'src/' },
    b: { type: 'actor', name: 'B', code: ['src/', '/etc/passwd', '../up', 'a\\b', 'C:/x', './here', 'two//slashes', ''] },
    c: { type: 'actor', name: 'C', code: ['src/api/', 'gone.ts'] },
  }))
  const messages = check(m, new Set(['gone.ts'])).map(p => p.message)
  assert.ok(messages.includes('a: code must be a list of paths'))
  for (const bad of ['/etc/passwd', '../up', 'a\\b', 'C:/x', './here', 'two//slashes', ''])
    assert.ok(messages.includes(`b: code path "${bad}" must be relative, with / between folders and no "." or ".." parts`), bad)
  assert.ok(messages.includes('c: code path "gone.ts" doesn\'t exist'))
  assert.equal(messages.filter(msg => msg.startsWith('c:')).length, 1)
  assert.equal(messages.filter(msg => msg.includes('"src/')).length, 0)
})

test('isRepoPath takes files and folders', () => {
  for (const ok of ['src', 'src/', 'src/api/server.ts', '.github/workflows/', 'a.b/c']) assert.equal(isRepoPath(ok), true, ok)
  for (const bad of ['', '/', '/x', 'x//y', '..', 'x/../y', './x', 'x\\y', 'c:/x']) assert.equal(isRepoPath(bad), false, bad)
})

test('a step with no "to" is one box acting on its own', () => {
  const m = shop()
  m.flows.checkout.steps.push({ from: 'api', text: 'Checks the order' }, { from: 'orders', text: 'Sends it', description: 'Within a minute.' })
  assert.deepEqual(check(m), [])
  m.flows.checkout.steps.push({ from: 'mail', text: 'Sends it' })
  assertProblem(m, `flows/checkout.yaml step 6: mail can't be shown in view "shop"`)
  m.flows.checkout.steps.pop()
  m.flows.checkout.steps.push({ from: 'ghost', text: 'Haunts' }, { from: '', text: 'Nobody' } as never)
  assertProblem(m, 'flows/checkout.yaml step 6: unknown object "ghost"')
  assertProblem(m, 'flows/checkout.yaml step 7: "from" is missing')
})

test('external is true or false', () => {
  const m = shop()
  m.objects.mail = { ...m.objects.mail, external: 'true' }
  assert.deepEqual(check(m), [])
  m.objects.mail = { ...m.objects.mail, external: 'false' }
  assert.deepEqual(check(m), [])
  m.objects.mail = { ...m.objects.mail, external: 'yes' }
  assertProblem(m, 'mail: external must be true or false')
})

test('lines is straight, curved or angled', () => {
  assert.deepEqual(check({ ...shop(), meta: { lines: 'curved' } }), [])
  assertProblem({ ...shop(), meta: { lines: 'wiggly' } }, 'model.yaml lines must be straight, curved or angled')
})
