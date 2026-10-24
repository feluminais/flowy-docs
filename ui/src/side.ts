import type { Target } from '../../src/core/dependents.ts'
import type { Recording } from './Recorder.tsx'

/** What the side panel shows. One thing at a time. */
export type Side =
  | { kind: 'object'; id: string }
  | { kind: 'objects'; ids: string[] } // several shapes picked in edit mode, to move or delete together
  | { kind: 'line'; from: string; to: string; view?: string } // `view` is the view of the pane of a comparison it was clicked in; on the single canvas it is the one on show
  | { kind: 'add' }
  | { kind: 'usedby'; targets: Target[]; back: Side | undefined } // what is waiting on the shapes or lines about to be deleted (see UsedBy)
  | ({ kind: 'flow' } & Recording)

/** The flow being recorded, in edit mode. */
export type FlowSide = Extract<Side, { kind: 'flow' }>

/** The panel for a set of shapes: none shows nothing, one is an ordinary click on it. */
export const sideFor = (ids: string[]): Side | undefined => (ids.length === 0 ? undefined : ids.length === 1 ? { kind: 'object', id: ids[0] } : { kind: 'objects', ids })
