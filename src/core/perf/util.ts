import type { Dial, Metrics, Setting } from './types.ts'

/** Small helpers the other modules of perf/ share. */

export const OBJECT_KEYS = ['util', 'queue', 'errors'] as const
export const EDGE_KEYS = ['rate', 'bytes', 'p50', 'p95', 'errors'] as const
/** The numbers a source may give for one line (`by`). */
export const BY_KEYS = ['rate', 'bytes', 'p50', 'errors'] as const

/** How much of a name a problem quotes, so a hostile key doesn't fill the problem list. */
const QUOTED = 40
export const brief = (text: string): string => (text.length > QUOTED ? `${text.slice(0, QUOTED)}…` : text)

/** Sets an own property, so an id like "__proto__" is data and never the prototype. */
export function put<T>(target: Record<string, T>, key: string, value: T) {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
}

/** One of two numbers when only one exists, else `f` of both. */
export const either = (x: number | undefined, y: number | undefined, f: (a: number, b: number) => number): number | undefined =>
  x === undefined ? y : y === undefined ? x : f(x, y)
export const add = (a: number, b: number) => a + b

/** `m` without the keys that have no number. */
export const defined = (m: Metrics): Metrics => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== undefined))

/** The sizes of calls seen so far, for a mean that is weighted by rate (`weighted` over `weight`) or, with no rates, plain (`sum` over `n`). */
export type Mean = { weighted: number; weight: number; sum: number; n: number }
export const newMean = (): Mean => ({ weighted: 0, weight: 0, sum: 0, n: 0 })
/** The size of a call a connection gives, if it gives one, counted into `mean`; the rate it gives is its weight. */
export function takeBytes(mean: Mean, c: { bytes?: number; rate?: number }) {
  if (c.bytes === undefined) return
  mean.sum += c.bytes
  mean.n++
  if (c.rate !== undefined) {
    mean.weighted += c.bytes * c.rate
    mean.weight += c.rate
  }
}
/** The mean size of a call: weighted by rate (a connection with no rate has no weight); with no rates at all it is the plain mean; none given is none. */
export const meanBytes = (mean: Mean): number | undefined => {
  const v = mean.weight > 0 ? mean.weighted / mean.weight : mean.n > 0 ? mean.sum / mean.n : undefined
  return v !== undefined && Number.isFinite(v) ? v : undefined // an overflowing weighted sum is no number, not Infinity
}

export const round2 = (n: number) => Math.round(n * 100) / 100

export const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined => (record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined)
/** The load a setting gives a dial; a dial it doesn't name is not a number. */
export const settingFor = (setting: Setting, id: string): number => (Object.hasOwn(setting, id) ? setting[id] : Number.NaN)
/** A load kept inside a dial's tested range, as interpolate keeps it: nothing is extrapolated, and one that isn't a number is the lowest. */
export const keep = (d: Dial, x: number): number => (Number.isFinite(x) ? Math.min(d.values[d.values.length - 1], Math.max(d.values[0], x)) : d.values[0])
