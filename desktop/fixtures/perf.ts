import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ParseError, ROOT } from '../../src/core/model.ts'
import { modelOf } from '../../src/core/state.ts'
import type { Model } from '../../src/core/model.ts'
import type { Problem } from '../../src/core/problem.ts'
import { eventsPassed, knee, kneeOf, runStates, strain } from '../../src/core/perf/analyse.ts'
import { checkRun, checkRuns } from '../../src/core/perf/check.ts'
import { dialsOf, loadOfPosition, lockstepPositions, lockstepTop, settingAt } from '../../src/core/perf/dials.ts'
import { interpolate, levelAt } from '../../src/core/perf/levels.ts'
import { parseRun } from '../../src/core/perf/parse.ts'
import { rollUpLoad } from '../../src/core/perf/rollup.ts'
import { eventText, kneeText, kneeTextOf, scaleText, sourceKey, sourceKeyAt } from '../../src/core/perf/text.ts'
import { idleOf } from '../../src/core/perf/idle.ts'
import { amountOf, callSize } from '../../src/core/perf/measure.ts'
import { traffic, trafficAt } from '../../src/core/perf/traffic.ts'
import type { Dial, Metrics, Run, Setting } from '../../src/core/perf/types.ts'
import { nameOf } from '../../src/core/views.ts'
import {
  activeRun, activeSeries, bracketOf, BOX_KEYS, boxAt, boxSeries, boxSeriesIn, dialTicks, dialTop, edgeActive, heldText, lineSeriesIn, modeLabel, openingPositions, overText, placeActive, positionsOf, rampActive, rampFromActive, settingOf, slideDial, stepActive, stepFrom, clampPos, cursorX, eventFractions, eventRows, failureMarks, fmtBytes, fmtLoad, fmtMs, fmtPct, fmtRate, gridOf, isTested, LINE_KEYS, levelLabels, levelX, lineAt, lineSeries, loadAt, loadNote, METRICS, pathOf, posAt, RAMP_MS, RAMP_STEP_MS, rampFrom, rampPos, scaleOf, slidePos, sliderFraction, sliderRange, sliderValue, snap, sourceCss, tickLabels, top, xAt, xOfPos, yAt,
} from '../../ui/src/perfview.ts'
import { loadState } from '../../src/node/files.ts'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** The folder the runs live in: a small shop, and a run for each way a run can read, struggle or fail. */
export const PERF_DIR = join(root, 'desktop/fixtures/cases/perf/flowy')

const SOURCE_ORDERS = '  orders: { name: Customer orders, entry: customer, unit: orders/min, color: blue, dot: rate / 50 }\n'
const SOURCE_PINGS = '  pings: { name: Courier pings, entry: auth, unit: pings/s, color: green, dot: rate / 25, size: bytes / 100 }\n'
const GRID_LOADS: [orders: number, pings: number][] = [[100, 50], [100, 100], [200, 50], [200, 100], [300, 50], [300, 100]]

/**
 * One level of the grid of orders and pings: db fills with both, a shared line carries both with a `by`, a line carries only orders, and one has no `by` (it draws in a neutral
 * colour). `load` is the level's own text when a case wants it wrong.
 */
function gridLevel(o: number, p: number, load = `{ orders: ${o}, pings: ${p} }`, by = `by: { orders: { rate: ${o / 2}, bytes: 400 } }`): string {
  const util = Math.round((0.05 + o * 0.0015 + p * 0.004) * 1000) / 1000
  return `  - load: ${load}
    overall: { rate: ${o / 2 + p / 2}, p50: ${10 + o / 20}, p95: ${40 + o / 5 + p} }
    objects:
      db: { util: ${util}, queue: ${Math.round(o / 50 + p / 25)} }
      web: { util: ${o / 1000} }
    connections:
      - { from: orders, to: db, rate: ${o / 2}, p50: ${5 + o / 50}, bytes: 400, ${by} }
      - { from: auth, to: db, rate: ${p / 2}, p50: ${8 + p / 5}, bytes: 100, errors: ${p > 50 ? 0.04 : 0}, failure: lost, by: { pings: { rate: ${p / 2}, bytes: 100 } } }
      - { from: customer, to: web, rate: ${o}, p50: 12 }
`
}

