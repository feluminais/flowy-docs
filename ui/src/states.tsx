import type { JSX } from 'react'
import { STATE_LABELS, STATE_NAMES } from '../../src/core/states.ts'
import type { StateMark, StateName } from '../../src/core/states.ts'
import { Alert, PathIcon } from './icons.tsx'
import { KeyItem, KeyRow } from './Performance.tsx'

/**
 * The little drawing that names a state, so colour is never the only cue. The same drawings as the desktop app's (desktop/Flowy.App/Canvas/Icons.cs):
 * a spinning arc coming up, an hourglass shutting down, a power symbol when off, a circling arrow restarting, a warning triangle when not well.
 */
const GLYPHS: Record<Exclude<StateName, 'running'>, (size: number) => JSX.Element> = {
  starting: size => <PathIcon d="M12 3a9 9 0 1 0 9 9" size={size} />,
  stopping: size => <PathIcon d="M6.5 7h11M6.5 17h11M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1zM6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1z" size={size} />,
  stopped: size => <PathIcon d="M7 6a7.75 7.75 0 1 0 10 0M12 4l0 8" size={size} />,
  restarting: size => <PathIcon d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" size={size} />,
  degraded: size => <Alert size={size} />,
}

/** A state as a person says it: "Stopped", and "Stopped inside" for a shape that holds one that is. */
export const stateWord = (mark: StateMark): string => (mark.inside ? `${STATE_LABELS[mark.state]} inside` : STATE_LABELS[mark.state])

/** The state's glyph on a ring in its colour (the ring is dashed when only something inside is in the state). It spins while the state is coming up or restarting. */
export function StateGlyph({ mark, size = 12, className }: { mark: StateMark; size?: number; className?: string }) {
  const word = stateWord(mark)
  return <span className={['state-glyph', className].filter(Boolean).join(' ')} role="img" aria-label={word} title={word}>{GLYPHS[mark.state as Exclude<StateName, 'running'>](size)}</span>
}

/** A shape's classes for a state: which one, and `stated` when it is in it (`state-inside` when it only holds one that is). The look is in style.css. */
export const stateClasses = (mark: StateMark): string => `state-${mark.state} ${mark.inside ? 'state-inside' : 'stated'}`

/** The mark as the key draws it: a small outline in the state's own dash with its glyph on the corner. Still, whatever the shape does. */
export function Swatch({ mark }: { mark: StateMark }) {
  return (
    <span className={`state-key ${stateClasses(mark)}`}>
      {!mark.inside && <svg viewBox="0 0 26 16" aria-hidden="true"><rect x="1" y="1" width="24" height="14" rx="4" /></svg>}
      <StateGlyph mark={mark} size={9} />
    </span>
  )
}

/** The picker's tile for no change at all ("none": a faint dotted outline) and for Running (a plain outline, which is how a running shape looks). */
export function PlainSwatch({ none }: { none?: boolean }) {
  return <span className={`state-key plain${none ? ' none' : ''}`}><svg viewBox="0 0 26 16" aria-hidden="true"><rect x="1" y="1" width="24" height="14" rx="4" /></svg></span>
}

/** The key under the player: one mark for each state that is on the canvas now, drawn as it looks there, and nothing when no shape is in one. */
export function StateKey({ marks }: { marks: Record<string, StateMark> }) {
  const distinct = new Map<string, StateMark>()
  for (const mark of Object.values(marks)) distinct.set(`${mark.state}${mark.inside ? ' inside' : ''}`, mark)
  const items = [...distinct.values()].sort((a, b) => STATE_NAMES.indexOf(a.state) - STATE_NAMES.indexOf(b.state) || Number(a.inside) - Number(b.inside))
  if (items.length === 0) return null
  return (
    <KeyRow>
      {items.map(mark => <KeyItem key={stateWord(mark)} swatch={<Swatch mark={mark} />}>{stateWord(mark)}</KeyItem>)}
    </KeyRow>
  )
}
