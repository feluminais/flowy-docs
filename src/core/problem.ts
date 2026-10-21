/**
 * `connection` (a place in model.connections) and `step` (a place in the flow's steps) tell the
 * canvas where to point. They aren't part of what a problem is: newProblems ignores them, so
 * deleting one connection doesn't make the problems after it look new.
 */
export type Problem = { file: string; id?: string; message: string; connection?: number; step?: number }

/** What a problem that belongs to step `step` (counted from 0) starts with: "step N: " (N counts from 1). */
export const stepPrefix = (step: number): string => `step ${step + 1}: `

/** The problem's text without its step prefix, the same wherever the step moves to. */
export const withoutStep = (p: Problem): string =>
  p.step !== undefined && p.message.startsWith(stepPrefix(p.step)) ? p.message.slice(stepPrefix(p.step).length) : p.message
