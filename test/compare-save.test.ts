import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareOf } from '../src/core/compare.ts'
import { openHistory } from '../src/node/history.ts'
import { startServer } from '../src/node/server.ts'
import { httpHistory } from '../ui/src/historyclient.ts'
import { CHANGED_OUTSIDE, fetchModel } from '../ui/src/save.ts'
import { saveCompare } from '../ui/src/saveCompare.ts'
import { httpTransport } from '../ui/src/transport.ts'
import type { Reply, Transport } from '../ui/src/transport.ts'

const RUN = (name: string) => `# a run\nname: ${name}\nunit: orders/min\nlevels:\n  - { load: 10, overall: { rate: 1, p50: 10, p95: 20, errors: 0 } }\n  - { load: 20, overall: { rate: 2, p50: 11, p95: 22, errors: 0 } }\n`

/** A server with history over a folder with two flows and two runs, the way the page talks to it. */
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-compare-save-'))
  const dir = join(root, 'flowy')
  await mkdir(join(dir, 'flows'), { recursive: true })
  await mkdir(join(dir, 'perf'))
  await writeFile(join(dir, 'model.yaml'), 'objects:\n  shop: { type: system, name: Shop }\n')
  await writeFile(join(dir, 'flows', 'a.yaml'), 'name: Refund, old\nsteps: []\n')
  await writeFile(join(dir, 'flows', 'b.yaml'), 'name: Refund, now\nsteps: []\n')
  await writeFile(join(dir, 'perf', 'x.yaml'), RUN('Dinner rush'))
  await writeFile(join(dir, 'perf', 'y.yaml'), RUN('Lunch rush'))
  const history = openHistory(dir, { app: 'browser', stateDir: join(root, 'state'), log: () => undefined })
  const server = await startServer({ dir, ui: root, port: 0, history })
  t.after(async () => {
    await server.close()
    await rm(root, { recursive: true, force: true })
  })
  const base = `http://127.0.0.1:${server.port}`
  const labels = async () => (await httpHistory(base).list()).steps.map(s => s.label)
  return { dir, base, labels, read: (rel: string) => readFile(join(dir, rel), 'utf8') }
}

test('a flow is tagged with the older one, with or without a note, and untagged again', async t => {
  const { base, read, labels } = await setup(t)
  assert.equal(await saveCompare('flow', 'b', { with: 'a' }, base), undefined)
  assert.equal(await read('flows/b.yaml'), 'name: Refund, now\nsteps: []\ncompare: a\n')
  assert.equal((await labels())[0], 'Linked Refund, old with Refund, now')
  assert.equal(await saveCompare('flow', 'b', { with: 'a', note: 'After the fix' }, base), undefined)
  assert.equal(await read('flows/b.yaml'), 'name: Refund, now\nsteps: []\ncompare:\n  with: a\n  note: After the fix\n')
  assert.equal((await labels())[0], 'Noted Refund, old and Refund, now')
  assert.equal(await saveCompare('flow', 'b', undefined, base), undefined)
  assert.equal(await read('flows/b.yaml'), 'name: Refund, now\nsteps: []\n')
  assert.equal((await labels())[0], 'Unlinked Refund, now')
  assert.equal(await read('flows/a.yaml'), 'name: Refund, old\nsteps: []\n', 'the other flow is not touched')
})

test('a flow tag to an unknown flow, or to itself, gives the message of the edit and writes nothing', async t => {
  const { base, read } = await setup(t)
  assert.equal(await saveCompare('flow', 'b', { with: 'gone' }, base), 'unknown flow "gone"')
  assert.equal(await saveCompare('flow', 'b', { with: 'b' }, base), 'flow "b" cannot compare with itself')
  assert.equal(await saveCompare('flow', 'nope', { with: 'a' }, base), 'unknown flow "nope"')
  assert.equal(await read('flows/b.yaml'), 'name: Refund, now\nsteps: []\n')
})

test('the state carries a version for each run, so the page can write its tag', async t => {
  const { base } = await setup(t)
  const { versions, runs } = await fetchModel(base)
  assert.deepEqual(Object.keys(runs).sort(), ['x', 'y'])
  assert.match(versions['perf/x.yaml'] ?? '', /^[0-9a-f]{16}$/)
})

test('a run is tagged by changing only its compare line, and untagged again', async t => {
  const { base, read, labels } = await setup(t)
  const before = await labels()
  assert.equal(await saveCompare('run', 'y', { with: 'x' }, base), undefined)
  assert.equal(await read('perf/y.yaml'), `${RUN('Lunch rush')}compare: x\n`)
  assert.equal(await saveCompare('run', 'y', { with: 'x', note: 'After the cache' }, base), undefined)
  assert.equal(await read('perf/y.yaml'), `${RUN('Lunch rush')}compare:\n  with: x\n  note: "After the cache"\n`)
  assert.equal(await saveCompare('run', 'y', undefined, base), undefined)
  assert.equal(await read('perf/y.yaml'), RUN('Lunch rush'))
  assert.equal(await read('perf/x.yaml'), RUN('Dinner rush'), 'the other run is not touched')
  assert.deepEqual(await labels(), before, 'the history keeps no step for a run, and no step is relabelled')
})

