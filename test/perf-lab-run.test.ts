import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRun } from '../src/core/perf.ts'
import type { Level } from '../src/core/perf.ts'
import { formatRun } from '../perf-lab/load/write-run.ts'

test('formatRun writes a file that parseRun reads back as the same levels', () => {
  const levels: Level[] = [
    {
      load: 10,
      overall: { rate: 9.8, p50: 12.34, p95: 40.1, errors: 0 },
      objects: { 'web-api': { util: 0.123, errors: 0.0123 }, queue: { queue: 4 } },
      connections: [{ from: 'shopper', to: 'web-api', rate: 9.5, p50: 0.2, p95: 30, errors: 0 }],
    },
    { load: 20, overall: {}, objects: {}, connections: [] },
  ]
  const text = formatRun({ name: 'A "quoted" name: with a colon', about: 'About # this: run', unit: 'req/s', entry: 'shopper' }, levels)
  const { run, problems } = parseRun('x', text)
  assert.deepEqual(problems, [])
  assert.equal(run.name, 'A "quoted" name: with a colon')
  assert.equal(run.about, 'About # this: run')
  assert.equal(run.entry, 'shopper')
  assert.deepEqual(run.levels, levels)
})

test('formatRun drops digits a reader does not need', () => {
  const text = formatRun(
    { name: 'N', about: 'A', unit: 'req/s', entry: 'e' },
    [{ load: 1, overall: { rate: 12.3456, p50: 0.004, p95: 100.001, errors: 0.00004 }, objects: {}, connections: [] }, { load: 2, overall: {}, objects: {}, connections: [] }],
  )
  assert.match(text, /overall: \{ rate: 12\.3, p50: 0, p95: 100, errors: 0 \}/)
})