/** Three sources, two loads each: Alpha and Beta on one line, Beta and Gamma on another. */
function threeLevel(a: number, b: number, c: number, load = `{ a: ${a}, b: ${b}, c: ${c} }`): string {
  return `  - load: ${load}
    overall: { rate: ${a + b + c}, p95: ${100 + a * 5 + b * 2 + c} }
    objects:
      db: { util: ${Math.round((0.1 + a * 0.01 + b * 0.02 + c * 0.05) * 1000) / 1000}, queue: ${a} }
      gateway: { errors: ${c / 100} }
    connections:
      - { from: orders, to: gateway, rate: ${a + b}, p50: 30, by: { a: { rate: ${a}, bytes: 100 }, b: { rate: ${b}, p50: 60 } } }
      - { from: worker, to: gateway, rate: ${b + c}, failure: rejected, by: { b: { rate: ${b} }, c: { rate: ${c}, errors: 0.1 } } }
`
}
const THREE_SOURCES = '  a: { name: Alpha, unit: a/s, color: blue, dot: rate / 10 }\n  b: { name: Beta, unit: b/s, dot: rate / 5, size: bytes / 50 }\n  c: { name: Gamma, unit: c/s, color: orange }\n'
const THREE_LOADS: [number, number, number][] = [[10, 5, 1], [10, 5, 3], [10, 15, 1], [10, 15, 3], [20, 5, 1], [20, 5, 3], [20, 15, 1], [20, 15, 3]]

