import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ParseError, ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import { checkRun, eventsPassed, eventText, interpolate, knee, kneeText, parseRun, rollUp, runStates, scaleText, sourceKey, strain, traffic } from '../../src/core/perf.ts'
import type { Metrics } from '../../src/core/perf.ts'
import { nameOf } from '../../src/core/views.ts'
import {
  activeRun, BOX_KEYS, boxAt, boxSeries, clampPos, cursorX, eventFractions, eventRows, failureMarks, fmtBytes, fmtLoad, fmtMs, fmtPct, fmtRate, gridOf, isTested, LINE_KEYS, levelLabels, levelX, lineAt, lineSeries, loadAt, METRICS, pathOf, posAt, RAMP_MS, RAMP_STEP_MS, rampFrom, rampPos, scaleOf, slidePos, sliderFraction, sliderRange, sliderValue, snap, sourceCss, tickLabels, top, xAt, xOfPos, yAt,
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
  ['source-good', 'name: S\nunit: u\nsource: { color: blue, dot: rate / 50, size: bytes / 400 }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-hex', 'name: S\nsource: { color: "#1D9E75" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-short-hex', 'name: S\nsource: { color: "#abc", dot: "-rate", size: "bytes * 2" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-block', 'name: S\nsource:\n  color: teal\n  dot: (rate + rate) / 100\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-empty', 'name: S\nsource: {}\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-null', 'name: S\nsource: ~\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-blank', 'name: S\nsource:\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-text', 'name: S\nsource: 5\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-list', 'name: S\nsource: [blue]\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-unknown', 'name: S\nsource: { colour: blue, extra: 1, color: red }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-unknown-only', 'name: S\nsource: { colour: blue }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-long-key', `name: S\nsource: { ${'k'.repeat(300)}: 1, color: red }\nlevels:\n  - load: 1\n  - load: 2\n`],
  ['source-proto', 'name: S\nsource: { __proto__: x, constructor: y, color: red }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-bad-color', 'name: S\nsource: { color: chartreuse, dot: rate / 50 }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-short-color', 'name: S\nsource: { color: "#12" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-color-list', 'name: S\nsource: { color: [red] }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-long-color', `name: S\nsource: { color: ${'x'.repeat(300)} }\nlevels:\n  - load: 1\n  - load: 2\n`],
  ['source-bad-dot', 'name: S\nsource: { color: green, dot: "rate *", size: "bytes / 0.5" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-dot-list', 'name: S\nsource: { dot: [rate] }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-size-map', 'name: S\nsource: { size: { a: b } }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-formulas', 'name: S\nsource: { dot: "((rate)", size: "1e3" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-formula-call', 'name: S\nsource: { dot: "rate()" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-formula-hex', 'name: S\nsource: { dot: "0x10", size: "1.2.3" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-formula-name', 'name: S\nsource: { dot: "speed / 2", size: "Rate" }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-formula-blank', 'name: S\nsource: { dot: "", size: "   " }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['source-formula-80', `name: S\nsource: { dot: "rate${' + 1'.repeat(19)}" }\nlevels:\n  - load: 1\n  - load: 2\n`],
  ['source-formula-81', `name: S\nsource: { dot: "rate${' + 1'.repeat(19)} " }\nlevels:\n  - load: 1\n  - load: 2\n`],
  ['source-formula-divide', 'name: S\nsource: { dot: rate / 0, size: -bytes }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['bytes-good', 'name: B\nlevels:\n  - load: 1\n    overall: { bytes: 90 }\n    connections:\n      - { from: web, to: db, bytes: 400.5, rate: 3 }\n  - load: 2\n'],
  ['bytes-bad', 'name: B\nlevels:\n  - load: 1\n    connections:\n      - { from: web, to: api, bytes: big }\n      - { from: auth, to: db, bytes: -3 }\n  - load: 2\n'],
  ['failure-good', 'name: F\nlevels:\n  - load: 1\n    connections:\n      - { from: web, to: api, failure: lost }\n      - { from: auth, to: db, failure: rejected }\n      - { from: orders, to: db, failure: "" }\n      - { from: queue, to: worker, failure: ~ }\n  - load: 2\n'],
  ['failure-bad', 'name: F\nlevels:\n  - load: 1\n    connections:\n      - { from: web, to: api, failure: weird }\n      - { from: auth, to: db, failure: [lost] }\n      - { from: orders, to: db, failure: Lost }\n  - load: 2\n'],
  ['numeric-ids', 'name: A\nlevels:\n  - load: 1\n    objects:\n      b: { util: 0.1 }\n      "10": { util: 0.2 }\n      "2": { util: 0.3 }\n  - load: 2\n    objects:\n      "2": { util: 0.4 }\n'],
  // Runs over time: the axis, the key a level carries its number under, and every way an event can be wrong.
  ['time-good', 'name: Payments killed at 40 s\nabout: Made up\naxis: time\nunit: s\nentry: web\nevents:\n  - { at: 85, on: gateway, state: running, text: Answers again }\n  - { at: 40, on: gateway, state: stopped, text: Payments killed }\n  - { at: 70, on: gateway, state: starting, text: Restart begins }\nlevels:\n  - at: 0\n    overall: { rate: 98, p50: 60, p95: 140, errors: 0 }\n    objects:\n      gateway: { util: 0.4 }\n  - at: 45\n    objects:\n      gateway: { util: 0 }\n      web: { util: 0.9, errors: 0.6 }\n  - at: 120\n'],
  ['time-bare', 'name: T\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n'],
  ['time-no-events', 'name: T\naxis: time\nunit: min\nlevels:\n  - at: 0.5\n  - at: " 1e1 "\n'],
  ['time-load-key', 'name: T\naxis: time\nlevels:\n  - at: 0\n  - load: 5\n'],
  ['time-both-keys', 'name: T\naxis: time\nlevels:\n  - at: 0\n  - at: 5\n    load: 9\n'],
  ['time-all-load-keys', 'name: T\naxis: time\nlevels:\n  - load: 0\n  - load: 5\n'],
  ['time-missing-at', 'name: T\naxis: time\nlevels:\n  - at: 0\n  - objects: {}\n'],
  ['time-word-at', 'name: T\naxis: time\nlevels:\n  - at: soon\n  - at: 5\n'],
  ['time-negative-at', 'name: T\naxis: time\nlevels:\n  - at: -1\n  - at: 5\n'],
  ['time-backwards', 'name: T\naxis: time\nlevels:\n  - at: 5\n  - at: 5\n'],
  ['time-bad-numbers', 'name: T\naxis: time\nlevels:\n  - at: 3\n    objects:\n      a: { util: 2 }\n  - at: 4\n'],
  ['load-at-key', 'name: T\nlevels:\n  - load: 1\n  - at: 5\n'],
  ['load-empty-at', 'name: T\nlevels:\n  - load: 1\n  - at:\n    load: 5\n'],
  ['axis-load', 'name: T\naxis: load\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['axis-weird', 'name: T\naxis: weird\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['axis-number', 'name: T\naxis: 5\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['axis-list', 'name: T\naxis: [time]\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['axis-capital', 'name: T\naxis: Time\nlevels:\n  - at: 1\n  - at: 2\n'],
  ['axis-blank', 'name: T\naxis:\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['axis-tilde', 'name: T\naxis: ~\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['axis-long', `name: T\naxis: ${'x'.repeat(300)}\nlevels:\n  - load: 1\n  - load: 2\n`],
  ['events-on-load', 'name: T\nevents:\n  - { at: 1, on: web, state: stopped }\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['events-on-load-empty', 'name: T\nevents: []\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['events-on-load-null', 'name: T\nevents: ~\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['events-empty', 'name: T\naxis: time\nevents: []\nlevels:\n  - at: 1\n  - at: 2\n'],
  ['events-null', 'name: T\naxis: time\nevents:\nlevels:\n  - at: 1\n  - at: 2\n'],
  ['events-map', 'name: T\naxis: time\nevents: { at: 1 }\nlevels:\n  - at: 1\n  - at: 2\n'],
  ['events-text', 'name: T\naxis: time\nevents: soon\nlevels:\n  - at: 1\n  - at: 2\n'],
  ['event-not-map', 'name: T\naxis: time\nevents: [soon, [1], { at: 1, on: web, state: stopped }]\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-no-at', 'name: T\naxis: time\nevents:\n  - { on: web, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-word-at', 'name: T\naxis: time\nevents:\n  - { at: soon, on: web, state: stopped }\n  - { at: "", on: web, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-no-on', 'name: T\naxis: time\nevents:\n  - { at: 1, state: stopped }\n  - { at: 1, on: "", state: stopped }\n  - { at: 1, on: [web], state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-bad-state', 'name: T\naxis: time\nevents:\n  - { at: 1, on: web, state: asleep }\n  - { at: 1, on: web, state: Stopped }\n  - { at: 1, on: web, state: [stopped] }\n  - { at: 1, on: web }\n  - { at: 1, on: web, state: "" }\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-long-state', `name: T\naxis: time\nevents:\n  - { at: 1, on: web, state: ${'s'.repeat(300)} }\nlevels:\n  - at: 0\n  - at: 2\n`],
  ['event-everything-wrong', 'name: T\naxis: time\nunit: s\nevents:\n  - { at: 9, state: asleep, text: [x] }\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-text', 'name: T\naxis: time\nevents:\n  - { at: 1, on: web, state: stopped, text: [x] }\n  - { at: 1.5, on: web, state: running, text: "  " }\n  - { at: 2, on: web, state: degraded, text: "  Slow  " }\n  - { at: 2, on: db, state: degraded, text: ~ }\nlevels:\n  - at: 0\n  - at: 2\n'],
  ['event-edges', 'name: T\naxis: time\nunit: s\nevents:\n  - { at: 0, on: web, state: stopped }\n  - { at: 150, on: web, state: running }\nlevels:\n  - at: 0\n  - at: 150\n'],
  ['event-outside', 'name: T\naxis: time\nunit: s\nevents:\n  - { at: -0.001, on: web, state: stopped }\n  - { at: 150.001, on: web, state: running }\n  - { at: 1e9, on: web, state: running }\nlevels:\n  - at: 0\n  - at: 150\n'],
  ['event-ties', 'name: T\naxis: time\nevents:\n  - { at: 5, on: web, state: stopped }\n  - { at: 5, on: web, state: degraded }\n  - { at: 5, on: db, state: starting }\n  - { at: 9, on: web, state: running }\n  - { at: 9, on: web, state: stopping }\n  - { at: 1, on: db, state: stopped }\nlevels:\n  - at: 0\n  - at: 10\n'],
  ['event-proto', 'name: T\naxis: time\nevents:\n  - { at: 1, on: __proto__, state: stopped }\n  - { at: 2, on: constructor, state: degraded }\n  - { at: 3, on: toString, state: running }\nlevels:\n  - at: 0\n  - at: 4\n    objects:\n      __proto__: { util: 0.5 }\n'],
  ['event-numeric-ids', 'name: T\naxis: time\nevents:\n  - { at: 1, on: b, state: stopped }\n  - { at: 2, on: "10", state: stopped }\n  - { at: 3, on: "2", state: degraded }\n  - { at: 4, on: "007", state: starting }\nlevels:\n  - at: 0\n  - at: 5\n'],
  ['event-resorted', 'name: T\naxis: time\nevents:\n  - { at: 3, on: a, state: stopped }\n  - { at: 1, on: a, state: starting }\n  - { at: 3, on: b, state: stopped }\n  - { at: 2, on: a, state: running }\nlevels:\n  - at: 0\n  - at: 4\n'],
  ['event-unit-default', 'name: T\naxis: time\nevents:\n  - { at: 9, on: web, state: stopped }\nlevels:\n  - at: 0\n  - at: 4\n'],
]

const METRICS_CASES: Metrics[] = [
  {}, { util: 0 }, { util: 0.5 }, { errors: 0 }, { errors: 0.01 }, { errors: 0.05 }, { errors: 0.5 }, { util: 0.9, errors: 0.01 }, { util: 0.3, errors: 0.04 }, { util: 0.849 }, { util: 0.85 }, { errors: 0.0425 }, { errors: 0.043 },
  { util: 0.2, errors: 0.01 }, { util: 0.5, errors: 0.025 }, { queue: 4 }, { rate: 9, p50: 1 },
]

/**
 * Runs with a source, read and played against the same shop as the folder's: each is a made-up run whose texts the C# test reads from the fixture.
 * Between them: a formula for dots and for size, a colour alone, formulas that give no value on a line, a count past the cap, failure styles, and a
 * line that two connections land on (bytes weighted by rate, failure kept or dropped).
 */
const SCALED: [id: string, text: string][] = [
  ['dots', `name: Dots
unit: req/s
source: { color: blue, dot: rate / 50, size: bytes / 400 }
levels:
  - load: 1
    connections:
      - { from: customer, to: web, rate: 100, p50: 10, bytes: 400, errors: 0 }
      - { from: orders, to: db, rate: 50, p50: 400, bytes: 800, errors: 0.1, failure: lost }
      - { from: auth, to: db, rate: 150, p50: 100, bytes: 300, errors: 0.02, failure: lost }
      - { from: orders, to: queue, rate: 1000, p50: 0.5, bytes: 100 }
      - { from: worker, to: gateway, rate: 40, p50: 90, bytes: 2000, errors: 0.3, failure: rejected }
      - { from: orders, to: gateway, rate: 40, p50: 90, errors: 0.3, failure: lost }
  - load: 2
    connections:
      - { from: customer, to: web, rate: 1000, p50: 10, bytes: 1600, errors: 0.05 }
      - { from: orders, to: db, rate: 500, p50: 800, bytes: 800, errors: 0.2, failure: lost }
      - { from: auth, to: db, rate: 1500, p50: 400, bytes: 300, errors: 0.04, failure: rejected }
      - { from: orders, to: queue, rate: 100000, p50: 0.5, bytes: 100000000 }
      - { from: worker, to: gateway, rate: 0, p50: 90, bytes: 10 }
      - { from: orders, to: gateway, rate: 60, p50: 90, errors: 0.3 }
`],
  ['curve', `name: Curve
source: { color: "#1D9E75" }
levels:
  - load: 1
    connections: [{ from: customer, to: web, rate: 100, p50: 10 }, { from: orders, to: db, rate: 10, p50: 5, errors: 0.5, failure: rejected }]
  - load: 2
    connections: [{ from: customer, to: web, rate: 900, p50: 30 }, { from: orders, to: db, rate: 90 }]
`],
  ['fallback', `name: Fallback
source: { color: amber, dot: bytes / 100, size: bytes / 400 }
levels:
  - load: 1
    connections: [{ from: customer, to: web, rate: 100, p50: 10 }, { from: orders, to: db, rate: 10, p50: 5, bytes: 500 }, { from: orders, to: queue, rate: 5, bytes: -1 }]
  - load: 2
    connections: [{ from: customer, to: web, rate: 100, p50: 10, bytes: 100 }, { from: orders, to: db, rate: 10, p50: 5 }, { from: orders, to: queue, rate: 5 }]
`],
  ['no-value', `name: No value
source: { dot: -rate, size: rate / 0 }
levels:
  - load: 1
    connections: [{ from: customer, to: web, rate: 100, p50: 10 }, { from: orders, to: db, rate: 10 }]
  - load: 2
    connections: [{ from: customer, to: web, rate: 100, p50: 10 }, { from: orders, to: db, rate: 10 }]
`],
  ['huge', `name: Huge
source: { dot: rate * 1000000, size: rate * rate }
levels:
  - load: 1
    connections: [{ from: customer, to: web, rate: 100000000, p50: 3000 }, { from: orders, to: db, rate: 5, p50: 1 }]
  - load: 2
    connections: [{ from: customer, to: web, rate: 1, p50: 3000 }, { from: orders, to: db, rate: 5, p50: 1 }]
`],
  ['ratio', `name: Ratio
source: { color: teal, dot: rate * 3 }
levels:
  - load: 1
    connections: [{ from: customer, to: web, rate: 0.1, p50: 10 }, { from: orders, to: db, rate: 0.4, p50: 400 }]
  - load: 2
    connections: [{ from: customer, to: web, rate: 2, p50: 10 }, { from: orders, to: db, rate: 8, p50: 400 }]
`],
  ['sized', `name: Sized
levels:
  - load: 100
    connections:
      - { from: orders, to: db, rate: 50, bytes: 100, failure: lost }
      - { from: auth, to: db, rate: 150, bytes: 300, failure: lost }
      - { from: customer, to: web, rate: 10, bytes: 200, failure: lost }
      - { from: orders, to: queue, bytes: 100 }
      - { from: queue, to: worker, rate: 5, bytes: 100, failure: lost }
  - load: 200
    connections:
      - { from: orders, to: db, rate: 50, bytes: 100, failure: rejected }
      - { from: auth, to: db, rate: 150, bytes: 300, failure: lost }
      - { from: customer, to: web, rate: 30, bytes: 600 }
      - { from: orders, to: queue, bytes: 300 }
      - { from: queue, to: worker, rate: 5, bytes: 100, failure: lost }
`],
]

/**
 * Runs over time, read and played against the same shop as the folder's, kept out of the folder so the panel's tests see the runs they always did. For each: what
 * checkRun says of it, how its events read in words, and at each time that matters (every level and event, a hair either side, and past both ends) the events
 * that have passed and the states they leave.
 */
const TIMED: [id: string, text: string][] = [
  ['outage', RAW.find(([id]) => id === 'time-good')![1]],
  ['ghosts', `name: Ghosts
axis: time
events:
  - { at: 1, on: ghost, state: stopped }
  - { at: 2, on: ghost, state: running }
  - { at: 3, on: gateway, state: degraded }
  - { at: 4, on: phantom, state: starting }
levels:
  - at: 0
    objects: { ghost: { util: 0.1 } }
  - at: 5
`],
  ['ties', RAW.find(([id]) => id === 'event-ties')![1]],
  ['numeric', RAW.find(([id]) => id === 'event-numeric-ids')![1]],
  ['proto', RAW.find(([id]) => id === 'event-proto')![1]],
  ['text', RAW.find(([id]) => id === 'event-text')![1]],
  ['inside', `name: Inside
axis: time
events:
  - { at: 10, on: web, state: degraded }
  - { at: 20, on: orders, state: stopped }
  - { at: 30, on: web, state: running }
levels:
  - at: 0
  - at: 40
`],
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
  const model: Model = modelOf(state)
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

  // Runs with a source, kept out of the folder so the panel's tests see the runs they always did.
  const scaled = SCALED.map(([id, text]) => {
    const read = parseRun(id, text)
    const loads = [...new Set(read.run.levels.flatMap((l, i, all) => (i === 0 ? [l.load] : [(all[i - 1].load + l.load) / 2, l.load])))]
    return {
      id,
      text,
      ...read,
      scale: scaleText(read.run) ?? null,
      loads: loads.map(load => ({
        load,
        level: interpolate(read.run, load),
        traffic: views.map(view => {
          const t = traffic(model, read.run, load, view)
          return { view, ...t, key: sourceKey(read.run, t.lines) ?? null }
        }),
        rolled: views.map(view => ({ view, ...rollUp(model, interpolate(read.run, load), view) })),
      })),
    }
  })

  const timed = TIMED.map(([id, text]) => {
    const read = parseRun(id, text)
    const times = new Set<number>([-1, read.run.levels[0].load - 1, read.run.levels[read.run.levels.length - 1].load + 1])
    for (const t of [...read.run.levels.map(l => l.load), ...(read.run.events ?? []).map(e => e.at)]) for (const d of [-0.001, 0, 0.001]) times.add(t + d)
    return {
      id,
      text,
      ...read,
      check: checkRun(id, read.run, model),
      words: (read.run.events ?? []).map(e => eventText(e, oid => nameOf(model, oid))),
      times: [...times].sort((a, b) => a - b).map(t => ({ t, passed: eventsPassed(read.run, t), states: runStates(read.run, t) })),
    }
  })

  return {
    parsed,
    strain: METRICS_CASES.map(metrics => ({ metrics, strain: strain(metrics) ?? null })),
    folder: { runs, problems: state.runProblems ?? [] },
    computed,
    scaled,
    timed,
  }
}

const NUMBERS = [0, 0.00005, 0.00125, 0.0004, 0.034, 0.045, 0.0625, 1.005, 7.35, 7.45, 0.05, 0.096, 0.1, 0.4, 0.996, 1, 4.2, 4.25, 9.99, 10, 12.5, 98, 180, 999, 999.4, 999.5, 1000, 2400, 2500, 12345.678, 99949, 999499, 999500, 999999, 1000000, 2400000, 48000000]
/** Which kinds of failing call the key draws, for lines as the traffic makes them. */
const MARKS: { failed: number; failure?: 'lost' | 'rejected' }[][] = [
  [], [{ failed: 0 }], [{ failed: 0, failure: 'lost' }], [{ failed: 0.1 }], [{ failed: 0.1, failure: 'lost' }], [{ failed: 0.1, failure: 'rejected' }, { failed: 0.05 }],
  [{ failed: 0.1, failure: 'rejected' }, { failed: 0.2, failure: 'lost' }], [{ failed: 0.1, failure: 'lost' }, { failed: 0 }, { failed: 0.3, failure: 'lost' }],
]
/** A source's colour as the key draws it: a name for both themes, a hex as written, and what is neither. */
const COLOURS: (string | undefined)[] = ['blue', 'gray', '#1D9E75', '#abc', '#ABCDEF', 'chartreuse', '#12', '', undefined]
const POSITIONS = [-1, 0, 0.25, 0.5, 1, 1.5, 2.999, 3, 9]
/**
 * Runs over time for the panel's maths: the outage of the design (levels at 0, 45 and 120 s, events at 40, 70 and 85), Plum's seven levels, levels that crowd
 * together, a run whose last two levels are close, and one that starts away from zero.
 */
const TIMED_VIEW: [id: string, text: string][] = [
  ['outage', RAW.find(([id]) => id === 'time-good')![1]],
  ['plum', 'name: P\naxis: time\nunit: s\nevents:\n  - { at: 40, on: web, state: stopped }\n  - { at: 70, on: web, state: starting }\n  - { at: 85, on: web, state: running }\nlevels:\n  - at: 0\n  - at: 30\n  - at: 45\n  - at: 60\n  - at: 90\n  - at: 120\n  - at: 150\n'],
  ['crowded', 'name: C\naxis: time\nlevels:\n  - at: 0\n  - at: 1\n  - at: 2\n  - at: 100\n  - at: 101\n  - at: 150\n'],
  ['close', 'name: C\naxis: time\nlevels:\n  - at: 0\n  - at: 100\n  - at: 101\n'],
  ['offset', 'name: O\naxis: time\nunit: min\nevents:\n  - { at: 10, on: db, state: degraded }\n  - { at: 20, on: db, state: running }\nlevels:\n  - at: 10\n  - at: 12.5\n  - at: 20\n'],
]
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
  const model: Model = modelOf(state)
  const runs = state.runs ?? {}
  const ramp = runs.ramp
  const views = [ROOT, 'shop', 'web']
  return {
    constants: { rampMs: RAMP_MS, rampStepMs: RAMP_STEP_MS },
    words: NUMBERS.map(n => ({ n, ms: fmtMs(n), pct: fmtPct(n), rate: fmtRate(n), bytes: fmtBytes(n), load: fmtLoad(n, 'req/s') })),
    marks: MARKS.map(lines => ({ lines, marks: failureMarks(lines) })),
    colours: COLOURS.map(color => ({ color: color ?? null, css: sourceCss(color) ?? null })),
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
    // The slider of the folder's load runs, which stays even, and the slider of runs over time, which is linear in time.
    sliders: Object.entries(runs).map(([id, run]) => ({
      id,
      range: sliderRange(run),
      events: eventFractions(run),
      ticks: tickLabels(run),
      few: tickLabels(run, 2),
      at: POSITIONS.map(pos => ({ pos, fraction: sliderFraction(run, pos), value: sliderValue(run, pos), slide: slidePos(run, pos), x: xOfPos(run, pos), back: posAt(run, loadAt(run, pos)) })),
    })),
    timed: TIMED_VIEW.map(([id, text]) => {
      const run = parseRun(id, text).run
      const values = run.levels.map((_, i) => (i % 3 === 1 ? undefined : (i + 1) * 10))
      const line = { lo: 0, hi: 80, log: false }
      const first = run.levels[0].load
      const last = run.levels[run.levels.length - 1].load
      const xs = [first - 5, first, (first + last) / 4, 40, 45, 82.5, 119.999, last, last + 380, ...run.levels.map(l => l.load), ...(run.events ?? []).map(e => e.at)]
      return {
        id,
        text,
        top: top(run),
        range: sliderRange(run),
        events: eventFractions(run),
        ticks: tickLabels(run),
        few: tickLabels(run, 2),
        at: POSITIONS.map(pos => ({
          pos, load: loadAt(run, pos), x: xOfPos(run, pos), fraction: sliderFraction(run, pos), value: sliderValue(run, pos), cursor: cursorX(run, AREA, pos), snap: snap(run, pos),
          ramp: [0, 16, 1000, RAMP_MS / 2, RAMP_MS].map(ms => rampPos(run, pos, ms)), from: rampFrom(run, pos),
        })),
        posAt: xs.map(x => ({ x, pos: posAt(run, x), slide: slidePos(run, x) })),
        rows: xs.map(x => ({ x, rows: eventRows(run, x) })),
        levels: run.levels.map((_, i) => levelX(run, AREA, i)),
        labels: levelLabels(run, AREA),
        few_labels: levelLabels(run, AREA, 2),
        path: pathOf(values, line, AREA, run),
        even: pathOf(values, line, AREA),
      }
    }),
  }
}
