/** How fast a flow can play: half, normal and double speed. */
export const SPEEDS = [0.5, 1, 2] as const
export type Speed = (typeof SPEEDS)[number]

/** The speed after `speed`, round to the first after the last (the S key). */
export const nextOf = (speed: Speed): Speed => SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]

/** A wait of `after`: how much running time it still needs, and the timer standing in for it while the clock runs. */
type Wait = { left: number; fn: () => void; timer?: ReturnType<typeof setTimeout>; armed: number }

/**
 * The time of a flow player: how far into the stop on show it is, in milliseconds of player time. It runs at a speed, stops still while paused
 * and can be set to any moment, so whatever is drawn from it (a step's motion, the rest between steps) pauses, scrubs and speeds up together.
 * One belongs to each player: the reader's, and each pane of a comparison.
 */
export class PlayerClock {
  #now: () => number
  #base = 0 // player time at the last change
  #since: number // the wall time of that change
  #paused = false
  #rate: Speed = 1
  #totals = new Map<symbol, number>()
  #key = '' // the step (and replay) the clock is timing
  #pending: { fraction: number; key: string } | undefined // a seek waiting for its step to begin and say how long it is
  #landed: number | undefined // the fraction a waiting seek landed at: a longer motion of the same stop that says so later moves it
  #waits = new Set<Wait>()
  #heard = new Set<() => void>()
  #jumps = 0

  constructor(now: () => number = () => performance.now()) {
    this.#now = now
    this.#since = now()
  }

  get paused(): boolean {
    return this.#paused
  }

  get rate(): Speed {
    return this.#rate
  }

  /** How long the stop's motion lasts: its longest motion, or 0 while none has said. */
  get length(): number {
    let longest = 0
    for (const total of this.#totals.values()) longest = Math.max(longest, total)
    return longest
  }

  /** How many times the clock has jumped (a seek, a restart): a listener that compares it knows a jump from a pause, a play or a speed. */
  get jumps(): number {
    return this.#jumps
  }

  elapsed(): number {
    return this.#paused ? this.#base : this.#base + (this.#now() - this.#since) * this.#rate
  }

  /**
   * The step (and replay) now on show, by its key: a new one restarts the clock, the same one again does nothing. The step's motions and the player both say it,
   * whichever comes first, so the clock is right before anything is drawn from it. A seek meant for this step stays to land on it.
   */
  begin(key: string): void {
    if (key === this.#key) return
    this.#key = key
    const kept = this.#pending?.key === key ? this.#pending : undefined
    this.restart()
    this.#pending = kept
  }

  /** A new stop, or the same one again: it begins now. Paused stays paused, at its first moment. */
  restart(): void {
    this.#pending = undefined
    this.#landed = undefined
    this.#set(0)
  }

  pause(): void {
    if (this.#paused) return
    this.#mark(this.elapsed())
    this.#paused = true
    for (const w of this.#waits) this.#hold(w)
    this.#tell()
  }

  play(): void {
    if (!this.#paused) return
    this.#since = this.#now()
    this.#paused = false
    for (const w of this.#waits) this.#arm(w)
    this.#tell()
  }

  setRate(rate: Speed): void {
    this.#mark(this.elapsed())
    for (const w of this.#waits) this.#hold(w)
    this.#rate = rate
    if (!this.#paused) for (const w of this.#waits) this.#arm(w)
    this.#tell()
  }

  /** Goes to a moment of the stop, kept inside its motion once its length is known. */
  seek(ms: number): void {
    this.#pending = undefined
    this.#landed = undefined
    const length = this.length
    this.#set(Math.max(0, length > 0 ? Math.min(ms, length) : ms))
  }

  /**
   * Goes to a fraction of the way through the stop: now if it is the step on show and its length is known, else as soon as `key`'s step has begun and a motion
   * of it says how long it is (a drag onto a step that has not been drawn yet).
   */
  seekFraction(fraction: number, key = this.#key): void {
    if (key === this.#key && this.length > 0) this.seek(fraction * this.length)
    else this.#pending = { fraction, key }
  }

  /** A motion of this stop lasts `total`; the result takes it back (the motion is gone). */
  declare(total: number): () => void {
    const key = Symbol('motion')
    this.#totals.set(key, total)
    const fraction = this.#pending?.key === this.#key ? this.#pending.fraction : this.#landed
    if (fraction !== undefined && this.length > 0) {
      this.seek(fraction * this.length)
      this.#landed = fraction // the motions of a fan-out say how long they are one by one: the moment follows the longest
    } else this.#tell()
    return () => {
      this.#totals.delete(key)
    }
  }

  /** Calls `fn` once `ms` of player time have run: a pause holds it, the speed hurries or slows it, and a seek leaves it be. The result cancels it. */
  after(ms: number, fn: () => void): () => void {
    const wait: Wait = { left: ms, fn, armed: 0 }
    this.#waits.add(wait)
    if (!this.#paused) this.#arm(wait)
    return () => {
      clearTimeout(wait.timer)
      this.#waits.delete(wait)
    }
  }

  /** Hears every change: a pause, a play, a speed, a seek, a restart, a new motion. The result stops it. */
  subscribe(fn: () => void): () => void {
    this.#heard.add(fn)
    return () => {
      this.#heard.delete(fn)
    }
  }

  /** A jump to a moment: the only change that moves the stop's time. */
  #set(at: number): void {
    this.#mark(at)
    this.#jumps++
    this.#tell()
  }

  #mark(at: number): void {
    this.#base = at
    this.#since = this.#now()
  }

  #arm(w: Wait): void {
    w.armed = this.#now()
    w.timer = setTimeout(() => {
      this.#waits.delete(w)
      w.fn()
    }, Math.max(0, w.left / this.#rate))
  }

  /** Stops a wait's timer and keeps what is left of it. */
  #hold(w: Wait): void {
    if (w.timer === undefined) return
    clearTimeout(w.timer)
    w.timer = undefined
    w.left -= (this.#now() - w.armed) * this.#rate
  }

  #tell(): void {
    for (const fn of [...this.#heard]) fn()
  }
}