/** The text of a run tested together, right or wrong in one way. */
function GRID_TEXT(variant: string): string {
  const head = (sources: string) => `name: Dinner rush, both at once\nabout: Made up\nsources:\n${sources}levels:\n`
  const both = SOURCE_ORDERS + SOURCE_PINGS
  const all = (loads = GRID_LOADS) => loads.map(([o, p]) => gridLevel(o, p)).join('')
  const without = (loads: [number, number][], drop: [number, number]) => loads.filter(([o, p]) => o !== drop[0] || p !== drop[1])
  switch (variant) {
    case '': return head(both) + all()
    case 'shuffled': return head(both) + all([[200, 100], [100, 50], [300, 50], [100, 100], [300, 100], [200, 50]])
    case 'numeric':
      return head('  "10": { name: Big, unit: u/s, color: teal, dot: rate / 5 }\n  "2": { name: Small, unit: v/s }\n')
        + '  - load: { "2": 5, "10": 1 }\n    objects: { db: { util: 0.1 } }\n    connections: [{ from: orders, to: db, rate: 6, by: { "2": { rate: 5 }, "10": { rate: 1 } } }]\n'
        + '  - load: { "10": 1, "2": 9 }\n    objects: { db: { util: 0.2 } }\n    connections: [{ from: orders, to: db, rate: 10, by: { "2": { rate: 9 }, "10": { rate: 1 } } }]\n'
        + '  - load: { "10": 11, "2": 5 }\n    objects: { db: { util: 0.4 } }\n    connections: [{ from: orders, to: db, rate: 16, by: { "10": { rate: 11 }, "2": { rate: 5 } } }]\n'
        + '  - load: { "10": 11, "2": 9 }\n    objects: { db: { util: 0.9 } }\n    connections: [{ from: orders, to: db, rate: 20, by: { "2": { rate: 9 }, "10": { rate: 11 } } }]\n'
    case 'three': return `name: Three at once\nsources:\n${THREE_SOURCES}levels:\n${THREE_LOADS.map(([a, b, c]) => threeLevel(a, b, c)).join('')}`
    case 'missing': return head(both) + all(without(GRID_LOADS, [200, 100]))
    case 'missing-three': return `name: Three at once\nsources:\n${THREE_SOURCES}levels:\n${THREE_LOADS.filter(([a, b, c]) => !(a === 20 && b === 15 && c === 1)).map(([a, b, c]) => threeLevel(a, b, c)).join('')}`
    case 'twice': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(100, 50)
    case 'extra-source': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(300, 100, '{ orders: 300, pings: 100, mail: 5 }')
    case 'lacks-source': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(300, 100, '{ orders: 300 }')
    case 'word': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(300, 100, '{ orders: many, pings: 100 }')
    case 'negative': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(300, 100, '{ orders: -300, pings: 100 }')
    case 'scalar': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(300, 100, '300')
    case 'no-load': return head(both) + all(GRID_LOADS.slice(0, 5)) + '  - objects: { db: { util: 0.5 } }\n'
    case 'load-list': return head(both) + all(GRID_LOADS.slice(0, 5)) + gridLevel(300, 100, '[300, 100]')
    case 'one-load': return head(both) + [100, 200, 300].map(o => gridLevel(o, 50)).join('')
    case 'one-source': return head(SOURCE_ORDERS) + all()
    case 'four-sources': return head(`${both}  c: { name: C }\n  d: { name: D }\n`) + all()
    case 'bad-id': return head(both.replace('  pings:', '  Pings:')) + all()
    case 'sources-list': return head('').replace('sources:\n', 'sources: [orders, pings]\n') + all()
    case 'source-text': return head(`${SOURCE_ORDERS}  pings: nope\n`) + all()
    case 'source-blank': return head(`${SOURCE_ORDERS}  pings:\n`) + all()
    case 'slips':
      return head(
        '  orders: { name: [x], entry: [y], unit: { z: 1 }, colour: blue, color: chartreuse, dot: "rate *", size: [1], extra: 1 }\n'
        + '  pings: { name: "", entry: "", unit: "  ", color: "#12", dot: "((rate)", size: "bytes / 0" }\n',
      ) + all()
    case 'colors': return head(both.replace('color: green', 'color: blue')) + all()
    case 'extras': return `unit: u\nentry: web\nsource: { color: red, dot: rate }\naxis: time\n${head(both)}${all()}`
    case 'by-slips':
      return head(both) + gridLevel(100, 50, undefined, 'by: { orders: { rate: x, util: 0.5, p50: -1 }, pings: [1], mail: { rate: 1 }, auth: 5, __proto__: { rate: 1 } }')
        + all(GRID_LOADS.slice(1))
    case 'by-text': return head(both) + gridLevel(100, 50, undefined, 'by: [orders]') + all(GRID_LOADS.slice(1))
    case 'by-empty': return head(both) + gridLevel(100, 50, undefined, 'by: { orders: {}, pings: ~ }') + all(GRID_LOADS.slice(1))
    case 'proto': return head(both) + gridLevel(100, 50, undefined, 'by: { orders: { rate: 1 } }').replace('      db: {', '      __proto__: { util: 0.3 }\n      db: {') + all(GRID_LOADS.slice(1))
    case 'wrong-key': return head(both) + all().replace(/- load: /g, '- at: ')
    default: throw new Error(`no such grid variant: ${variant}`)
  }
}

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
  // A run that adds others: the list, and every way it can be wrong. Whether the runs exist is for checkRuns (see SOURCES below).
  ['adds-good', 'name: Both\nabout: Two at once\nadds: [orders-run, pings-run]\n'],
  ['adds-padded', 'name: Both\nadds: ["  orders-run ", pings-run]\n'],
  ['adds-four', 'name: Four\nadds: [a, b, c, d]\n'],
  ['adds-five', 'name: Five\nadds: [a, b, c, d, e, f]\n'],
  ['adds-one', 'name: One\nadds: [a]\n'],
  ['adds-none', 'name: None\nadds: []\n'],
  ['adds-text', 'name: Text\nadds: a\n'],
  ['adds-map', 'name: Map\nadds: { a: b }\n'],
  ['adds-blank', 'name: Blank\nadds:\n'],
  ['adds-twice', 'name: Twice\nadds: [a, a, b]\n'],
  ['adds-twice-only', 'name: Twice\nadds: [a, a]\n'],
  ['adds-self', 'name: Self\nadds: [adds-self, a, b]\n'],
  ['adds-junk', 'name: Junk\nadds: [a, [x], { y: z }, "", ~, b]\n'],
  ['adds-long', `name: Long\nadds: [a, ${'x'.repeat(300)}]\n`],
  ['adds-long-extra', `name: Long\nadds: [a, b, c, d, ${'y'.repeat(300)}]\n`],
  ['adds-extras', 'name: Extras\nadds: [a, b]\naxis: time\nunit: u\nentry: web\nsource: { color: red }\nsources: {}\nlevels:\n  - load: 1\n  - load: 2\n'],
  ['adds-unnamed', 'adds: [a, b]\n'],
  ['adds-proto', 'name: Proto\nadds: [__proto__, constructor, a]\n'],
  // A run tested together: the grid, and every way it can be wrong.
  ['grid-good', GRID_TEXT('')],
  ['grid-shuffled', GRID_TEXT('shuffled')],
  ['grid-numeric', GRID_TEXT('numeric')],
  ['grid-three', GRID_TEXT('three')],
  ['grid-missing', GRID_TEXT('missing')],
  ['grid-missing-three', GRID_TEXT('missing-three')],
  ['grid-twice', GRID_TEXT('twice')],
  ['grid-extra-source', GRID_TEXT('extra-source')],
  ['grid-lacks-source', GRID_TEXT('lacks-source')],
  ['grid-word', GRID_TEXT('word')],
  ['grid-negative', GRID_TEXT('negative')],
  ['grid-scalar', GRID_TEXT('scalar')],
  ['grid-no-load', GRID_TEXT('no-load')],
  ['grid-load-list', GRID_TEXT('load-list')],
  ['grid-one-load', GRID_TEXT('one-load')],
  ['grid-one-source', GRID_TEXT('one-source')],
  ['grid-four-sources', GRID_TEXT('four-sources')],
  ['grid-bad-id', GRID_TEXT('bad-id')],
  ['grid-sources-list', GRID_TEXT('sources-list')],
  ['grid-source-text', GRID_TEXT('source-text')],
  ['grid-source-blank', GRID_TEXT('source-blank')],
  ['grid-slips', GRID_TEXT('slips')],
  ['grid-colors', GRID_TEXT('colors')],
  ['grid-extras', GRID_TEXT('extras')],
  ['grid-by-slips', GRID_TEXT('by-slips')],
  ['grid-by-text', GRID_TEXT('by-text')],
  ['grid-by-empty', GRID_TEXT('by-empty')],
  ['grid-proto', GRID_TEXT('proto')],
  ['grid-wrong-key', GRID_TEXT('wrong-key')],
  ['by-in-single', 'name: S\nlevels:\n  - load: 1\n    connections:\n      - { from: web, to: db, rate: 1, by: { x: { rate: 1 } } }\n      - { from: orders, to: db, by: ~ }\n  - load: 2\n'],
  ['load-map-in-single', 'name: S\nlevels:\n  - load: { a: 1 }\n  - load: 2\n'],
  ['load-map-in-time', 'name: S\naxis: time\nlevels:\n  - at: { a: 1 }\n  - at: 2\n'],
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

