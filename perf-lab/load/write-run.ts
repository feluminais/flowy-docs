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

/** A run as the text of a `flowy/perf/<id>.yaml` file, one object or connection to a line. */
export function formatRun(info: RunInfo, levels: Level[]): string {
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
  return `${lines.join('\n')}\n`
}
