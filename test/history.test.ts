import { test } from 'node:test'
import type { TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { collapseSteps, HISTORY_LIMIT, HISTORY_SLACK, stepId } from '../src/core/history.ts'
import type { Step, StepSource } from '../src/core/history.ts'
import { hashBytes, hashText } from '../src/node/files.ts'
import { openHistory } from '../src/node/history.ts'
import type { HistoryOptions } from '../src/node/history.ts'
import { openStore } from '../src/node/history-store.ts'

/** Steps written straight into a trail, much faster than recording them: "Step 1" to "Step <count>", each with its own model.yaml. */
async function prefill(root: string, count: number) {
  const store = openStore(root)
  for (let n = 1; n <= count; n++) {
    const text = `n: ${n}\n`
    const time = new Date(Date.UTC(2026, 0, 1) + n * 1000)
    await store.putStep(
      { id: stepId(time, 'aaaaaa'), time: time.toISOString(), label: `Step ${n}`, source: 'you', app: 'browser', files: { 'model.yaml': hashText(text) } },
      new Map([[hashText(text), new TextEncoder().encode(text)]]),
    )
  }
}

/** Makes every blob in a trail look an hour old, so a trim may delete the ones nothing names. */
async function ageBlobs(root: string) {
  const anHourAgo = new Date(Date.now() - 3_600_000)
  for (const name of await readdir(join(root, 'blobs'))) await utimes(join(root, 'blobs', name), anHourAgo, anHourAgo)
}

/** A model folder and a history over it, with a clock that ticks one millisecond per look and ids that count up, so steps sort in the order they were made. */
async function setup(t: TestContext, options: Partial<HistoryOptions> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'flowy-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  await mkdir(dir, { recursive: true })
  const stateDir = join(root, 'state')
  let tick = 0
  const history = openHistory(dir, {
    app: 'browser', stateDir,
    now: () => new Date(Date.UTC(2026, 9, 20, 10, 0, 0) + tick++),
    random: () => tick.toString(16).padStart(6, '0'),
    log: () => undefined, // tests that make the history fail on purpose do not need the line on the screen
    ...options,
  })
  const put = async (rel: string, content: string | Uint8Array) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true })
    await writeFile(join(dir, rel), content)
  }
  return { root, dir, stateDir, history, put }
}

test('hashBytes is the hash hashText gives the same text', () => {
  assert.equal(hashBytes(new TextEncoder().encode('objects: {}\n')), hashText('objects: {}\n'))
})

test('snapshot reads only the files Flowy may write', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'objects: {}\n')
  await put('layout.yaml', '{}\n')
  await put('flows/a.yaml', 'name: A\n')
  await put('flows/Bad_Flow.yaml', 'name: Bad\n')
  await put('flows/old.yml', 'name: Old\n')
  await put('perf/run.json', '{}')
  const { files, bytes } = await history.snapshot()
  assert.deepEqual(Object.keys(files).sort(), ['flows/a.yaml', 'layout.yaml', 'model.yaml'])
  assert.equal(files['model.yaml'], hashText('objects: {}\n'))
  assert.deepEqual(bytes.get(files['flows/a.yaml']), new TextEncoder().encode('name: A\n'))
})

test('snapshot of a folder that is not there is empty', async t => {
  const { root, stateDir } = await setup(t)
  const history = openHistory(join(root, 'nope'), { app: 'browser', stateDir })
  assert.deepEqual((await history.snapshot()).files, {})
})

test('first seen is recorded once; an empty folder records nothing', async t => {
  const { history, put } = await setup(t)
  assert.deepEqual(await history.ensureCurrent('open'), { saved: true })
  assert.deepEqual(await history.list(), [])
  await put('model.yaml', 'objects: {}\n')
  const first = await history.ensureCurrent('open')
  assert.equal(first.saved, true)
  assert.ok(first.id)
  assert.deepEqual((await history.list()).map(s => [s.label, s.source]), [['First seen', 'first']])
  assert.deepEqual(await history.ensureCurrent('watch'), first)
  assert.equal((await history.list()).length, 1)
})