/** A run of one source for the runs below to add: its loads, what db reads at each, and the rate on its lines (one a hundred times busier than a screen can draw). */
function partRun(name: string, unit: string, source: string, loads: number[], util: number[], rate: number, extra = ''): string {
  const levels = loads.map((load, i) => `  - load: ${load}
    overall: { rate: ${rate * (i + 1)}, p50: ${10 * (i + 1)}, p95: ${30 * (i + 1) * (i + 1)}, errors: ${i === 2 ? 0.05 : 0} }
    objects: { db: { util: ${util[i]}, queue: ${i * 2} }, web: { util: ${0.1 * (i + 1)} } }
    connections:
${extra.replaceAll('{i}', String(i)).replaceAll('{rate}', String(rate * (i + 1)))}`).join('')
  return `name: ${name}\nunit: ${unit}\n${source}levels:\n${levels}`
}

const SOURCES: [id: string, text: string][] = [
  ['orders-run', partRun('Customer orders', 'orders/min', 'entry: customer\nsource: { color: blue, dot: rate / 50, size: bytes / 400 }\n', [10, 20, 40], [0.2, 0.4, 0.6], 50,
    '      - { from: customer, to: web, rate: {rate}, p50: 10, bytes: 400 }\n      - { from: orders, to: db, rate: {rate}, p50: 5, bytes: 400, errors: 0.0{i} }\n      - { from: orders, to: gateway, rate: 3, p50: 90 }\n')],
  ['pings-run', partRun('Courier pings', 'pings/s', 'entry: auth\nsource: { color: green, dot: rate / 25 }\n', [5, 10, 20], [0.1, 0.3, 0.7], 25,
    '      - { from: auth, to: db, rate: {rate}, p50: 20, bytes: 100, failure: lost, errors: 0.0{i} }\n      - { from: worker, to: gateway, rate: 2, p50: 90, failure: rejected }\n')],
  ['plain-run', partRun('Plain', 'x/s', '', [1, 2], [0.1, 0.2], 5, '      - { from: orders, to: db, rate: {rate}, p50: 7 }\n')],
  ['busy-run', partRun('Busy', 'b/s', 'source: { color: orange, dot: rate / 50 }\n', [1, 2, 3], [0.1, 0.2, 0.3], 60000, '      - { from: orders, to: db, rate: {rate}, p50: 3, bytes: 100 }\n')],
  ['hot-a', partRun('Hot A', 'a/s', 'source: { color: teal }\n', [1, 2, 3], [0.3, 0.5, 0.7], 5, '      - { from: orders, to: db, rate: {rate}, p50: 5 }\n')],
  ['hot-b', partRun('Hot B', 'b/s', 'source: { color: indigo }\n', [1, 2, 3], [0.2, 0.5, 0.6], 7, '      - { from: auth, to: db, rate: {rate}, p50: 6 }\n')],
  ['same-colour', partRun('Orders again', 'orders/min', 'source: { color: blue }\n', [10, 20], [0.1, 0.2], 5, '      - { from: orders, to: db, rate: {rate}, p50: 5 }\n')],
  ['outage-run', TIMED_TEXT()],
  ['together', 'name: Orders and pings, added\nadds: [orders-run, pings-run]\n'],
  ['three-added', 'name: Three added\nadds: [orders-run, pings-run, plain-run]\n'],
  ['busy-added', 'name: Busy added\nadds: [busy-run, orders-run, pings-run, hot-a]\n'],
  ['hot', 'name: Past full\nadds: [hot-a, hot-b]\n'],
  ['adds-time', 'name: With time\nadds: [orders-run, pings-run, outage-run]\n'],
  ['adds-adder', 'name: Adder of adder\nadds: [together, orders-run, pings-run]\n'],
  ['adds-grid', 'name: With a grid\nadds: [orders-run, grid-good, pings-run]\n'],
  ['adds-ghost', 'name: With a ghost\nadds: [orders-run, ghost, pings-run]\n'],
  ['lonely', 'name: Lonely\nadds: [orders-run, ghost]\n'],
  ['twins', 'name: Twins\nadds: [orders-run, same-colour]\n'],
  ['grid-good', GRID_TEXT('')],
  ['grid-three', GRID_TEXT('three')],
  ['grid-numeric', GRID_TEXT('numeric')],
  ['grid-shuffled', GRID_TEXT('shuffled')],
  ['grid-ghost', GRID_TEXT('').replace('entry: auth', 'entry: ghost')],
  ['grid-missing', GRID_TEXT('missing')],
]

