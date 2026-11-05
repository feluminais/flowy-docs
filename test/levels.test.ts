import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backAbout, backFrom, cameBack, remember } from '../ui/src/levels.ts'

const anywhere = () => true

test('a move remembers where the reader was, and staying put does not', () => {
  assert.deepEqual(remember([], 'root', 'ordering'), ['root'])
  assert.deepEqual(remember(['root'], 'ordering', 'back-office'), ['root', 'ordering'])
  assert.deepEqual(remember(['root'], 'ordering', 'ordering'), ['root'])
  assert.deepEqual(remember(['root', 'ordering'], 'ordering', 'root'), ['root', 'ordering'], 'the same level is not listed twice in a row')
})

test('Esc goes back to the level before, then the one before that', () => {
  let levels = remember(remember([], 'root', 'ordering'), 'ordering', 'back-office')
  const first = cameBack(levels, 'back-office', anywhere)
  assert.equal(first?.to, 'ordering')
  levels = first!.rest
  assert.equal(cameBack(levels, 'ordering', anywhere)?.to, 'root')
  assert.equal(cameBack([], 'root', anywhere), undefined, 'nothing to go back to')
})

test('a level that is gone or is the current one is passed over', () => {
  assert.equal(cameBack(['root', 'gone', 'ordering'], 'ordering', id => id !== 'gone')?.to, 'root')
  assert.deepEqual(cameBack(['root', 'gone'], 'ordering', id => id !== 'gone')?.rest, [])
  assert.equal(cameBack(['gone'], 'ordering', id => id !== 'gone'), undefined)
})

test('Esc goes back from the box the level is drawn as', () => {
  const chain = ['dispatch', 'back-office', 'root'] // the level Esc heads for, then the boxes around it
  assert.equal(backFrom(chain, 'across', id => id === 'dispatch'), 'dispatch')
  assert.equal(backFrom(chain, 'across', id => id === 'back-office'), 'back-office', 'drawn as the box around it')
  assert.equal(backFrom(chain, 'in', id => id === 'dispatch'), 'dispatch')
  assert.equal(backFrom(chain, 'out', () => true), undefined, 'going out zooms about the middle')
  assert.equal(backFrom(chain, 'across', () => false), undefined, 'not drawn: about the middle')
})

test('Esc plays a move it knows back from where it started', () => {
  assert.deepEqual(backAbout('out', [-300, 120]), [-300, 120], 'out lands on the spot the reader went in from')
  assert.deepEqual(backAbout('across', [-300, 120]), [300, -120], 'across goes back the other way')
  assert.equal(backAbout('in', [-300, 120]), undefined)
  assert.equal(backAbout('out', undefined), undefined, 'not known: about the middle')
})

test('only the last 50 levels are kept', () => {
  let levels: readonly string[] = []
  for (let i = 0; i < 60; i++) levels = remember(levels, `v${i}`, `v${i + 1}`)
  assert.equal(levels.length, 50)
  assert.equal(levels.at(-1), 'v59')
})
