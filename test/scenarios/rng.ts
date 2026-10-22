/** A small seeded random source, so a scenario that fails can be played again from its seed alone. */
export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** A number from 0 up to, not including, 1 (mulberry32). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** A whole number from 0 up to, not including, `n`. */
  int(n: number): number {
    return Math.floor(this.next() * n)
  }

  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }

  /** Up to `n` different items, in a random order. */
  some<T>(items: readonly T[], n: number): T[] {
    const left = [...items]
    const out: T[] = []
    while (out.length < n && left.length > 0) out.push(left.splice(this.int(left.length), 1)[0])
    return out
  }
}