/** The made-up outage of the time runs, kept short for the adders to refuse. */
function TIMED_TEXT(): string {
  return 'name: Outage\naxis: time\nunit: s\nevents:\n  - { at: 1, on: web, state: stopped }\nlevels:\n  - at: 0\n  - at: 2\n'
}

const failure = (e: unknown) => {
  if (e instanceof ParseError) return { error: { file: e.file, line: e.line ?? null, message: e.reason } }
  throw e
}

/** The runs of SOURCES that are played at settings (the others are there for what is said about them, and play like these). */
const PLAYED = ['orders-run', 'together', 'three-added', 'busy-added', 'hot', 'grid-good', 'grid-three', 'grid-numeric']

/** Where a setting is put to the test: every lockstep step, the middle of everything, each dial alone between its first two loads, past the top and under the bottom, and a setting that names nothing. */
function settingsOf(dials: Dial[]): Setting[] {
  const steps = Array.from({ length: lockstepTop(dials) + 1 }, (_, i) => settingAt(dials, lockstepPositions(dials, i)))
  const lowest = settingAt(dials, dials.map(() => 0))
  const highest = settingAt(dials, dials.map(d => d.values.length - 1))
  const out: Setting[] = [...steps, settingAt(dials, dials.map(d => (d.values.length - 1) * 0.3)), {}]
  for (const d of dials) {
    out.push({ ...lowest, [d.id]: (d.values[0] + d.values[1]) / 2 })
    out.push({ ...lowest, [d.id]: d.values[d.values.length - 1] + 5 })
    out.push({ ...highest, [d.id]: d.values[0] - 5 })
  }
  return out
}

/**
 * Runs with several sources, read the way the loader reads a folder (a file that can't be played is left out, then the runs that add others are checked against the rest, and an
 * adder with fewer than two runs it can add is left out too), then played at settings of their dials against the same shop as the folder's: what each dial is, the level at each
 * setting, the traffic and key in each view, the roll-up with what each source carries, and where everything rising together first struggles.
 */
