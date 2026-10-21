import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check, isRepoPath, isWebAddress, newProblems, typesIn } from '../src/core/check.ts'
import { parseFlowFile, parseModelFile, serializeFile } from '../src/core/model.ts'
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
    '-dash': { type: 'actor', name: 'D' },
  }))
  assertProblem(m, 'Bad Id: ids use lowercase')
  assertProblem(m, '-dash: ids use lowercase letters, digits and dashes, not starting with a dash')
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
  assertProblem(m, 'flows/broken.yaml step 3: goes from an object to itself (leave out "to" for a step one shape does on its own)')
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

test('isWebAddress takes http and https with a host', () => {
  for (const ok of ['https://example.com', 'http://localhost:4321/#a/b', 'HTTPS://EXAMPLE.COM/a?x=1#y']) assert.equal(isWebAddress(ok), true, ok)
  for (const bad of ['', 'https://', 'https:///x', 'ftp://x.dev', 'mailto:a@b.c', 'file:///x', 'javascript:alert(1)', '//example.com', 'example.com', 'https://a b.com', 'https://a.b\n', 'https://a.b\tc', 'docs/a.md'])
    assert.equal(isWebAddress(bad), false, bad)
})

test('links: a list of web addresses and repo paths that exist', () => {
  const m = shop()
  Object.assign(m.objects, raw({
    a: { type: 'actor', name: 'A', links: 'docs/a.md' },
    b: { type: 'actor', name: 'B', links: ['docs/a.md', { url: 'docs/a.md' }, { title: ['x'], url: 'docs/a.md' }] },
    c: { type: 'actor', name: 'C', links: [{ title: 'No address' }, { url: '  ' }] },
    d: { type: 'actor', name: 'D', links: [{ url: 'file:///etc/passwd' }, { url: 'mailto:a@b.c' }, { url: 'javascript:alert(1)' }, { url: '/etc/passwd' }, { url: 'C:/x' }, { url: '../up' }, { url: 'https://' }, { url: 'ftp://x.dev/f' }] },
    e: { type: 'actor', name: 'E', links: [{ title: 'Docs', url: 'docs/' }, { url: 'docs/gone.md' }, { title: 'Web', url: 'https://example.com/a?x=1#y' }, { url: 'HTTP://EXAMPLE.COM' }] },
  }))
  const messages = check(m, new Set(['docs/gone.md'])).map(p => p.message)
  const shape = 'links must be a list of entries with a url and, if you like, a title'
  assert.ok(messages.includes(`a: ${shape}`))
  assert.ok(messages.includes(`b: ${shape}`))
  assert.equal(messages.filter(msg => msg === 'c: a link has no url').length, 2)
  for (const bad of ['file:///etc/passwd', 'mailto:a@b.c', 'javascript:alert(1)', '/etc/passwd', 'C:/x', '../up', 'https://', 'ftp://x.dev/f'])
    assert.ok(messages.includes(`d: link "${bad}" must be a web address (http or https) or a path in the repo, relative, with / between folders and no "." or ".." parts`), bad)
  assert.deepEqual(messages.filter(msg => msg.startsWith('e:')), ['e: link path "docs/gone.md" doesn\'t exist'])
})

test('animation rules', () => {
  const m = shop()
  m.flows.checkout.steps = [
    { from: 'customer', to: 'web', text: 'a', animation: 'send' },
    { from: 'web', to: 'api', text: 'b', animation: { kind: 'callback', trigger: 'outside' } },
    { from: 'api', to: 'db', text: 'c', animation: 'sned' },
    { from: 'api', text: 'd', animation: 'call' },
    { from: 'api', to: 'db', text: 'e', animation: { kind: 'send', trigger: 'outside' } },
    { from: 'api', to: 'db', text: 'f', animation: '' },
  ]
  assert.deepEqual(check(m).map(p => p.message), [
    'step 3: unknown animation "sned" (use send, call, callback, event)',
    'step 4: animation "call" needs a "to"',
    'step 5: animation trigger only applies to callback',
  ])
})

test('outcome rules', () => {
  const m = shop()
  m.flows.checkout.steps = [
    { from: 'customer', to: 'web', text: 'a', animation: { kind: 'call', outcome: 'timeout' } },
    { from: 'web', to: 'api', text: 'b', animation: { kind: 'send', outcome: 'timeout' } },
    { from: 'api', to: 'db', text: 'c', animation: { kind: 'event', outcome: 'fail' } },
    { from: 'api', to: 'db', text: 'd', animation: { kind: 'call', outcome: 'maybe' } },
    { from: 'api', to: 'db', text: 'e', animation: { kind: 'send', outcome: 'fail' } },
  ]
  assert.deepEqual(check(m).map(p => p.message), [
    'step 2: animation outcome timeout only applies to call',
    'step 3: animation outcome fail only applies to send and call',
    'step 4: animation outcome must be fail, timeout, lost, rejected, intercepted, duplicated or delayed',
  ])
})

