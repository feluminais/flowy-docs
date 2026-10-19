import { performance } from 'node:perf_hooks'
import { Busy } from './stats.ts'

/** A first-in first-out queue with a fixed number of workers, so jobs wait when they are all busy. */
export class JobQueue {
  readonly busy = new Busy()
  readonly concurrency: number
  private items: { id: number; at: number }[] = []
  private running = 0
  private handle: (id: number, waitedMs: number) => Promise<void>

  constructor(concurrency: number, handle: (id: number, waitedMs: number) => Promise<void>) {
    this.concurrency = concurrency
    this.handle = handle
  }

  /** Jobs waiting for a worker. */
  get depth(): number {
    return this.items.length
  }

  push(id: number): void {
    this.items.push({ id, at: performance.now() })
    this.pump()
  }

  private pump(): void {
    while (this.running < this.concurrency && this.items.length > 0) {
      const job = this.items.shift()!
      this.running++
      this.busy.enter()
      this.handle(job.id, performance.now() - job.at)
        .catch(() => {}) // a job that fails says so itself; the queue carries on
        .finally(() => {
          this.running--
          this.busy.leave()
          this.pump()
        })
    }
  }
}

/** A fixed number of slots: `run` waits for a free one, so work beyond them queues. */
export class Slots {
  readonly busy = new Busy()
  readonly size: number
  private free: number
  private waiting: (() => void)[] = []
  constructor(size: number) {
    this.size = size
    this.free = size
  }
  /** Callers waiting for a slot. */
  get queued(): number {
    return this.waiting.length
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--
    else await new Promise<void>(resolve => this.waiting.push(resolve))
    this.busy.enter()
    try {
      return await fn()
    } finally {
      this.busy.leave()
      const next = this.waiting.shift()
      if (next) next() // the slot goes straight to the next in line
      else this.free++
    }
  }
}
