import { createContext } from 'react'
import { partOf } from '../../src/core/animation.ts'
import type { Beat } from '../../src/core/animation.ts'
import { litLanes, partingFor, poseAt } from '../../src/core/lanes.ts'
import type { Parting } from '../../src/core/lanes.ts'
import type { Strand } from '../../src/core/views.ts'
import type { PlayerClock } from './clock.ts'

/**
 * How far the lines of each pair are parted around the lit one while a flow plays, drawn from the player's clock. Where a project draws a line for each connection, a step that
 * rides one line of a pair of several opens the others away from it (src/core/lanes.ts: Parting, poseAt). The lines of the pair ask this store how lit each of their lanes is,
 * and the store answers with `poseAt` of the clock, so a pause holds the pose, a scrub sets it and the speed hurries it, the way the step's motion does.
 *
 * A new stop hands the store a plan (`set`): for each pair, which lanes it lights, and when its `part` beat starts. The store starts from the pose each pair is in at that moment,
 * so a stop reached in the middle of another's change goes on from there with no jump. While a pair is changing and the clock runs it asks for frames; at rest it asks for none.
 * The value of a lane is cut to `STEPS` steps, which is what the lane store keeps a path for, so a change is a handful of paths made once and not one for each frame.
 */

/** What a stop asks of a pair: how lit each of its lanes should be once it has settled (1 for the lane a step rides), and when the step's `part` beat opens them (see partOf). */
export type PartPlan = { lit: readonly number[]; beat?: { at: number; dur: number } }

export const NO_PLANS: ReadonlyMap<string, PartPlan> = new Map()

/**
 * What a stop asks of the pairs of the view: for each pair of several lines that one of the stop's steps rides, which of its lines are lit, and when the earliest `part` beat of the
 * steps on it starts (a step with no motion, which has no beats, parts at once). `steps` are the steps of the stop: the id of the strand each rides (undefined for one that rides none)
 * and its beats (as beatsFor gives them for the pair's number of lines), if it moves.
 */
export function planOf(strands: readonly Strand[], steps: readonly { strand: string | undefined; beats?: readonly Beat[] }[]): ReadonlyMap<string, PartPlan> {
  const lit = litLanes(strands, steps.flatMap(s => s.strand ?? []))
  if (lit.size === 0) return NO_PLANS
  const pairOf = new Map(strands.map(s => [s.id, s.pair]))
  const made = new Map<string, PartPlan>()
  for (const [pair, lam] of lit) {
    let beat: { at: number; dur: number } | undefined
    for (const step of steps) {
      const found = step.strand !== undefined && pairOf.get(step.strand) === pair && step.beats !== undefined ? partOf(step.beats) : undefined
      if (found && (beat === undefined || found.at < beat.at)) beat = found
    }
    made.set(pair, { lit: lam, ...(beat === undefined ? {} : { beat }) })
  }
  return made
}

/** How many steps the lit amount of a lane is cut to. */
export const STEPS = 32

export type PartStore = {
  /** How lit each lane of the pair is now (1 for a lane a step rides), or undefined for a pair at rest. The same array while it does not change. */
  lam: (pair: string) => readonly number[] | undefined
  subscribe: (listener: () => void) => () => void
  /**
   * The stop `key` begins: the store begins the clock on it (the step's motions and the player say it too, and the same key again does nothing) and takes what the stop lights. Each
   * pair starts from the pose it was in just before the clock moved. `jump`: the player went somewhere other than the next stop or the one before. `still`: reduced motion, no easing.
   */
  set: (key: string, plans: ReadonlyMap<string, PartPlan>, how: { jump: boolean; still: boolean }) => void
  /** Draws the pose of the clock's moment now (an attached store does it on its own on every change of the clock; a test calls it after moving a clock it made). */
  tick: () => void
  /**
   * Starts hearing the clock (a pause, a play, a scrub, a speed) and draws the pose of this moment; the result stops it again and takes back the next frame asked for. The store
   * does not hear the clock until it is attached, and it can be attached again after it was detached: a React effect may be run, cleaned up and run again (StrictMode does it on
   * every mount), and a store made once in a memo has to come back to life each time. The lines that listen to the store keep their listeners through it.
   */
  attach: () => () => void
}

