import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILE_KINDS, FOLDER_KINDS, KINDS, WRITTEN_FOLDERS, folderUnder, idOfPath, idUnder, isAllowedPath, isRemovableFile, kindOfPath, pathOf } from '../src/core/filekinds.ts'
import type { FolderKind } from '../src/core/filekinds.ts'
import { emptyModel } from '../src/core/model.ts'
import { fileData, modelFiles, parseFile, serializeFile } from '../src/core/modelfiles.ts'

test('every folder kind turns an id into a path and back', () => {
  for (const kind of FOLDER_KINDS) {
    for (const id of ['a', 'orders-2', '__proto__']) {
      const path = pathOf(kind, id)
      assert.equal(path, `${kind.folder}/${id}.yaml`)
      assert.equal(idOfPath(kind, path), id)
      assert.equal(kindOfPath(path), kind)
    }
  }
})

test('where files nest, the id is the file name and the folder is what is between', () => {
  const flow = FILE_KINDS.flow
  assert.equal(pathOf(flow, 'refund', 'payments/stripe'), 'flows/payments/stripe/refund.yaml')
  assert.equal(idOfPath(flow, 'flows/payments/stripe/refund.yaml'), 'refund')
  assert.equal(idUnder(flow, 'flows/payments/stripe/refund.yaml'), 'refund')
  assert.equal(folderUnder(flow, 'flows/payments/stripe/refund.yaml'), 'payments/stripe')
  assert.equal(folderUnder(flow, 'flows/refund.yaml'), '')
  assert.equal(idOfPath(flow, 'flows/payments/.yaml'), undefined)
  // A kind whose files do not nest keeps the whole rest of the path as its id, which is never a valid one.
  assert.equal(idOfPath(FILE_KINDS.failure, 'failures/a/b.yaml'), 'a/b')
  assert.equal(folderUnder(FILE_KINDS.failure, 'failures/a/b.yaml'), '')
})

test('a path that is not <folder>/<id>.yaml has no id', () => {
  for (const kind of FOLDER_KINDS) {
    for (const rel of [`${kind.folder}/.yaml`, `${kind.folder}/a.yml`, `${kind.folder}/a.yaml.tmp`, 'model.yaml', `${kind.folder}.yaml`]) assert.equal(idOfPath(kind, rel), undefined, rel)
  }
})

test('every single-file kind finds itself by its path', () => {
  for (const kind of KINDS) if (kind.file !== undefined) assert.equal(kindOfPath(kind.file), kind)
})

test('no path belongs to two kinds, and kinds do not share a folder or file', () => {
  const places = KINDS.map(k => k.file ?? k.folder)
  assert.equal(new Set(places).size, places.length)
})

test('isAllowedPath and isRemovableFile agree with the registry', () => {
  for (const kind of KINDS) {
    const paths = kind.file !== undefined ? [kind.file] : ['a', 'orders-2'].map(id => pathOf(kind, id))
    for (const rel of paths) {
      assert.equal(isAllowedPath(rel), kind.writable, rel)
      assert.equal(isRemovableFile(rel), kind.removable, rel)
    }
    if (kind.folder !== undefined) {
      for (const id of ['A', '', 'root']) assert.equal(isAllowedPath(pathOf(kind, id)), false, pathOf(kind, id))
      // Only a folder kind whose files nest takes a file in a folder, and the id is the file's name.
      assert.equal(isAllowedPath(pathOf(kind, 'a', 'x/y')), kind.writable && kind.nested, pathOf(kind, 'a', 'x/y'))
    }
  }
  for (const rel of [undefined, null, 3, {}]) assert.equal(isAllowedPath(rel), false)
  assert.equal(isAllowedPath('notes.yaml'), false)
  assert.equal(isAllowedPath('other/a.yaml'), false)
})

test('the written folders are the folder kinds Flowy writes', () => {
  assert.deepEqual([...WRITTEN_FOLDERS], FOLDER_KINDS.filter(k => k.writable).map(k => k.folder))
  assert.deepEqual([...WRITTEN_FOLDERS], ['flows', 'failures'])
  assert.equal(FILE_KINDS.run.writable, false)
})

test('every kind Flowy writes reads, serializes and parses back the same', () => {
  const m = emptyModel()
  m.objects = { shop: { type: 'system', name: 'Shop' } }
  m.flows = { checkout: { name: 'Checkout', view: 'shop', steps: [] } }
  m.failures = { ordering: { name: 'Ordering', modes: {} } }
  m.layout = { shop: { shop: [1, 2] } }
  const paths = KINDS.filter(k => k.writable).map(k => (k.file !== undefined ? k.file : pathOf(k as FolderKind, k.kind === 'flow' ? 'checkout' : 'ordering')))
  assert.equal(paths.length, 4)
  for (const rel of paths) {
    const data = fileData(m, rel)
    assert.notEqual(data, undefined, rel)
    const text = serializeFile(rel, data)
    const parsed = parseFile(rel, text)
    if (rel === 'model.yaml') assert.deepEqual((parsed as { objects: unknown }).objects, m.objects)
    else assert.deepEqual(parsed, data, rel)
  }
})

test('modelFiles writes every thing of every folder kind Flowy writes, at its registry path', () => {
  const m = emptyModel()
  m.flows = { a: { name: 'A', view: 'root', steps: [] } }
  m.failures = { b: { name: 'B', modes: {} } }
  assert.deepEqual(Object.keys(modelFiles(m)), ['model.yaml', pathOf(FILE_KINDS.flow, 'a'), pathOf(FILE_KINDS.failure, 'b')])
})