test('a change since the last step is an outside step', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await history.ensureCurrent('open')
  await put('model.yaml', 'a: 2\n')
  await history.ensureCurrent('open')
  await put('model.yaml', 'a: 3\n')
  await history.ensureCurrent('watch')
  assert.deepEqual((await history.list()).map(s => [s.label, s.source]), [
    ['Changed outside Flowy: model.yaml', 'outside'],
    ['Changed while Flowy was closed', 'outside'],
    ['First seen', 'first'],
  ])
})

test('record: unchanged files write nothing, and an unlabelled step cannot repeat the newest', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  assert.ok(await history.record('Added a', 'you'))
  assert.equal(await history.record('Again', 'you'), undefined)
  assert.equal(await history.record('Noticed', 'outside'), undefined)
  assert.equal((await history.list()).length, 1)
})

test('record: a labelled step is written over an identical outside one', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await history.ensureCurrent('open')
  await put('model.yaml', 'a: 2\n')
  await history.ensureCurrent('watch') // another program noticed the change first
  assert.ok(await history.record('AI: put_object a', 'ai'))
  assert.deepEqual((await history.list()).map(s => s.label), ['AI: put_object a', 'First seen'])
})

test('record with no label uses the fallback', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await put('layout.yaml', '{}\n')
  assert.equal((await history.record(undefined, 'you'))?.label, 'Changed layout.yaml, model.yaml')
  await put('model.yaml', 'a: 2\n')
  assert.equal((await history.record(undefined, 'you'))?.label, 'Changed model.yaml')
})

test('record on an empty folder writes nothing', async t => {
  const { history } = await setup(t)
  assert.equal(await history.record('Nothing', 'you'), undefined)
  assert.deepEqual(await history.list(), [])
})

test('list shows the labelled step, not the identical outside one beside it', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await history.record('Added a', 'you')
  await put('model.yaml', 'a: 2\n')
  await history.ensureCurrent('watch')
  await history.record('Edited a', 'you')
  assert.deepEqual((await history.list()).map(s => [s.label, s.changed]), [['Edited a', ['model.yaml']], ['Added a', ['model.yaml']]])
})

test('a file that is not UTF-8 is a step and reads back as notText', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', new Uint8Array([0xff, 0xfe, 0x00]))
  await put('layout.yaml', '﻿{}\n') // a BOM is kept
  const step = await history.record('Broke it', 'you')
  assert.ok(step)
  const view = await history.read(step.id)
  assert.deepEqual(view?.files['model.yaml'], { notText: true })
  assert.deepEqual(view?.files['layout.yaml'], { text: '﻿{}\n' })
})

test('read gives the step before it, and nothing for an unknown id', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const first = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  const second = await history.record('Two', 'you')
  assert.ok(first && second)
  const view = await history.read(second.id)
  assert.equal(view?.step.label, 'Two')
  assert.deepEqual(view?.step.changed, ['model.yaml'])
  assert.equal(view?.previous?.id, first.id)
  assert.deepEqual(view?.previous?.files, { 'model.yaml': { text: 'a: 1\n' } })
  assert.equal((await history.read(first.id))?.previous, undefined)
  assert.equal(await history.read('nope'), undefined)
})

test('now reads the files as they are', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  assert.deepEqual(await history.now(), { files: { 'model.yaml': { text: 'a: 1\n' } }, versions: { 'model.yaml': hashText('a: 1\n') } })
})

test('an unwritable store never throws, says why, and recovers', async t => {
  const { root, history, put } = await setup(t)
  const stateFile = join(root, 'state') // a file where the state folder should be
  await writeFile(stateFile, 'in the way')
  await put('model.yaml', 'a: 1\n')
  assert.equal(await history.record('Added a', 'you'), undefined)
  assert.deepEqual(await history.ensureCurrent('write'), { saved: false })
  assert.equal(await history.clear(), true)
  assert.equal(history.failure, undefined)
  await rm(stateFile)
  assert.ok(await history.record('Added a', 'you'))
  assert.equal(history.failure, undefined)
})

