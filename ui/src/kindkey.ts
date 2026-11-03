import { KIND_IDS, KINDS, sameLook } from '../../src/core/kinds.ts'
import type { HeadShape, KindId, LineLook, TailShape } from '../../src/core/kinds.ts'
import { isStepLine } from './graph.ts'

/**
 * The kinds the lines on the canvas are drawn as, for the key: the kinds in the order of the list, and whether a plain line is on show as well.
 * `lines` are the canvas's lines; one a step added (the dashed step line) is not a connection and does not count. Lines drawn as no kind (a mixed line) count as plain.
 */
export function kindsOnScreen(lines: readonly { id: string; data?: Record<string, unknown> }[]): { kinds: KindId[]; plain: boolean } {
  const looks: (LineLook | undefined)[] = lines.filter(l => !isStepLine(l.id)).map(l => l.data?.look as LineLook | undefined)
  const kinds = KIND_IDS.filter(id => looks.some(look => look !== undefined && sameLook(look, KINDS[id].look)))
  return { kinds, plain: looks.some(look => look === undefined) }
}

/** Marks on a line that is one of several side by side (`data.lanes` above 1) are drawn no bigger than this, so a head stays within the gap between neighbours. */
export const LANE_MARK_SCALE = 1.2

/** The scale a line's marks are drawn at: the head scale for its width, and no more than LANE_MARK_SCALE when it is one of several lines side by side. */
export const markScale = (headScale: number, lanes: number): number => (lanes > 1 ? Math.min(headScale, LANE_MARK_SCALE) : headScale)

/**
 * Which marks a line wears: its head (a plain line has a filled one) on its end, and also on its start when it carries connections both ways; and, when it runs one way, the
 * kind's tail on its start. A line that runs both ways has no tail, since it would sit where the other end's head is.
 */
export function marksOf(look: LineLook | undefined, both: boolean): { head: HeadShape; headAtStart: boolean; tail: Exclude<TailShape, 'none'> | undefined } {
  const tail = look === undefined || both || look.tail === 'none' ? undefined : look.tail
  return { head: look?.head ?? 'filled', headAtStart: both, tail }
}
