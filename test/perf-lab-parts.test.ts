import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Lru } from '../perf-lab/src/cache.ts'
import { JobQueue, Slots } from '../perf-lab/src/queue.ts'

test('Lru drops the entry used least recently', () => {
  const lru = new Lru<string>(2)
  lru.set(1, 'a')
  lru.set(2, 'b')
  assert.equal(lru.get(1), 'a') // 2 is now the oldest
  lru.set(3, 'c')
  assert.equal(lru.get(2), undefined)
  assert.equal(lru.get(1), 'a')
  assert.equal(lru.get(3), 'c')
  assert.equal(lru.size, 2)
})

/** A promise that is settled from outside, to hold a job open. */
function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => (release = resolve))
  return { promise, release }
}

test('JobQueue runs at most `concurrency` jobs at once, in order, and says how many wait', async () => {
  const gates = [0, 1, 2, 3, 4].map(() => deferred())
  const started: number[] = []
  let running = 0
  let most = 0
  const queue = new JobQueue(2, async id => {
    started.push(id)
    running++
    most = Math.max(most, running)
    await gates[id].promise
    running--
  })
  for (let id = 0; id < 5; id++) queue.push(id)
  assert.deepEqual(started, [0, 1])
  assert.equal(queue.depth, 3)
  gates[0].release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, [0, 1, 2])
  assert.equal(queue.depth, 2)
  for (const gate of gates) gate.release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(started, [0, 1, 2, 3, 4])
  assert.equal(queue.depth, 0)
  assert.equal(most, 2)
})

test('JobQueue carries on after a job fails', async () => {
  const done: number[] = []
  const queue = new JobQueue(1, async id => {
    if (id === 0) throw new Error('first fails')
    done.push(id)
  })
  queue.push(0)
  queue.push(1)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(done, [1])
})

test('Slots lets `size` run at once and makes the rest wait their turn', async () => {
  const slots = new Slots(2)
  const gates = [deferred(), deferred(), deferred()]
  const order: number[] = []
  const runs = gates.map((gate, i) => slots.run(async () => { order.push(i); await gate.promise }))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [0, 1])
  assert.equal(slots.queued, 1)
  gates[0].release()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(order, [0, 1, 2])
  assert.equal(slots.queued, 0)
  gates[1].release()
  gates[2].release()
  await Promise.all(runs)
})