test('the trail is trimmed to the newest 300 once it holds 30 more than that', async t => {
  const small = await setup(t)
  await prefill(small.history.root, HISTORY_LIMIT)
  await small.put('model.yaml', 'n: next\n')
  await small.history.record('Step next', 'you')
  assert.equal((await small.history.list()).length, HISTORY_LIMIT + 1) // over the limit, not yet trimmed

  const { history, put } = await setup(t)
  await prefill(history.root, HISTORY_LIMIT + HISTORY_SLACK)
  assert.equal((await history.list()).length, HISTORY_LIMIT + HISTORY_SLACK) // not trimmed yet
  await put('model.yaml', `n: ${HISTORY_LIMIT + HISTORY_SLACK + 1}\n`)
  await history.record(`Step ${HISTORY_LIMIT + HISTORY_SLACK + 1}`, 'you')
  const list = await history.list()
  assert.equal(list.length, HISTORY_LIMIT)
  assert.equal(list[0].label, `Step ${HISTORY_LIMIT + HISTORY_SLACK + 1}`)
  assert.equal(list[list.length - 1].label, `Step ${HISTORY_SLACK + 2}`)
})

test('a trim that fails does not fail the record that caused it', async t => {
  const { history, put } = await setup(t)
  await prefill(history.root, HISTORY_LIMIT + HISTORY_SLACK)
  const stuck = join(history.root, 'blobs', 'eeeeeeeeeeeeeeee')
  await mkdir(stuck) // a directory where a blob should be: removing it as a file fails
  await utimes(stuck, new Date(0), new Date(0))
  await put('model.yaml', 'n: next\n')
  assert.ok(await history.record('Next', 'you'))
  assert.equal(history.failure, undefined)
  assert.equal((await history.list())[0].label, 'Next')
})

test('Review Focus: restoring the oldest step still works when recording the present trims it away', async t => {
  const { dir, history, put } = await setup(t)
  await prefill(history.root, HISTORY_LIMIT + HISTORY_SLACK)
  await ageBlobs(history.root)
  await put('model.yaml', 'changed outside\n')
  const oldest = (await history.list()).at(-1)
  assert.equal(oldest?.label, 'Step 1')
  const result = await history.restore(oldest!.id, (await history.now()).versions, 'Restored')
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'n: 1\n')
})

test('restore refuses a step that names a file Flowy may not write, before writing anything', async t => {
  const { dir, history, put } = await setup(t)
  await put('model.yaml', 'now\n')
  const hash = hashText('then\n')
  await openStore(history.root).putStep(
    { id: stepId(new Date(Date.UTC(2026, 0, 1)), 'aaaaaa'), time: '2026-01-01T00:00:00.000Z', label: 'Odd', source: 'you', app: 'browser', files: { 'model.yaml': hash, '../escape.yaml': hash } },
    new Map([[hash, new TextEncoder().encode('then\n')]]),
  )
  const odd = (await history.list())[0]
  const result = await history.restore(odd.id, (await history.now()).versions, 'x')
  assert.equal(result.ok, false)
  assert.ok(!result.ok && result.kind === 'failed' && /doesn't write/.test(result.message))
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'now\n')
  assert.deepEqual((await readdir(join(dir, '..'))).sort(), ['flowy', 'state'])
})

test('a restore that fails part way records the mix as a step', async t => {
  const { dir, history, put } = await setup(t)
  await put('model.yaml', 'one\n')
  await put('flows/a.yaml', 'name: A\n')
  const one = await history.record('One', 'you')
  await rm(join(dir, 'flows'), { recursive: true })
  await writeFile(join(dir, 'flows'), 'a file where the folder was') // flows/a.yaml can no longer be written
  await put('model.yaml', 'two\n')
  await history.record('Two', 'you')
  assert.ok(one)
  const result = await history.restore(one.id, (await history.now()).versions, 'x')
  assert.equal(result.ok, false)
  assert.ok(!result.ok && result.kind === 'failed')
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'one\n') // model.yaml was written before flows/a.yaml failed
  const top = (await history.list())[0]
  assert.match(top.label, /^Changed outside Flowy/)
  assert.deepEqual((await history.read(top.id))?.files, { 'model.yaml': { text: 'one\n' } })
})

test('restore does not throw when the trail cannot be read', async t => {
  const { history } = await setup(t)
  await mkdir(history.root, { recursive: true })
  await writeFile(join(history.root, 'steps'), 'a file where the folder of steps should be')
  const result = await history.restore('nope', {}, 'x')
  assert.equal(result.ok, false)
  assert.ok(!result.ok && result.kind === 'failed')
})