/** Asks for a call at the next frame; the result takes the ask back. */
export type Frames = (fn: () => void) => () => void

const browserFrames: Frames = fn => {
  if (typeof requestAnimationFrame !== 'function') return () => undefined
  const id = requestAnimationFrame(fn)
  return () => cancelAnimationFrame(id)
}

/** A pose's lanes cut to STEPS steps; a pair at rest, however it got there, is the empty list. */
const cut = (lam: readonly number[]): readonly number[] => {
  const steps = lam.map(l => Math.round(l * STEPS) / STEPS)
  return steps.every(l => l === 0) ? [] : steps
}
const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((l, i) => l === b[i])
const unlit = (lam: readonly number[]): boolean => lam.every(l => l === 0)

export function createPartStore(clock: PlayerClock, frames: Frames = browserFrames): PartStore {
  const motions = new Map<string, { parting: Parting; origin: number }>()
  let current = new Map<string, readonly number[]>()
  const listeners = new Set<() => void>()
  let cancel: (() => void) | undefined
  let muted = false // while the clock is being begun on a new stop, its change is no news: the store takes the new plan next

  const settled = (m: { parting: Parting; origin: number }, now: number): boolean => now - m.origin >= m.parting.at + m.parting.dur

  /** Works out the pose of every pair at the clock's moment, tells the lines that changed, and asks for the next frame if a pair is still on its way. */
  function update(): void {
    if (muted) return
    cancel?.()
    cancel = undefined
    const now = clock.elapsed()
    const next = new Map<string, readonly number[]>()
    let changed = false
    let moving = false
    for (const [pair, m] of [...motions]) {
      const pose = poseAt(m.parting, now - m.origin)
      const lam = cut(pose.lam)
      const done = settled(m, now)
      if (done && unlit(lam)) {
        motions.delete(pair) // closed again: the pair is at rest and needs no more watching
      } else {
        const before = current.get(pair)
        next.set(pair, before !== undefined && same(before, lam) ? before : lam)
        if (!done) moving = true
      }
      if (!same(current.get(pair) ?? [], next.get(pair) ?? [])) changed = true
    }
    current = next
    if (moving && !clock.paused) cancel = frames(update)
    if (changed) for (const listener of [...listeners]) listener()
  }

  return {
    lam: pair => current.get(pair),
    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set(key, plans, how) {
      // The pose each pair is in now, before the clock goes back to the start of the new stop.
      const poses = new Map([...motions].map(([pair, m]) => [pair, cut(poseAt(m.parting, clock.elapsed() - m.origin).lam)] as const))
      muted = true
      try {
        clock.begin(key)
      } finally {
        muted = false
      }
      const now = clock.elapsed()
      for (const pair of new Set([...plans.keys(), ...motions.keys()])) {
        const plan = plans.get(pair)
        const here = poses.get(pair) ?? []
        const lit = plan?.lit ?? here.map(() => 0)
        const before = here.length > 0 ? here : lit.map(() => 0)
        if (unlit(before) && unlit(lit)) {
          motions.delete(pair)
          continue
        }
        const parting: Parting = how.still ? { from: lit, to: lit, at: 0, dur: 0, ease: 'out' } : partingFor(before, lit, { ...(plan?.beat === undefined ? {} : { beat: plan.beat }), jump: how.jump })
        motions.set(pair, { parting, origin: now })
      }
      update()
    },
    tick: update,
    attach() {
      const heard = clock.subscribe(update)
      update() // the clock may have moved while nothing was listening
      let on = true
      return () => {
        if (!on) return
        on = false
        heard()
        cancel?.()
        cancel = undefined
      }
    },
  }
}

/** The store a line reads when none is provided (a canvas that plays no flow): every pair at rest. */
export const noParts: PartStore = {
  lam: () => undefined,
  subscribe: () => () => undefined,
  set: () => undefined,
  tick: () => undefined,
  attach: () => () => undefined,
}

/** Provides the store of the flow that plays on a canvas to the lines inside it. */
export const PartsContext = createContext<PartStore>(noParts)