test('the new outcomes and their keys are checked, and so is the shape that intercepts', () => {
  const m = shop()
  m.flows.checkout.steps = [
    { from: 'customer', to: 'web', text: 'a', animation: { kind: 'send', outcome: 'lost', share: 30, reason: 'Packet dropped', at: 0.4 } },
    { from: 'web', to: 'api', text: 'b', animation: { kind: 'call', outcome: 'intercepted', by: 'mail' } },
    { from: 'web', to: 'api', text: 'c', animation: { kind: 'call', outcome: 'intercepted', by: { name: 'Café wifi proxy' } } },
    { from: 'web', to: 'api', text: 'd', animation: { kind: 'call', outcome: 'intercepted', by: 'ghost' } },
    { from: 'web', to: 'api', text: 'e', animation: { kind: 'call', outcome: 'intercepted', by: 'web' } },
    { from: 'web', to: 'api', text: 'f', animation: { kind: 'call', outcome: 'intercepted', by: 'api' } },
    { from: 'web', to: 'api', text: 'g', animation: { kind: 'call', outcome: 'intercepted' } },
    { from: 'web', to: 'api', text: 'h', animation: { kind: 'call', outcome: 'lost', by: 'mail' } },
    { from: 'web', to: 'api', text: 'i', animation: { kind: 'send', outcome: 'lost', share: 101 } },
    { from: 'web', to: 'api', text: 'j', animation: { kind: 'callback', outcome: 'delayed' } },
    { from: 'web', to: 'api', text: 'k', animation: { kind: 'send', outcome: 'delayed', reason: 'x'.repeat(41) } },
    { from: 'web', to: 'api', text: 'l', animation: { kind: 'send', outcome: 'rejected', at: 0.5 } },
  ]
  assert.deepEqual(check(m).map(p => p.message), [
    'step 4: animation by: unknown object "ghost"',
    'step 5: animation by "web" is an end of the step (name another shape, or use { name: ... })',
    'step 6: animation by "api" is an end of the step (name another shape, or use { name: ... })',
    'step 7: animation outcome intercepted needs a "by" (a shape id, or { name: ... })',
    'step 8: animation by only applies to outcome intercepted',
    'step 9: animation share must be a whole number from 1 to 100',
    'step 10: animation outcome delayed only applies to send, call and event',
    'step 11: animation reason can be at most 40 characters',
    'step 12: animation at only applies to outcome lost',
  ])
})

test('a comma in unquoted flow text leaves a key with no value, which is reported before a save throws', () => {
  const m = shop()
  const text = 'name: Bad\nview: shop\nsteps:\n  - { from: customer, to: web, text: Sets the time zone, if the request has one }\n'
  m.flows.bad = parseFlowFile('bad', text)
  // The file loads and the text is cut short, so nothing else notices.
  assert.equal(m.flows.bad.steps[0].text, 'Sets the time zone')
  assert.deepEqual(check(m).map(p => `${p.file} ${p.message}`), [
    'flows/bad.yaml step 1: "if the request has one" has no value (a comma ends unquoted text: put text that has a comma in double quotes)',
  ])
  assert.equal(check(m)[0].step, 0)
  // Writing it back is what throws, and that is what the problem warns about.
  assert.throws(() => serializeFile('flows/bad.yaml', m.flows.bad), /Tag not resolved for null value/)
})

test('quoting the text keeps the comma, and no key is left empty', () => {
  const m = shop()
  const text = 'name: Good\nview: shop\nsteps:\n  - { from: customer, to: web, text: "Sets the time zone, if the request has one" }\n'
  m.flows.good = parseFlowFile('good', text)
  assert.equal(m.flows.good.steps[0].text, 'Sets the time zone, if the request has one')
  assert.deepEqual(check(m), [])
  assert.doesNotThrow(() => serializeFile('flows/good.yaml', m.flows.good))
})

test('a key with no value is reported wherever it sits: objects, connections, flows, nested keys, failures and model.yaml', () => {
  const m = shop()
  const model = parseModelFile(
    'extra: { note: Hello, world }\nobjects:\n  a: { type: actor, name: A, tech: Go, for the team }\nconnections:\n  - { from: a, to: a, label: sends, then waits }\n')
  Object.assign(m.objects, model.objects)
  m.connections.push(...model.connections)
  Object.assign(m.meta, model.meta)
  m.flows.nested = parseFlowFile('nested', [
    'name: Nested, the long way', // the comma is harmless in block style
    'view: shop',
    'groups:',
    '  g: { kind: repeat, until: it stops, or gives up }',
    'steps:',
    '  - { from: customer, to: web, text: Fine }',
    '  - { from: web, to: api, text: Slow, animation: { kind: call, reason: Rate limit, packet dropped } }',
  ].join('\n'))
  m.failures.f = { name: 'F', modes: { m: { mode: 'It breaks', on: 'db', cause: 'Heat', 'and cold': null } } } as never
  const messages = check(m).map(p => `${p.file} ${p.message}`).filter(msg => msg.includes('has no value'))
  const rest = '(a comma ends unquoted text: put text that has a comma in double quotes)'
  assert.deepEqual(messages, [
    `model.yaml "extra → world" has no value ${rest}`,
    `model.yaml a: "for the team" has no value ${rest}`,
    `model.yaml connection a → a: "then waits" has no value ${rest}`,
    `flows/nested.yaml "groups → g → or gives up" has no value ${rest}`,
    `flows/nested.yaml step 2: "animation → packet dropped" has no value ${rest}`,
    `failures/f.yaml "modes → m → and cold" has no value ${rest}`,
  ])
})
