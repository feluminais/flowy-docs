/**
 * `connection` (a place in model.connections) and `step` (a place in the flow's steps) tell the
 * canvas where to point. They aren't part of what a problem is: newProblems ignores them, so
 * deleting one connection doesn't make the problems after it look new.
 */
export type Problem = { file: string; id?: string; message: string; connection?: number; step?: number }
