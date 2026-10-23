import { getObject, ROOT } from '../model.ts'
import type { Model } from '../model.ts'
import { chain, placeEnds } from '../views.ts'
import type { Failure, Level, Metrics, Pair } from './types.ts'
import { add, defined, either, hasConnection, meanBytes, newMean, put, takeBytes } from './util.ts'
import type { Mean } from './util.ts'

/** Rolling a level up into what one view draws. */

/**
 * A level as one view draws it. Each object takes the worst of what it holds and of itself (highest util and errors,
 * queues added; if a run measures both a shape and what is inside it, the queue counts twice, so measure one). Each
 * line the view draws takes the connections that land on it: rates added, worst latency, worst errors. A connection
 * the model doesn't have is left out. Objects are the same in every view; lines depend on `view`.
 */
export function rollUpLoad(model: Model, level: Level, view: string): { objects: Record<string, Metrics>; lines: Pair[] } {
  let byLevel = rolled.get(model)
  if (!byLevel) rolled.set(model, (byLevel = new WeakMap()))
  let byView = byLevel.get(level)
  if (!byView) byLevel.set(level, (byView = new Map()))
  let done = byView.get(view)
  if (!done) byView.set(view, (done = rollUp(model, level, view)))
  return done
}

/** What rollUpLoad answered, by model, level and view: the tab asks for the same level of a tested run again on every render, and a model or a level never changes once loaded. Callers only read the answer. */
const rolled = new WeakMap<Model, WeakMap<Level, Map<string, { objects: Record<string, Metrics>; lines: Pair[] }>>>()

function rollUp(model: Model, level: Level, view: string): { objects: Record<string, Metrics>; lines: Pair[] } {
  const objects: Record<string, Metrics> = {}
  for (const [id, m] of Object.entries(level.objects)) {
    if (!getObject(model, id)) continue
    for (const holder of chain(model, id)) {
      if (holder === ROOT) continue
      const so = Object.hasOwn(objects, holder) ? objects[holder] : {}
      put(objects, holder, defined({ util: either(so.util, m.util, Math.max), errors: either(so.errors, m.errors, Math.max), queue: either(so.queue, m.queue, add) }))
    }
  }

  const lines = new Map<string, Pair>()
  const sizes = new Map<string, Sizes>()
  for (const c of level.connections) {
    if (!hasConnection(model, c.from, c.to)) continue
    const ends = placeEnds(model, view, c.from, c.to)
    if (!ends) continue
    const key = JSON.stringify(ends)
    const so = lines.get(key)
    const size: Sizes = sizes.get(key) ?? { ...newMean(), failures: [], by: new Map() }
    sizes.set(key, size)
    takeBytes(size, c)
    // What each source carries on the line is rolled up the same way, source by source.
    for (const [sid, m] of Object.entries(c.by ?? {})) {
      const share = size.by.get(sid) ?? newShare()
      size.by.set(sid, share)
      share.rate = either(share.rate, m.rate, add)
      share.p50 = either(share.p50, m.p50, Math.max)
      share.errors = either(share.errors, m.errors, Math.max)
      takeBytes(share, { bytes: m.bytes, rate: m.rate })
    }
    if (c.failure !== undefined && !size.failures.includes(c.failure)) size.failures.push(c.failure)
    lines.set(key, {
      from: ends[0], to: ends[1],
      ...defined({ rate: either(so?.rate, c.rate, add), p50: either(so?.p50, c.p50, Math.max), p95: either(so?.p95, c.p95, Math.max), errors: either(so?.errors, c.errors, Math.max) }),
    })
  }
  return { objects, lines: [...lines].map(([key, line]) => withSizes(line, sizes.get(key)!)) }
}

/** What one source carries on a line, as rollUpLoad collects it from the connections that land there. */
type Share = Mean & { rate?: number; p50?: number; errors?: number }
const newShare = (): Share => newMean()

/** What the connections that land on one line say about the size of a call, how its failing share fails and what each source carries, as rollUpLoad collects them. */
type Sizes = Mean & { failures: Failure[]; by: Map<string, Share> }

/**
 * A rolled-up line with its size of a call and how it fails. Bytes is the mean of the connections that give one, weighted by their rates
 * (a connection with no rate has no weight; with no rates at all it is the plain mean). The failure style is the one the connections that name one
 * agree on; if they differ there is none, and a connection that names none doesn't veto. What each source carries (`by`) is put together the same way.
 */
function withSizes(line: Pair, size: Sizes): Pair {
  const { from, to, rate, p50, p95, errors } = line
  const by: Record<string, Metrics> = {}
  for (const [sid, s] of size.by) {
    const m = defined({ rate: s.rate, bytes: meanBytes(s), p50: s.p50, errors: s.errors })
    if (Object.keys(m).length > 0) put(by, sid, m)
  }
  return {
    from, to, ...defined({ rate, bytes: meanBytes(size), p50, p95, errors }),
    ...(size.failures.length === 1 ? { failure: size.failures[0] } : {}), ...(Object.keys(by).length > 0 ? { by } : {}),
  }
}