test('ensureCurrent names the step the whole list would, however long the run of identical steps', async t => {
  const content = 'same\n'
  const hash = hashText(content)
  const blobs = new Map([[hash, new TextEncoder().encode(content)], [hashText('other\n'), new TextEncoder().encode('other\n')]])
  const other = hashText('other\n')
  const at = (n: number, id = 'aaaaaa') => stepId(new Date(Date.UTC(2026, 0, 1) + n * 1000), id)
  const make = (n: number, source: StepSource, files: Record<string, string>): Step => ({ id: at(n), time: new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString(), label: `${source} ${n}`, source, app: 'browser', files })
  const cases: [string, Step[]][] = [
    ['one labelled step', [make(1, 'you', { 'model.yaml': hash })]],
    ['an outside step after a labelled one', [make(1, 'you', { 'model.yaml': hash }), make(2, 'outside', { 'model.yaml': hash })]],
    ['two outside steps', [make(1, 'you', { 'model.yaml': other }), make(2, 'outside', { 'model.yaml': hash }), make(3, 'outside', { 'model.yaml': hash })]],
    ['a labelled step after an outside one', [make(1, 'outside', { 'model.yaml': hash }), make(2, 'ai', { 'model.yaml': hash })]],
    ['a run longer than the first look', [make(1, 'you', { 'model.yaml': other }), ...[2, 3, 4, 5, 6, 7].map(n => make(n, 'outside', { 'model.yaml': hash }))]],
    ['a long run with a labelled step in the middle', [make(1, 'you', { 'model.yaml': other }), ...[2, 3, 4, 5, 6, 7].map(n => make(n, n === 5 ? 'you' : 'outside', { 'model.yaml': hash }))]],
  ]
  for (const [name, steps] of cases) {
    const { history, put } = await setup(t)
    await put('model.yaml', content)
    const store = openStore(history.root)
    for (const step of steps) await store.putStep(step, blobs)
    const ensured = await history.ensureCurrent('watch')
    assert.deepEqual(ensured, { saved: true, id: collapseSteps(await store.steps()).at(-1)?.id }, name)
  }
})

