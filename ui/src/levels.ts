/** The most levels Esc can step back through. */
const MAX = 50

/** The levels the reader has left, oldest first. Esc goes back through them. */
export type Levels = readonly string[]

/** The reader moved from `from` to `to` on their own: `from` is where Esc takes them back to. Staying put leaves the list as it is. */
export function remember(levels: Levels, from: string, to: string): Levels {
  return from === to || levels.at(-1) === from ? levels : [...levels, from].slice(-MAX)
}

/**
 * Esc: the level the reader was in before `here`, and the list without it. A level that is gone (`exists` says no), or is the one they are in, is passed over.
 * Undefined when there is none, and the caller goes up a level instead.
 */
export function cameBack(levels: Levels, here: string, exists: (id: string) => boolean): { to: string; rest: Levels } | undefined {
  for (let i = levels.length - 1; i >= 0; i--) {
    if (levels[i] !== here && exists(levels[i])) return { to: levels[i], rest: levels.slice(0, i) }
  }
  return undefined
}
