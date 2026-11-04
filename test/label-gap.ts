import type { Spot } from '../ui/src/labels.ts'

type Point = { x: number; y: number }

/** How far a label box is from a polyline: 0 where the line passes through it. The line is walked in steps of a pixel, which is enough for the few pixels the tests ask about. */
export function gapToLine(label: { x: number; y: number; width: number; height: number }, points: readonly Point[]): number {
  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]]
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)))
    for (let k = 0; k <= steps; k++) {
      const p = { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }
      const dx = Math.max(label.x - p.x, 0, p.x - (label.x + label.width))
      const dy = Math.max(label.y - p.y, 0, p.y - (label.y + label.height))
      best = Math.min(best, Math.hypot(dx, dy))
    }
  }
  return best
}

/** The box placeLabels gives a label of `chars` characters and `extra` pixels besides (6.2 a character, 10 of padding, 18 high) centred on `at`. */
function boxOf(at: Spot, chars: number, extra: number) {
  const width = chars * 6.2 + 10 + extra
  return { x: at.x - width / 2, y: at.y - 9, width, height: 18 }
}

/** How far the label of `chars` characters (with its sample) at `spot` is from the line it labels: 0 on it, a few pixels beside it. */
export const labelGap = (spot: Spot, chars: number, extra: number, points: readonly Point[]): number => gapToLine(boxOf(spot, chars, extra), points)
