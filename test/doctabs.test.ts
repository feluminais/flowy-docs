import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fallbackName, groupOf, groupsOf, heirOf, modelInfo, readTabs, saveTabs, tabAddress, tabName, withTab } from '../ui/src/doctabs.ts'
import type { DocTab } from '../ui/src/doctabs.ts'

const tab = (id: string, name = id, of?: string): DocTab => ({ id, name, ...(of === undefined ? {} : { of }), hash: '' })
const ids = (tabs: DocTab[]) => tabs.map(t => t.id)

test('a sketch belongs to its model, also the first model, whose id is empty', () => {
  assert.equal(groupOf('shop/sketches/rough'), 'shop')
  assert.equal(groupOf('sketches/rough'), '')
  assert.equal(groupOf('shop'), 'shop')
})

test('a sketch opens after the last tab of its model and a new model at the end', () => {
  const open = [tab('a'), tab('a/sketches/x'), tab('b')]
  assert.deepEqual(ids(withTab(open, tab('a/sketches/y'))), ['a', 'a/sketches/x', 'a/sketches/y', 'b'])
  assert.deepEqual(ids(withTab(open, tab('c'))), ['a', 'a/sketches/x', 'b', 'c'])
  assert.deepEqual(ids(withTab(open, tab('c/sketches/z'))), ['a', 'a/sketches/x', 'b', 'c/sketches/z'])
})

test('a model opens in front of its sketches that are already open', () => {
  assert.deepEqual(ids(withTab([tab('a'), tab('b/sketches/x'), tab('c')], tab('b'))), ['a', 'b', 'b/sketches/x', 'c'])
})

test('a tab already open stays where it is, with its new name and the place it was left', () => {
  const open = [tab('a'), { ...tab('b'), hash: '#view' }]
  assert.deepEqual(withTab(open, tab('b', 'Bee')), [tab('a'), { id: 'b', name: 'Bee', hash: '#view' }])
})

test('the tab before in the group takes over, else the next, else the one before', () => {
  const open = [tab('a'), tab('a/sketches/x'), tab('b'), tab('c')]
  assert.equal(heirOf(open, 'a/sketches/x')?.id, 'a')
  assert.equal(heirOf(open, 'b')?.id, 'c')
  assert.equal(heirOf(open, 'c')?.id, 'b')
  assert.equal(heirOf([tab('a')], 'a'), undefined)
})

test('tabs fall into a group for each model, in order', () => {
  assert.deepEqual(groupsOf([tab('a'), tab('a/sketches/x'), tab('b')]).map(ids), [['a', 'a/sketches/x'], ['b']])
})

test('a sketch without its model beside it says whose it is', () => {
  const sketch = tab('a/sketches/x', 'Rough', 'Plum')
  assert.equal(tabName(sketch, [tab('a'), sketch]), 'Rough')
  assert.equal(tabName(sketch, [sketch, tab('b')]), 'Rough (sketch of Plum)')
})

test('a tab goes back to the place it was left, and the first model has no ?model=', () => {
  const page = { pathname: '/' }
  assert.equal(tabAddress({ ...tab('a/sketches/x'), hash: '#root' }, page), '/?model=a%2Fsketches%2Fx#root')
  assert.equal(tabAddress({ ...tab(''), hash: '#delivery' }, page), '/#delivery')
})

test('a tab with no name is called what the server calls the model, and a sketch by its id', () => {
  const models = [{ id: 'C:/a/flowy', name: 'a', where: 'C:/a/flowy' }, { id: 'b', name: 'bee', where: 'b' }]
  assert.equal(fallbackName(undefined, models), 'a')
  assert.equal(fallbackName('b', models), 'bee')
  assert.equal(fallbackName('b/sketches/rough', models), 'rough')
  assert.equal(fallbackName('sketches/rough', undefined), 'rough')
  assert.equal(fallbackName(undefined, undefined), 'Model')
  assert.equal(modelInfo('b', models)?.where, 'b')
})

test('storage that holds nothing, rubbish or refuses gives no tabs and throws nothing', () => {
  assert.deepEqual(readTabs({ getItem: () => null }), [])
  assert.deepEqual(readTabs({ getItem: () => 'not json' }), [])
  assert.deepEqual(readTabs({ getItem: () => '[{"id":3},"x",null]' }), [])
  assert.doesNotThrow(() => saveTabs([tab('a')], { setItem: () => { throw new Error('full') } }))
  assert.deepEqual(readTabs({ getItem: () => { throw new Error('blocked') } }), [])
})
