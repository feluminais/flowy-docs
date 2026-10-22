import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import fc from 'fast-check'
import { isAllowedPath } from '../src/core/filekinds.ts'
import { parseFile, serializeFile } from '../src/core/modelfiles.ts'
import type { Flow } from '../src/core/model.ts'
import { saveFile } from '../src/node/files.ts'
import { text } from './generated-text.ts'

// Properties instead of examples: the same few claims, tried against many generated inputs. A failing run prints the seed and the
// smallest input that breaks it, so a failure here can be turned into a normal test by pasting the input in.
const RUNS = { numRuns: 300 }

const id = fc.oneof(fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/), fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty', '007', '10'))

test('a model file reads back as the text that was saved, whatever the text holds', () => {
  fc.assert(
    fc.property(fc.dictionary(id, fc.record({ name: text, description: text, tech: text }, { noNullPrototype: true }), { minKeys: 1, maxKeys: 4, noNullPrototype: true }), fc.array(text, { maxLength: 4 }), (names, labels) => {
      const objects = Object.fromEntries(Object.entries(names).map(([key, o]) => [key, { type: 'system', ...o }]))
      const keys = Object.keys(objects)
      const connections = labels.map((label, i) => ({ from: keys[i % keys.length], to: keys[(i + 1) % keys.length], label }))
      const written = serializeFile('model.yaml', { objects, connections })
      const read = parseFile('model.yaml', written) as { objects: unknown; connections: unknown }
      assert.deepEqual(read.objects, objects)
      assert.deepEqual(read.connections, connections)
    }),
    RUNS,
  )
})

test('a flow reads back as the text that was saved, steps and groups included', () => {
  fc.assert(
    fc.property(text, fc.array(fc.record({ from: id, to: id, text, description: text }, { noNullPrototype: true }), { minLength: 1, maxLength: 4 }), (name, steps) => {
      const flow = { name, view: 'shop', steps }
      const read = parseFile('flows/pay.yaml', serializeFile('flows/pay.yaml', flow)) as Flow
      assert.equal(read.name, name)
      assert.deepEqual(read.steps, steps)
    }),
    RUNS,
  )
})

test('text with control characters is refused or kept exactly, never changed on the way through', () => {
  const awkward = fc.array(fc.oneof(fc.string({ unit: 'binary', maxLength: 4 }), fc.constantFrom('\u0000', '\u0007', '\u001b', '\u007f', '\u0085', ' ', ' ', '﻿', '￾')), { maxLength: 6 }).map(parts => parts.join(''))
  fc.assert(
    fc.property(awkward, value => {
      let written: string
      try {
        written = serializeFile('model.yaml', { objects: { a: { type: 'system', name: value } }, connections: [] })
      } catch {
        return // refused on the way out: fine
      }
      let read: { objects: Record<string, { name?: string }> }
      try {
        read = parseFile('model.yaml', written) as typeof read
      } catch {
        return // refused on the way back: fine
      }
      assert.equal(read.objects.a.name, value)
    }),
    RUNS,
  )
})

test('no path that is allowed for writing leaves the model folder', () => {
  const piece = fc.constantFrom('..', '.', '', 'flows', 'failures', 'model.yaml', 'layout.yaml', 'a', 'x.yaml', 'C:', '~', '%2e%2e', '..\\', 'a\u0000b', '\\')
  const path = fc.array(piece, { maxLength: 6 }).chain(parts => fc.constantFrom('/', '\\').map(sep => parts.join(sep)))
  fc.assert(
    fc.property(path, rel => {
      if (!isAllowedPath(rel)) return
      assert.ok(!isAbsolute(rel), rel)
      assert.ok(!rel.includes('\u0000'), rel)
      assert.ok(!rel.split(/[\\/]/).includes('..'), rel)
    }),
    { numRuns: 2000 },
  )
})

test('a write to any path leaves everything outside the model folder as it was', async t => {
  const root = await mkdtemp(join(tmpdir(), 'flowy-prop-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const dir = join(root, 'flowy')
  await mkdir(dir)
  await writeFile(join(root, 'neighbour.txt'), 'keep')
  const piece = fc.constantFrom('..', '.', 'flows', 'failures', 'model.yaml', 'layout.yaml', 'a', 'x.yaml', '...', 'flows/..', '')
  const path = fc.array(piece, { minLength: 1, maxLength: 4 }).map(parts => parts.join('/'))
  await fc.assert(
    fc.asyncProperty(path, async rel => {
      await saveFile(dir, rel, 'objects: {}\nconnections: []\n', null).catch(() => undefined)
      assert.deepEqual((await readdir(root)).sort(), ['flowy', 'neighbour.txt'], rel)
    }),
    { numRuns: 150 },
  )
})

test('every short string of spaces, tabs, line breaks and letters reads back as it was written', () => {
  // Not generated: all of them, 3905 strings. Block text that starts with a line of only spaces once lost them, or could not be read.
  const alphabet = [' ', '\n', '\t', 'a', '#']
  const lost: string[] = []
  const go = (s: string) => {
    if (s !== '') {
      const file = serializeFile('flows/pay.yaml', { name: 'Pay', view: 'shop', steps: [{ from: 'a', text: s }] })
      let read: string | undefined
      try {
        read = (parseFile('flows/pay.yaml', file) as Flow).steps[0].text
      } catch {
        read = undefined
      }
      if (read !== s) lost.push(JSON.stringify(s))
    }
    if (s.length < 5) for (const c of alphabet) go(s + c)
  }
  go('')
  assert.deepEqual(lost, [])
})
