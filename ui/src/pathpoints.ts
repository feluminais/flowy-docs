/**
 * A line as points. The SVG path React Flow writes for a line (M, L, C and Q only) is flattened once into a polyline with the length
 * up to each point, so a particle's place at any fraction of the way is a lookup and a blend. `getPointAtLength` does the same
 * from the browser but costs about 28 µs a call, which is too slow for hundreds of particles a frame. No DOM in here.
 */
export type Polyline = { xs: number[]; ys: number[]; at: number[]; total: number }

const CURVE_STEPS = 16

/** The SVG path as a polyline. Anything it doesn't understand is skipped, and an empty path is a point at the origin. */
export function flatten(d: string): Polyline {
  const tokens = d.match(/[MLCQ]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []
  const xs: number[] = []
  const ys: number[] = []
  const push = (x: number, y: number) => {
    xs.push(x)
    ys.push(y)
  }
  let i = 0
  const num = () => Number(tokens[i++])
  while (i < tokens.length) {
    const command = tokens[i++].toUpperCase()
    if (command === 'M' || command === 'L') push(num(), num())
    else if (command === 'C' || command === 'Q') {
      const control = command === 'C' ? 2 : 1
      const [x0, y0] = [xs[xs.length - 1] ?? 0, ys[ys.length - 1] ?? 0]
      const points = Array.from({ length: control + 1 }, () => [num(), num()] as const)
      const [x3, y3] = points[control]
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS
        const u = 1 - t
        if (command === 'C') {
          const [[x1, y1], [x2, y2]] = points
          push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3)
        } else {
          const [[x1, y1]] = points
          push(u * u * x0 + 2 * u * t * x1 + t * t * x3, u * u * y0 + 2 * u * t * y1 + t * t * y3)
        }
      }
    }
  }
  if (xs.length === 0) push(0, 0)
  const at = [0]
  for (let k = 1; k < xs.length; k++) at.push(at[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]))
  return { xs, ys, at, total: at[at.length - 1] }
}

/**
 * The line with a straight run added before its start and after its end, each on along the way the line runs there: where a particle goes into a shape
 * that opens, or comes out of one. 0 adds nothing, and a line with no length has no way to run on, so it comes back as it was.
 */
export function extend(line: Polyline, before: number, after: number): Polyline {
  const last = line.xs.length - 1
  if (last === 0 || line.total === 0 || (before <= 0 && after <= 0)) return line
  // The way out of the line at an end: from the nearest point that is not on the end itself, to the end.
  const heading = (end: number, step: 1 | -1): [number, number] => {
    for (let i = end + step; i >= 0 && i <= last; i += step) {
      const length = Math.hypot(line.xs[end] - line.xs[i], line.ys[end] - line.ys[i])
      if (length > 0) return [(line.xs[end] - line.xs[i]) / length, (line.ys[end] - line.ys[i]) / length]
    }
    return [0, 0]
  }
  const xs = [...line.xs]
  const ys = [...line.ys]
  if (before > 0) {
    const [dx, dy] = heading(0, 1)
    xs.unshift(xs[0] + dx * before)
    ys.unshift(ys[0] + dy * before)
  }
  if (after > 0) {
    const [dx, dy] = heading(last, -1)
    xs.push(line.xs[last] + dx * after)
    ys.push(line.ys[last] + dy * after)
  }
  const at = [0]
  for (let k = 1; k < xs.length; k++) at.push(at[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]))
  return { xs, ys, at, total: at[at.length - 1] }
}

/** The point `s` of the way along (0 at the start, 1 at the end; outside that it stops at the ends). */
export function pointAt(line: Polyline, s: number): [number, number] {
  const last = line.xs.length - 1
  if (last === 0 || line.total === 0) return [line.xs[0], line.ys[0]]
  const length = Math.min(1, Math.max(0, s)) * line.total
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (line.at[mid] <= length) lo = mid
    else hi = mid
  }
  const span = line.at[hi] - line.at[lo]
  const f = span === 0 ? 0 : (length - line.at[lo]) / span
  return [line.xs[lo] + (line.xs[hi] - line.xs[lo]) * f, line.ys[lo] + (line.ys[hi] - line.ys[lo]) * f]
}
