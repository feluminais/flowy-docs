import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ParseError, ROOT } from '../../src/core/model.ts'
import type { Model } from '../../src/core/model.ts'
import { interpolate, knee, kneeText, parseRun, rollUp, strain, traffic } from '../../src/core/perf.ts'
import type { Metrics } from '../../src/core/perf.ts'
import { nameOf } from '../../src/core/views.ts'
import {
  activeRun, BOX_KEYS, boxAt, boxSeries, clampPos, fmtLoad, fmtMs, fmtPct, fmtRate, gridOf, isTested, LINE_KEYS, levelLabels, lineAt, lineSeries, loadAt, METRICS, pathOf, RAMP_MS, RAMP_STEP_MS, rampFrom, rampPos, scaleOf, snap, top, xAt, yAt,
} from '../../ui/src/perfview.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The folder the runs live in: a small shop, and a run for each way a run can read, struggle or fail. */
export const PERF_DIR = join(root, 'desktop/fixtures/cases/perf/flowy')

/** Run files as they can be written: good ones, and every kind of wrong one that reads the same way in both libraries. */
const RAW: [id: string, text: string][] = [
  ['good', 'name: Good\nabout: Two levels\nunit: users\nentry: web\nlevels:\n  - load: 1\n    overall: { rate: 1, p50: 10, p95: 20, errors: 0 }\n    objects:\n      web: { util: 0.5, queue: 2, errors: 0.01 }\n    connections:\n      - { from: web, to: db, rate: 1, p50: 3, p95: 4, errors: 0 }\n  - load: 2\n'],
  ['unnamed', 'levels:\n  - load: 1\n  - load: 2\n'],
  ['bare', 'name: Bare\nlevels:\n  - load: 0\n  - load: 0.5\n  - load: 1e2\n'],
  ['spaced', 'name:   \nunit: ""\nabout: "  "\nentry: ~\nlevels:\n  - load: "5"\n  - load: " 6 "\n'],
  ['empty', ''],
  ['null-file', '~\n'],
  ['list-file', '- a\n- b\n'],
  ['text-file', 'just words\n'],
  ['name-list', 'name: [a, b]\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['unit-map', 'name: A\nunit: { a: b }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['levels-map', 'name: A\nlevels: { a: b }\n'],
  ['levels-text', 'name: A\nlevels: nope\n'],
  ['levels-none', 'name: A\n'],
  ['levels-one', 'name: A\nlevels:\n  - load: 1\n'],
  ['level-text', 'name: A\nlevels:\n  - load: 1\n  - nope\n'],
  ['load-missing', 'name: A\nlevels:\n  - load: 1\n  - objects: {}\n'],
  ['load-word', 'name: A\nlevels:\n  - load: 1\n  - load: many\n'],
  ['load-negative', 'name: A\nlevels:\n  - load: -1\n  - load: 2\n'],
  ['load-equal', 'name: A\nlevels:\n  - load: 3\n  - load: 3\n'],
  ['load-down', 'name: A\nlevels:\n  - load: 3\n  - load: 2.5\n'],
  ['overall-list', 'name: A\nlevels:\n  - load: 1\n    overall: [1]\n  - load: 2\n'],
  ['objects-list', 'name: A\nlevels:\n  - load: 1\n    objects: [web]\n  - load: 2\n'],
  ['object-text', 'name: A\nlevels:\n  - load: 1\n    objects:\n      web: busy\n  - load: 2\n'],
  ['object-empty', 'name: A\nlevels:\n  - load: 1\n    objects:\n      web:\n      db: ~\n  - load: 2\n'],
  ['connections-map', 'name: A\nlevels:\n  - load: 1\n    connections: { a: b }\n  - load: 2\n'],
  ['connection-text', 'name: A\nlevels:\n  - load: 1\n    connections: [web]\n  - load: 2\n'],
  ['connection-open', 'name: A\nlevels:\n  - load: 1\n    connections:\n      - { from: web }\n  - load: 2\n'],
  ['connection-empty', 'name: A\nlevels:\n  - load: 1\n    connections:\n      - { from: web, to: "" }\n  - load: 2\n'],
  ['twice', 'name: A\nlevels:\n  - load: 1\n    connections:\n      - { from: a, to: b, rate: 1 }\n      - { from: a, to: b, rate: 2 }\n      - { from: b, to: a, rate: 3 }\n  - load: 2\n'],
  ['bad-numbers', 'name: A\nlevels:\n  - load: 1\n    overall: { rate: -1, p50: x, p95: "" }\n    objects:\n      a: { util: 1.5, queue: -2, errors: 7 }\n      b: { util: 0, queue: 0, errors: 1 }\n    connections:\n      - { from: a, to: b, rate: 1e400, p50: 9, p95: 8, errors: -0.1 }\n  - load: 2\n'],
  ['unknown-keys', 'name: A\ncolour: red\nlevels:\n  - load: 1\n    extra: 1\n    objects:\n      a: { util: 0.1, note: hi }\n  - load: 2\n'],
  ['merge', 'name: A\n<<<<<<< HEAD\nlevels: []\n=======\nlevels: [1]\n>>>>>>> other\n'],
  ['proto', 'name: A\nlevels:\n  - load: 1\n    objects:\n      __proto__: { util: 0.5 }\n      constructor: { util: 0.6 }\n  - load: 2\n'],
  ['numeric-ids', 'name: A\nlevels:\n  - load: 1\n    objects:\n      b: { util: 0.1 }\n      "10": { util: 0.2 }\n      "2": { util: 0.3 }\n  - load: 2\n    objects:\n      "2": { util: 0.4 }\n'],
]

const METRICS_CASES: Metrics[] = [
  {}, { util: 0 }, { util: 0.5 }, { errors: 0 }, { errors: 0.01 }, { errors: 0.05 }, { errors: 0.5 }, { util: 0.9, errors: 0.01 }, { util: 0.3, errors: 0.04 }, { util: 0.849 }, { util: 0.85 }, { errors: 0.0425 }, { errors: 0.043 },
  { util: 0.2, errors: 0.01 }, { util: 0.5, errors: 0.025 }, { queue: 4 }, { rate: 9, p50: 1 },
]

const failure = (e: unknown) => {
  if (e instanceof ParseError) return { error: { file: e.file, line: e.line ?? null, message: e.reason } }
  throw e
}

/**
 * What the TypeScript says about load-test runs: how every kind of run file reads (and what is wrong with it), how a folder's `perf/` loads (which
 * file becomes which problem), and for each run in a fixture shop the numbers between tested levels, what a view rolls up, where it first struggles
 * and the traffic to draw, for every load and view. The C# tests (PerfTests) must reproduce all of it.
 */
export async function dumpPerf(): Promise<unknown> {
  const parsed = RAW.map(([id, text]) => {
    try {
      return { id, text, ...parseRun(id, text) }
    } catch (e) {
      return { id, text, ...failure(e) }
    }
  })

  const state = await loadState(PERF_DIR)
  if ('parseError' in state) throw new Error('the perf fixture folder must load')
  const model: Model = { ...state.model, flows: state.flows, layout: state.layout }
  const runs = state.runs ?? {}
  const views = [ROOT, 'shop', 'web', 'orders', 'db']
  const computed = Object.entries(runs).map(([id, run]) => {
    const tested = run.levels.map(l => l.load)
    const between = tested.slice(1).map((l, i) => (l + tested[i]) / 2)
    const loads = [...new Set([0, tested[0] - 5, ...tested, ...between, tested[tested.length - 1] + 5])]
    const found = knee(run)
    return {
      id,
      loads: loads.map(load => ({
        load,
        level: interpolate(run, load),
        traffic: views.map(view => ({ view, ...traffic(model, run, load, view) })),
      })),
      rolled: run.levels.flatMap(level => views.map(view => ({ load: level.load, view, ...rollUp(model, level, view) }))),
      knee: found ?? null,
      text: found ? kneeText(run, found, oid => nameOf(model, oid)) : null,
    }
  })

  return {
    parsed,
    strain: METRICS_CASES.map(metrics => ({ metrics, strain: strain(metrics) ?? null })),
    folder: { runs, problems: state.runProblems ?? [] },
    computed,
  }
}

const NUMBERS = [0, 0.00005, 0.00125, 0.0004, 0.034, 0.045, 0.0625, 1.005, 7.35, 7.45, 0.05, 0.096, 0.1, 0.4, 0.996, 1, 4.2, 4.25, 9.99, 10, 12.5, 98, 180, 999, 1000, 2400, 2500, 12345.678]
const POSITIONS = [-1, 0, 0.25, 0.5, 1, 1.5, 2.999, 3, 9]
const SCALES: [(number | undefined)[], { log?: boolean; from?: number; to?: number }?][] = [
  [[0.2, 0.8, undefined]], [[0.2, 0.8], { to: 1 }], [[undefined]], [[12, 450, undefined], { log: true }], [[100], { log: true }], [[0, -4], { log: true }],
  [[5, 5]], [[3, 9], { from: 2 }], [[], { log: true }], [[0.001, 20000], { log: true }],
]
const AREA = { x: 10, y: 3, width: 90, height: 50 }

/**
 * What ui/src/perfview.ts says: where along a run a position is, how Ramp moves it, how numbers are written, and the scales, curves, grids and
 * readings of the panel. The desktop panel (Flowy.Core/PerfView.cs) must say the same.
 */
export async function dumpPerfView(): Promise<unknown> {
  const state = await loadState(PERF_DIR)
  if ('parseError' in state) throw new Error('the perf fixture folder must load')
  const model: Model = { ...state.model, flows: state.flows, layout: state.layout }
  const runs = state.runs ?? {}
  const ramp = runs.ramp
  const views = [ROOT, 'shop', 'web']
  return {
    constants: { rampMs: RAMP_MS, rampStepMs: RAMP_STEP_MS },
    words: NUMBERS.map(n => ({ n, ms: fmtMs(n), pct: fmtPct(n), rate: fmtRate(n), load: fmtLoad(n, 'req/s') })),
    metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, log: m.log ?? false, max: m.max ?? null, shown: [0, 0.4, 0.93, 40.4, 2500].map(v => m.show(v)) })),
    keys: { box: BOX_KEYS, line: LINE_KEYS },
    positions: Object.entries(runs).map(([id, run]) => ({
      id,
      top: top(run),
      at: POSITIONS.map(pos => ({
        pos, clamp: clampPos(run, pos), load: loadAt(run, pos), tested: isTested(pos), snap: snap(run, pos), from: rampFrom(run, pos),
        ramp: [0, 16, 1000, RAMP_MS / 2, RAMP_MS].map(ms => rampPos(run, pos, ms)),
      })),
    })),
    active: [...Object.keys(runs), 'gone', '__proto__'].map(id => ({ id, active: activeRun(runs, id) })).concat([{ id: 'x', active: activeRun({}, 'x') }]),
    scales: SCALES.map(([values, options]) => ({ values: values.map(v => v ?? null), options: options ?? null, scale: scaleOf(values, options) })),
    place: (() => {
      const linear = { lo: 0, hi: 1, log: false }
      const log = { lo: 1, hi: 3, log: true }
      return {
        x: [0, 1, 2, 3].flatMap(n => [1, 2, 4].map(count => ({ i: n, count, x: xAt(AREA, n, count) }))),
        y: [1, 0.5, 0, 7, -1].map(v => ({ scale: linear, v, y: yAt(AREA, linear, v) })).concat([10, 100, 1000, 3, 0.5].map(v => ({ scale: log, v, y: yAt(AREA, log, v) }))),
        paths: [[0, 1, undefined, 0.5], [undefined, undefined], [0.25], [1, 1, 1], [0, undefined, 1]].map(values => ({ values: values.map(v => v ?? null), path: pathOf(values, linear, AREA) })),
        grids: [{ lo: 1, hi: 3, log: true }, { lo: 0, hi: 4, log: true }, { lo: -1, hi: 1, log: true }].map(scale => ({ scale, grid: gridOf(scale, AREA) })),
        labels: Object.entries(runs).map(([id, run]) => ({ id, labels: levelLabels(run, AREA), few: levelLabels(run, AREA, 2) })),
      }
    })(),
    readings: Object.entries(runs).flatMap(([id, run]) => {
      const objects = Object.keys(model.objects)
      const lines = [['orders', 'db'], ['customer', 'web'], ['worker', 'gateway'], ['orders', 'gateway'], ['db', 'orders']]
      const loads = [run.levels[0].load, (run.levels[0].load + run.levels[1].load) / 2, run.levels[run.levels.length - 1].load]
      return views.map(view => ({
        id, view,
        boxes: objects.map(o => ({ id: o, series: Object.fromEntries(BOX_KEYS.map(k => [k, boxSeries(model, run, view, o, k).map(v => v ?? null)])), at: loads.map(load => boxAt(model, run, view, o, load) ?? null) })),
        lines: lines.map(([from, to]) => ({ from, to, series: Object.fromEntries(LINE_KEYS.map(k => [k, lineSeries(model, run, view, from, to, k).map(v => v ?? null)])), at: loads.map(load => lineAt(model, run, view, from, to, load) ?? null) })),
      }))
    }),
    ramp: ramp ? { id: 'ramp', levels: ramp.levels.length } : null,
  }
}
