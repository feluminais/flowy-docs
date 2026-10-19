/** A least-recently-used cache holding at most `capacity` entries. */
export class Lru<V> {
  private map = new Map<number, V>()
  readonly capacity: number
  constructor(capacity: number) {
    this.capacity = capacity
  }
  get size(): number {
    return this.map.size
  }
  get(key: number): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }
  set(key: number, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) this.map.delete(this.map.keys().next().value!)
  }
}