function assembleSources(model: Model) {
  const files = SOURCES.map(([id, text]) => {
    try {
      return { id, text, ...parseRun(id, text) }
    } catch (e) {
      return { id, text, ...failure(e) }
    }
  })
  const runs: Record<string, Run> = {}
  const problems: Problem[] = []
  for (const f of files) {
    if ('error' in f) {
      problems.push({ file: `perf/${f.id}.yaml`, message: f.error.line === null ? f.error.message : `line ${f.error.line}: ${f.error.message}` })
      continue
    }
    runs[f.id] = f.run
    problems.push(...f.problems, ...checkRun(f.id, f.run, model))
  }
  problems.push(...checkRuns(runs))
  for (const id of Object.keys(runs)) if (runs[id].adds !== undefined && dialsOf(runs, id) === undefined) delete runs[id]
  return { files, runs, problems }
}

async function dumpSources(model: Model): Promise<unknown> {
  const { files, runs, problems } = assembleSources(model)
  const views = (id: string) => (id === 'together' || id === 'grid-good' ? [ROOT, 'shop', 'web'] : [ROOT, 'shop'])
  return {
    files,
    loaded: { runs: Object.keys(runs), problems },
    positions: [[[1, 2, 4], -1], [[1, 2, 4], 0], [[1, 2, 4], 0.5], [[1, 2, 4], 1.5], [[1, 2, 4], 2], [[1, 2, 4], 9], [[10, 20], 0.25], [[10, 20], 1]].map(([values, pos]) => ({ values, pos, load: loadOfPosition(values as number[], pos as number) })),
    runs: Object.entries(runs).map(([id, run]) => {
      const found = dialsOf(runs, id)!
      const found_knee = kneeOf(runs, id)
      return {
        id,
        mode: found.mode,
        dials: found.dials,
        lockstep: Array.from({ length: lockstepTop(found.dials) + 1 }, (_, i) => lockstepPositions(found.dials, i)),
        check: checkRun(id, run, model),
        knee: found_knee ?? null,
        text: found_knee ? kneeTextOf(runs, id, found_knee, oid => nameOf(model, oid)) : null,
        settings: (PLAYED.includes(id) ? settingsOf(found.dials) : []).map(setting => {
          const level = levelAt(runs, id, setting)
          return {
            setting,
            level,
            traffic: views(id).map(view => {
              const t = trafficAt(model, runs, id, setting, view)
              return { view, ...t, key: sourceKeyAt(runs, id, t.lines) }
            }),
            data: views(id).map(view => {
              const t = trafficAt(model, runs, id, setting, view, 'data')
              return { view, ...t, key: sourceKeyAt(runs, id, t.lines, 'data') }
            }),
            rolled: views(id).map(view => ({ view, ...rollUpLoad(model, level, view) })),
          }
        }),
      }
    }),
  }
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
        data: views.map(view => ({ view, ...trafficAt(model, runs, id, { '': load }, view, 'data') })),
      })),
      idle: idleOf(run) ?? null,
      rolled: run.levels.flatMap(level => views.map(view => ({ load: level.load, view, ...rollUpLoad(model, level, view) }))),
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
      size: callSize({ [id]: read.run }, id) ?? null,
      amounts: [amountOf({ rate: 10, bytes: 400 }, 'calls', 1000) ?? null, amountOf({ rate: 10, bytes: 400 }, 'data', 1000) ?? null, amountOf({ rate: 10 }, 'data', 1000) ?? null, amountOf({ bytes: 400 }, 'calls', 1000) ?? null],
      loads: loads.map(load => ({
        load,
        level: interpolate(read.run, load),
        traffic: views.map(view => {
          const t = traffic(model, read.run, load, view)
          return { view, ...t, key: sourceKey(read.run, t.lines) ?? null }
        }),
        data: views.map(view => {
          const size = callSize({ [id]: read.run }, id)
          const t = traffic(model, read.run, load, view, 'data', size)
          return { view, ...t, key: sourceKey(read.run, t.lines, 'data', size) ?? null }
        }),
        rolled: views.map(view => ({ view, ...rollUpLoad(model, interpolate(read.run, load), view) })),
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
    sources: await dumpSources(model),
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
const POSITIONS = [-3, -1, -0.5, -0.25, 0, 0.013, 0.25, 0.5, 0.987, 1, 1.2345, 1.5, 2.999, 3, 9]
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
/**
 * The panel's maths for a run with several dials (and for a single run's one): the setting a set of positions makes and back, the opening place, a step, a ramp, the series along the
 * active dial with the others held, the held dials in words, the labels under a dial, the loads either side of a position and what the panel says once.
 */
function dumpDials(model: Model) {
  const { runs } = assembleSources(model)
  const sets = (tops: number[]): number[][] => [
    tops.map(() => 0), tops.map(t => t), tops.map(t => t / 2), tops.map((t, i) => (i % 2 === 0 ? 0.5 : t - 0.25)), tops.map(() => -3), tops.map(() => 99), tops.map((t, i) => Math.min(t, i + 1)),
  ]
  return ['orders-run', 'together', 'three-added', 'grid-good', 'grid-three', 'grid-numeric'].map(id => {
    const { dials, mode } = dialsOf(runs, id)!
    const knee = kneeOf(runs, id)
    return {
      id,
      mode,
      label: modeLabel(mode) ?? null,
      over: [undefined, 0.5, 1, 1.3].map(util => ({ util: util ?? null, text: overText(mode, util) ?? null })),
      opening: openingPositions(dials, knee),
      openingNone: openingPositions(dials),
      dials: dials.map(d => ({
        id: d.id, top: dialTop(d), ticks: dialTicks(d), few: dialTicks(d, 2),
        brackets: [-1, 0, 0.25, 1, 1.5, dialTop(d), 99].map(pos => ({ pos, ...bracketOf(d, pos) })),
        slide: [-1, 0.4, 0.5, 1.6, 99].map(value => ({ value, to: slideDial(d, value) })),
      })),
      sets: sets(dials.map(dialTop)).map(positions => {
        const setting = settingOf(dials, positions)
        return {
          positions,
          setting,
          back: positionsOf(dials, setting),
          actives: dials.map((_, active) => {
            const along = activeSeries(runs, id, dials, positions, active)
            return {
              active,
              step: [stepActive(dials, positions, active, 1), stepActive(dials, positions, active, -1)],
              edge: [edgeActive(dials, positions, active, 'start'), edgeActive(dials, positions, active, 'end')],
              place: [placeActive(dials, positions, active, 1.5), placeActive(dials, positions, active, -2), placeActive(dials, positions, active, 99)],
              ramp: [0, 16, 1000, RAMP_MS / 2, RAMP_MS, RAMP_MS * 3].map(ms => rampActive(dials, positions, active, ms)),
              from: rampFromActive(dials, positions, active),
              held: heldText(dials, positions, active),
              loads: along.map(l => l.loads ?? null),
              util: boxSeriesIn(model, along, 'shop', 'db', 'util').map(v => v ?? null),
              rate: lineSeriesIn(model, along, 'shop', 'web', 'db', 'rate').map(v => v ?? null),
              wide: lineSeriesIn(model, along, ROOT, 'shop', 'gateway', 'rate').map(v => v ?? null),
              p95: along.map(l => l.overall.p95 ?? null),
            }
          }),
        }
      }),
    }
  })
}

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
    dials: dumpDials(model),
    steps: [[0, 1], [0, -1], [1, 1], [1, -1], [1.5, 1], [1.5, -1], [1 + 1e-9, -1], [1 - 1e-9, 1], [2, 1], [-1, 1], [99, -1]].map(([pos, direction]) => ({ pos, direction, to: stepFrom(pos, direction as 1 | -1) })),
    words: NUMBERS.map(n => ({ n, ms: fmtMs(n), pct: fmtPct(n), rate: fmtRate(n), bytes: fmtBytes(n), load: fmtLoad(n, 'req/s') })),
    marks: MARKS.map(lines => ({ lines, marks: failureMarks(lines) })),
    colours: COLOURS.map(color => ({ color: color ?? null, css: sourceCss(color) ?? null })),
    metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, log: m.log ?? false, max: m.max ?? null, shown: [0, 0.4, 0.93, 40.4, 2500].map(v => m.show(v)) })),
    keys: { box: BOX_KEYS, line: LINE_KEYS },
    positions: Object.entries(runs).map(([id, run]) => ({
      id,
      top: top(run),
      at: POSITIONS.map(pos => ({
        pos, clamp: clampPos(run, pos), load: loadAt(run, pos), tested: isTested(pos), snap: snap(run, pos), from: rampFrom(run, pos), note: loadNote(run, pos), slide: slidePos(run, pos),
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
