import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PlayerClock } from '../ui/src/clock.ts'
import { createPartStore } from '../ui/src/parts.ts'
import type { Frames, PartPlan } from '../ui/src/parts.ts'

// The store the lines of a pair read their parting from. A React effect may be run, cleaned up and run again (StrictMode does it on every mount of the dev server), so a store has to
// hear the clock again after it was detached.

function setup() {
  let now = 0
  const clock = new PlayerClock(() => now)
  const asked: (() => void)[] = []
  const frames: Frames = fn => {
    asked.push(fn)
    return () => void asked.splice(asked.indexOf(fn), 1)
  }
  return { clock, move: (ms: number) => (now += ms), asked, parts: createPartStore(clock, frames) }
}

const plans: ReadonlyMap<string, PartPlan> = new Map([['a b', { lit: [0, 1, 0], beat: { at: 0, dur: 200 } }]])

test('a store that was detached and attached again hears the clock: a scrub and a pause change the pose', () => {
  const { clock, move, parts } = setup()
  const detach = parts.attach()
  parts.set('s1', plans, { jump: false, still: false })
  detach() // the simulated unmount
  const again = parts.attach() // and the mount again
  const seen: (readonly number[] | undefined)[] = []
  const stop = parts.subscribe(() => seen.push(parts.lam('a b')))
  clock.pause() // frozen at the start of the stop: the pair has not begun to part
  clock.seek(400) // a scrub to after the part beat
  assert.deepEqual(parts.lam('a b'), [0, 1, 0])
  assert.ok(seen.length > 0, 'the lines were told')
  clock.seek(0)
  assert.deepEqual(parts.lam('a b'), [], 'a scrub back to the start closes the pair again')
  move(500)
  again()
  stop()
})

test('a detached store stops hearing the clock and asks for no more frames', () => {
  const { clock, asked, parts } = setup()
  const detach = parts.attach()
  parts.set('s1', plans, { jump: false, still: false })
  assert.equal(asked.length, 1, 'the pair is on its way')
  detach()
  assert.equal(asked.length, 0)
  const before = parts.lam('a b')
  clock.pause()
  clock.seek(400)
  assert.equal(parts.lam('a b'), before, 'nothing is heard while detached')
  parts.attach() // the clock moved meanwhile: attaching draws where it is now
  assert.deepEqual(parts.lam('a b'), [0, 1, 0])
})

test('detaching twice does no harm, and a listener of a line outlives the detach', () => {
  const { clock, parts } = setup()
  const detach = parts.attach()
  let told = 0
  parts.subscribe(() => told++)
  detach()
  detach()
  parts.attach()
  parts.set('s1', plans, { jump: false, still: true })
  clock.seek(0)
  assert.ok(told > 0, 'the line that listened before still hears')
})
