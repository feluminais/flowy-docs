import { linearInRate } from '../formula.ts'
import { STATE_LABELS } from '../states.ts'
import { dialsOf } from './dials.ts'
import { callSize } from './measure.ts'
import type { Measure } from './measure.ts'
import { formulaOf } from './sources.ts'
import type { Knee, LineTraffic, Run, RunEvent, Source } from './types.ts'
import { own, round2 } from './util.ts'

/** The words of the Performance tab: events, where a run first struggles, the scale and the key. */

/** What an event says: its own text, else the shape and the state the way a person reads them ("Stripe: Stopped"). `nameOf` turns a shape id into the name a reader sees. */
export const eventText = (e: RunEvent, nameOf: (id: string) => string): string => (e.text !== '' ? e.text : `${nameOf(e.on)}: ${STATE_LABELS[e.state]}`)

const pct = (n: number) => `${Math.round(n * 100)}%`

/** What gives out, in words: "Fleet DB at 90% of capacity", "the slowest 5% of calls go from 100 ms to 420 ms". */
function struggleText(k: Knee, nameOf: (id: string) => string): string {
  if ('by' in k) return `${nameOf(k.by.id)} ${k.by.kind === 'util' ? `at ${pct(k.by.share)} of capacity` : `failing ${pct(k.by.share)} of calls`}`
  return `the slowest 5% of calls go from ${Math.round(k.latency.from)} ms to ${Math.round(k.latency.to)} ms`
}

/** The sentence under the Performance tab's strip, for both readers. `nameOf` turns an object id into the name a reader sees. */
export function kneeText(run: Run, k: Knee, nameOf: (id: string) => string): string {
  return `First struggles at ${k.load} ${run.unit}: ${struggleText(k, nameOf)}`
}

/** The number in a scale, as short as it reads: 50, 0.5, 12.5, with the float noise of a division (3.0000000000000004) rounded off. */
const plain = (n: number): string => String(Number(n.toPrecision(6)))

/** A data rate as a person reads it: 400 B/s, 2 KB/s, 1.5 MB/s. */
function dataRate(bytes: number): string {
  if (bytes >= 1e6) return `${plain(bytes / 1e6)} MB/s`
  if (bytes >= 1e3) return `${plain(bytes / 1e3)} KB/s`
  return `${plain(bytes)} B/s`
}

/**
 * "1 dot = 50 calls/s" for a run whose `dot` formula is a constant times the rate and nothing else; undefined for any other, because a scale in
 * words that is not true for every line is worse than none. Also undefined for a scale nobody reads (under a thousandth of a call or over a billion).
 * Under Data it is the same dot in data: "1 dot = 20 KB/s", the calls times the size of a call that Data counts against (`size`, see callSize).
 */
export function scaleText(run: Run, measure: Measure = 'calls', size?: number): string | undefined {
  return sourceScale(run.source, measure, size)
}

/** The scale in words of one source (see scaleText). */
function sourceScale(source: Source | undefined, measure: Measure, size: number | undefined): string | undefined {
  const dot = source?.dot ? formulaOf(source.dot) : undefined
  const k = dot ? linearInRate(dot) : undefined
  if (k === undefined) return undefined
  const calls = 1 / k
  if (!(calls >= 0.001 && calls < 1e9)) return undefined
  if (measure === 'calls') return `1 dot = ${plain(calls)} calls/s`
  return size === undefined ? undefined : `1 dot = ${dataRate(calls * size)}`
}

/**
 * The pieces the Performance key draws for a run's source, from the lines on screen now: its name and the colour of its dots; the scale in words when
 * the formula is a plain ratio of the rate and a line follows it; whether any dot is bigger or smaller than usual; whether any line is scaled down to
 * fit. Undefined when the run sets no source or no line is on screen, so the key shows only what the picture shows.
 */
export function sourceKey(all: Run, shown: LineTraffic[], measure: Measure = 'calls', size?: number): { name: string; color?: string; scale?: string; bigger: boolean; scaledDown: boolean } | undefined {
  const [run, lines] = [all, shown.filter(l => l.bare !== true)] // a line with no numbers belongs to no source
  if (!run.source || lines.length === 0) return undefined
  const scale = lines.some(l => l.dots !== undefined) ? scaleText(run, measure, size) : undefined
  return {
    name: run.name,
    ...(run.source.color === undefined ? {} : { color: run.source.color }),
    ...(scale === undefined ? {} : { scale }),
    bigger: lines.some(l => l.radius !== undefined),
    scaledDown: lines.some(l => l.capped === true),
  }
}

/** "A, B and C". */
const joinAnd = (items: string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)

/**
 * The knee in words. One source: kneeText, unchanged. Several: where each source stood, then what gave out ("First struggles with Customer orders at 300 orders/min and Courier
 * pings at 100 pings/s: Fleet DB at 90% of capacity"). `nameOf` turns a shape id into the name a reader sees.
 */
export function kneeTextOf(runs: Record<string, Run>, id: string, k: Knee, nameOf: (id: string) => string): string {
  const found = dialsOf(runs, id)
  if (!found || found.mode === 'single') return kneeText(runs[id], k, nameOf)
  const stood = found.dials.map(d => `${d.name} at ${round2(own(k.setting, d.id) ?? d.values[0])} ${d.unit}`)
  return `First struggles with ${joinAnd(stood)}: ${struggleText(k, nameOf)}`
}

/** A source in the key: its name, the colour of its dots, its scale in words when its formula is a plain ratio of the rate and a line follows it, and whether any dot is bigger or smaller than usual. */
export type KeyedSource = { id: string; name: string; color?: string; scale?: string; bigger: boolean }

/**
 * The pieces the Performance key draws for the sources, from the lines on screen now: a swatch and a name for each source that has a line, its scale and size where it has them, whether
 * any line is scaled down to fit, and whether a line is drawn in the neutral colour (a line the run doesn't split by source). For one source it is what sourceKey says.
 */
export function sourceKeyAt(runs: Record<string, Run>, id: string, lines: LineTraffic[], measure: Measure = 'calls'): { sources: KeyedSource[]; scaledDown: boolean; other: boolean } {
  const found = dialsOf(runs, id)
  if (!found) return { sources: [], scaledDown: false, other: false }
  if (found.mode === 'single') {
    const k = sourceKey(runs[id], lines, measure, measure === 'calls' ? undefined : callSize(runs, id))
    if (!k) return { sources: [], scaledDown: false, other: false }
    return { sources: [{ id: '', name: k.name, ...(k.color === undefined ? {} : { color: k.color }), ...(k.scale === undefined ? {} : { scale: k.scale }), bigger: k.bigger }], scaledDown: k.scaledDown, other: false }
  }
  const size = measure === 'calls' ? undefined : callSize(runs, id)
  lines = lines.filter(l => l.bare !== true)
  const sources = found.dials.flatMap((d): KeyedSource[] => {
    const mine = lines.filter(l => l.source === d.id)
    if (mine.length === 0) return []
    const scale = mine.some(l => l.dots !== undefined) ? sourceScale(d.source, measure, size) : undefined
    return [{ id: d.id, name: d.name, color: d.color, ...(scale === undefined ? {} : { scale }), bigger: mine.some(l => l.radius !== undefined) }]
  })
  return { sources, scaledDown: lines.some(l => l.capped === true), other: lines.some(l => l.source === undefined) }
}