test('a run tag to an unknown run, to itself, or on a run that is not there gives the words of a flow and writes nothing', async t => {
  const { base, read } = await setup(t)
  assert.equal(await saveCompare('run', 'y', { with: 'gone' }, base), 'unknown run "gone"')
  assert.equal(await saveCompare('run', 'y', { with: 'y' }, base), 'run "y" cannot compare with itself')
  assert.equal(await saveCompare('run', 'nope', { with: 'x' }, base), 'unknown run "nope"')
  assert.equal(await read('perf/y.yaml'), RUN('Lunch rush'))
})

/** The local server's transport, with `before` run after the state is read and the write held to what `answer` says (left out: the server's own answer). */
function tweaked(base: string, hooks: { afterState?: () => Promise<void>; answer?: Reply }): Transport {
  const real = httpTransport(base)
  return {
    state: async () => {
      const state = await real.state()
      await hooks.afterState?.()
      return state
    },
    write: (method, file, body) => (hooks.answer ? Promise.resolve(hooks.answer) : real.write(method, file, body)),
  }
}

test('a run that changed since it was read is told as a change from outside, and what changed stays', async t => {
  const { dir, base, read } = await setup(t)
  const changed = `${RUN('Lunch rush')}# edited\n`
  const via = tweaked(base, { afterState: () => writeFile(join(dir, 'perf', 'y.yaml'), changed) })
  assert.equal(await saveCompare('run', 'y', { with: 'x' }, via), CHANGED_OUTSIDE)
  assert.equal(await read('perf/y.yaml'), changed)
})

test('a flow that changed since it was read is told as a change from outside', async t => {
  const { dir, base, read } = await setup(t)
  const changed = 'name: Refund, now (edited)\nsteps: []\n'
  const via = tweaked(base, { afterState: () => writeFile(join(dir, 'flows', 'b.yaml'), changed) })
  assert.equal(await saveCompare('flow', 'b', { with: 'a' }, via), CHANGED_OUTSIDE)
  assert.equal(await read('flows/b.yaml'), changed)
})

test('a run write the server refuses is told in its words, and with none, by its status', async t => {
  const { base } = await setup(t)
  assert.equal(await saveCompare('run', 'y', { with: 'x' }, tweaked(base, { answer: { status: 409, body: { error: 'flows/c.yaml: could not be read' } } })), "Couldn't save perf/y.yaml: flows/c.yaml: could not be read")
  assert.equal(await saveCompare('run', 'y', { with: 'x' }, tweaked(base, { answer: { status: 500, body: {} } })), "Couldn't save perf/y.yaml: the server answered 500")
})

test('a folder with a file that can not be read says so, and nothing is written', async t => {
  const { dir, base, read } = await setup(t)
  await writeFile(join(dir, 'flows', 'c.yaml'), 'name: [unclosed\n')
  assert.match(await saveCompare('run', 'y', { with: 'x' }, base) ?? '', /^Can't read flows\/c\.yaml/)
  assert.equal(await read('perf/y.yaml'), RUN('Lunch rush'))
})

// What people paste into a note: every one of these must come back from the file exactly as it went in, for a flow and for a run.
const NOTES: Record<string, string> = {
  'double quotes': 'He said "yes" twice',
  'single quotes': "It's the 'old' one",
  'a colon': 'Cause: a retry. Effect: two refunds',
  'a hash': '# Heading\nnot a comment # either',
  'a line break': 'first line\nsecond line',
  'a blank line': 'first paragraph\n\nsecond paragraph',
  'CRLF': 'first\r\nsecond',
  'a trailing newline': 'ends with a break\n',
  'Markdown': '**bold** and `code` and [a link](https://example.com)\n\n- one\n- two\n\n> quoted',
  'a code fence': '```ts\nconst a = { b: 1 }\n```',
  'unicode': 'Ünïcode ✓ 日本語 😀 العربية',
  'a document marker': '---\nnot a new document\n...',
  'a leading dash and spaces': '- item\n  indented',
  'YAML look-alikes': 'null',
  'a number': '12345',
  'a flow mapping': '{ a: 1, b: [2, 3] }',
  'an anchor and a tag': '&anchor !!str *alias',
  'backslashes': 'C:\\path\\to\\file and \\n literally',
  'a tab': 'a\tb',
  'twenty thousand characters': `${'word '.repeat(3999)}end`,
}

for (const [what, note] of Object.entries(NOTES)) {
  test(`a note with ${what} comes back as it went in, on a flow and on a run`, async t => {
    const { base, read } = await setup(t)
    assert.equal(await saveCompare('flow', 'b', { with: 'a', note }, base), undefined)
    assert.equal(compareOf((await fetchModel(base)).model.flows.b.compare)?.note, note)
    assert.equal(await saveCompare('run', 'y', { with: 'x', note }, base), undefined)
    assert.equal(compareOf((await fetchModel(base)).runs.y.compare)?.note, note)
    assert.equal(await read('flows/a.yaml'), 'name: Refund, old\nsteps: []\n', 'nothing else is touched')
    assert.equal(await read('perf/x.yaml'), RUN('Dinner rush'))
  })
}

