import { parse } from 'yaml'
import { compareOf } from '../../src/core/compare.ts'
import { setRunCompare } from '../../src/core/perf/comparetag.ts'
import type { Level, Metrics } from '../../src/core/perf/types.ts'

/** A number as short as it can be at `digits` places: 12.30 is 12.3, 0.0004 at 3 places is 0. */
const num = (n: number, digits: number): string => String(Number(n.toFixed(digits)))

const ORDER: (keyof Metrics)[] = ['util', 'queue', 'rate', 'bytes', 'p50', 'p95', 'errors']
const DIGITS: Record<keyof Metrics, number> = { util: 3, queue: 0, rate: 1, bytes: 0, p50: 2, p95: 2, errors: 4 }

const flow = (m: Metrics, first = ''): string => {
  const parts = ORDER.filter(k => m[k] !== undefined).map(k => `${k}: ${num(m[k]!, DIGITS[k])}`)
  return `{ ${[first, ...parts].filter(Boolean).join(', ')} }`
}

export type RunInfo = { name: string; about: string; unit: string; entry: string }

/**
 * A run as the text of a `flowy/perf/<id>.yaml` file, one object or connection to a line. `previous` is the text of the file this one replaces:
 * its `compare` tag is the one thing a person sets on a run, so it stays.
 */
export function formatRun(info: RunInfo, levels: Level[], previous?: string): string {
  const lines = [`name: ${JSON.stringify(info.name)}`, `about: ${JSON.stringify(info.about)}`, `unit: ${info.unit}`, `entry: ${info.entry}`, 'levels:']
  for (const level of levels) {
    lines.push(`  - load: ${level.load}`)
    if (Object.keys(level.overall).length > 0) lines.push(`    overall: ${flow(level.overall)}`)
    const objects = Object.entries(level.objects)
    if (objects.length > 0) {
      lines.push('    objects:')
      for (const [id, m] of objects) lines.push(`      ${id}: ${flow(m)}`)
    }
    if (level.connections.length > 0) {
      lines.push('    connections:')
      for (const { from, to, ...m } of level.connections) lines.push(`      - ${flow(m, `from: ${from}, to: ${to}`)}`)
    }
  }
  const text = `${lines.join('\n')}\n`
  const tag = previous === undefined ? undefined : previousTag(previous)
  return tag === undefined ? text : setRunCompare(text, tag)
}

/** The tag the replaced file had. A file that is not valid YAML (a conflict marker, a half edit) has none: the run just measured is still worth writing. */
function previousTag(previous: string): ReturnType<typeof compareOf> {
  try {
    return compareOf((parse(previous, { schema: 'failsafe' }) as { compare?: unknown } | null)?.compare)
  } catch {
    return undefined
  }
}
