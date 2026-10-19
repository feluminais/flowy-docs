import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrivals, MIX, pick, rng } from '../perf-lab/load/gen.ts'

test('rng gives the same numbers for the same seed, and others for another', () => {
  const a = rng(7)
  const b = rng(7)
  const first = [a(), a(), a()]
  assert.deepEqual([b(), b(), b()], first)
  assert.ok(first.every(n => n >= 0 && n < 1))
  assert.notDeepEqual([rng(8)(), rng(8)()], first.slice(0, 2))
})

test('arrivals are a rising run of times inside the window, about rate x seconds of them', () => {
  const times = arrivals(100, 20, rng(1))
  assert.ok(times.length > 1700 && times.length < 2300, `got ${times.length}`)
  assert.ok(times.every((t, i) => t >= 0 && t < 20_000 && (i === 0 || t >= times[i - 1])))
  assert.deepEqual(arrivals(100, 20, rng(1)), times) // the same seed, the same load
})

test('pick follows the shares of the mix', () => {
  const rand = rng(3)
  const seen = new Map<string, number>()
  for (let i = 0; i < 20_000; i++) {
    const kind = pick(MIX, rand)
    seen.set(kind, (seen.get(kind) ?? 0) + 1)
  }
  for (const [kind, share] of MIX) assert.ok(Math.abs((seen.get(kind) ?? 0) / 20_000 - share) < 0.02, `${kind}: ${seen.get(kind)}`)
})