test('a history failure is logged once, in one quiet line, until it clears', async t => {
  const lines: string[] = []
  const { root, history, put } = await setup(t, { log: line => lines.push(line) })
  await writeFile(join(root, 'state'), 'in the way')
  await put('model.yaml', 'a: 1\n')
  await history.record('One', 'you')
  await history.record('Two', 'you')
  assert.equal(lines.length, 1)
  assert.match(lines[0], /history isn't being saved/i)
  await rm(join(root, 'state'))
  assert.ok(await history.record('Three', 'you'))
  await rm(join(root, 'state'), { recursive: true })
  await writeFile(join(root, 'state'), 'in the way again')
  await put('model.yaml', 'a: 2\n')
  await history.record('Four', 'you')
  assert.equal(lines.length, 2)
})

test('restore puts an older version back, removes a flow added since, and brings back one removed', async t => {
  const { dir, history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await put('flows/old.yaml', 'name: Old\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  await rm(join(dir, 'flows', 'old.yaml'))
  await put('flows/new.yaml', 'name: New\n')
  const two = await history.record('Two', 'you')
  assert.ok(one && two)

  const result = await history.restore(one.id, (await history.now()).versions, 'Restored the version from 10:00')
  assert.deepEqual(result, {
    ok: true,
    versions: { 'flows/new.yaml': null, 'flows/old.yaml': hashText('name: Old\n'), 'model.yaml': hashText('a: 1\n') },
    before: two.id,
  })
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'a: 1\n')
  assert.equal(await readFile(join(dir, 'flows', 'old.yaml'), 'utf8'), 'name: Old\n')
  assert.deepEqual(await readdir(join(dir, 'flows')), ['old.yaml'])
})

test('restore records itself on top of the list', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  await history.record('Two', 'you')
  assert.ok(one)
  await history.restore(one.id, (await history.now()).versions, 'Restored the version from 10:00')
  const [top, ...rest] = await history.list()
  assert.deepEqual([top.label, top.source, top.changed], ['Restored the version from 10:00', 'restore', ['model.yaml']])
  assert.deepEqual(rest.map(s => s.label), ['Two', 'One'])
})

test('restore refuses when a file changed since it was seen, and writes nothing', async t => {
  const { dir, history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  await history.record('Two', 'you')
  const seen = (await history.now()).versions
  await put('model.yaml', 'a: 3\n') // changed by someone else after the panel read it
  assert.ok(one)
  assert.deepEqual(await history.restore(one.id, seen, 'x'), { ok: false, kind: 'conflict', message: 'This file changed outside Flowy. Reloaded.' })
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'a: 3\n')
})

test('restore of an unknown id is unknown', async t => {
  const { history } = await setup(t)
  assert.deepEqual(await history.restore('nope', {}, 'x'), { ok: false, kind: 'unknown', message: 'That version is gone.' })
})

test('restore refuses while the history cannot be written, and changes nothing', async t => {
  // A fixed clock and random part make the name of the next step's file known: a folder of that name stops the step from being written.
  const { dir, history, put } = await setup(t, { now: () => new Date(Date.UTC(2026, 9, 20, 11, 0, 0)), random: () => 'cccccc' })
  await put('model.yaml', 'a: 1\n')
  const one = await history.record('One', 'you') // 20261020T110000000Z-cccccc
  await put('model.yaml', 'a: 2\n')
  await history.record('Two', 'you') // ...001Z-cccccc
  assert.ok(one)
  await mkdir(join(history.root, 'steps', '20261020T110000002Z-cccccc.json'))
  await put('model.yaml', 'a: 3\n')
  const result = await history.restore(one.id, (await history.now()).versions, 'x')
  assert.equal(result.ok, false)
  assert.ok(!result.ok && result.kind === 'unsaved' && /history isn't being saved/.test(result.message))
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'a: 3\n')
})

test('restore works from files that are not UTF-8 or not YAML', async t => {
  const { dir, history, put } = await setup(t)
  await put('model.yaml', 'objects: {}\n')
  const good = await history.record('Good', 'you')
  assert.ok(good)
  await put('model.yaml', new Uint8Array([0xff, 0xfe, 0x00]))
  await put('layout.yaml', 'a: [\n')
  const result = await history.restore(good.id, (await history.now()).versions, 'Restored')
  assert.equal(result.ok, true)
  assert.equal(await readFile(join(dir, 'model.yaml'), 'utf8'), 'objects: {}\n')
  assert.deepEqual(await readdir(dir), ['model.yaml'])
})

test('restore leaves the files Flowy does not write alone', async t => {
  const { dir, history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await put('flows/Bad_Flow.yaml', 'name: Bad\n')
  await put('flows/old.yml', 'name: Old\n')
  const one = await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  await history.record('Two', 'you')
  assert.ok(one)
  assert.equal((await history.restore(one.id, (await history.now()).versions, 'x')).ok, true)
  assert.equal(await readFile(join(dir, 'flows', 'Bad_Flow.yaml'), 'utf8'), 'name: Bad\n')
  assert.equal(await readFile(join(dir, 'flows', 'old.yml'), 'utf8'), 'name: Old\n')
})

test('steps made in the same millisecond keep their order', async t => {
  const { history, put } = await setup(t, { now: () => new Date(Date.UTC(2026, 9, 20, 10, 0, 0)), random: () => 'aaaaaa' })
  await put('model.yaml', 'a: 1\n')
  await history.record('One', 'you')
  await put('model.yaml', 'a: 2\n')
  await history.record('Two', 'you')
  assert.deepEqual((await history.list()).map(s => s.label), ['Two', 'One'])
})

test('clear empties the trail', async t => {
  const { history, put } = await setup(t)
  await put('model.yaml', 'a: 1\n')
  await history.record('Added a', 'you')
  await history.clear()
  assert.deepEqual(await history.list(), [])
})

test('a step stored with the old source name "claude" reads as "ai"', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'steps'), { recursive: true })
  const old = { time: '2026-10-20T10:00:00.000Z', label: 'Claude: put_object shop', source: 'claude', app: 'mcp', files: {} }
  await writeFile(join(root, 'steps', stepId(new Date(old.time), 'aaaaaa') + '.json'), JSON.stringify(old))
  assert.deepEqual((await openStore(root).steps()).map(s => [s.label, s.source]), [['Claude: put_object shop', 'ai']])
})
