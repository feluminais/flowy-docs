import type { Problem } from '../../src/core/problem.ts'
import { homeView } from '../../src/core/failures.ts'
import { FILE_KINDS, idOfPath } from '../../src/core/filekinds.ts'
import { getObject, isValidId, ROOT } from '../../src/core/model.ts'
import { changedFiles, fileData, serializeLayout } from '../../src/core/modelfiles.ts'
import type { Connection, Model, Step } from '../../src/core/model.ts'
import { setStepStates } from '../../src/core/ops.ts'
import { isStateName } from '../../src/core/states.ts'
import type { StateName } from '../../src/core/states.ts'
import { isMap, own } from '../../src/core/text.ts'
import { chain, isView, lineKey, parentOf, placeEnds } from '../../src/core/views.ts'

/** One write: a file's new content as PUT /api/file takes it, or null to delete the file. */
export type Change = { file: string; data: unknown }

/** The files that differ between two models, layout.yaml included. */
export function changesBetween(before: Model, after: Model): Change[] {
  const changes = changedFiles(before, after).map(([file, text]) => ({ file, data: text === null ? null : fileData(after, file) }))
  if (serializeLayout(before.layout) !== serializeLayout(after.layout)) changes.push({ file: 'layout.yaml', data: after.layout })
  return changes
}

/** An id made from a name ("Orders DB" → "orders-db"), with -2, -3… when it's taken in any letter case. */
export function newId(name: string, taken: string[], fallback: string): string {
  const base = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || fallback
  const used = new Set(taken.map(id => id.toLowerCase()))
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`
    if (isValidId(id) && !used.has(id)) return id
  }
}

/** The step with its lane or flow link set to the text, trimmed, or without that key when the text is blank. A key that is there keeps its place. */
export function withKey(step: Step, key: 'lane' | 'flow', value: string): Step {
  const { [key]: _, ...rest } = step
  return value.trim() === '' ? rest as Step : { ...step, [key]: value.trim() }
}

/** The shapes a step's form offers a state change for: where it starts and where it goes, once each. A step with no `to` is its `from` alone. */
export const stepStateShapes = (step: Step): string[] => [...new Set([step.from, step.to ?? step.from])]

/** The state a step sets a shape to, or undefined when it does not say (or says something that is not a state). */
export function stateOf(step: Step, shape: string): StateName | undefined {
  const state = isMap(step.states) && Object.hasOwn(step.states, shape) ? step.states[shape] : undefined
  return isStateName(state) ? state : undefined
}

/**
 * The model with `shape` set to `state` ("" takes it out) on step `index` of a flow, as one edit. Every other entry of the step's `states` is kept as it is,
 * so a pick changes only what it was asked to. Refused, in the checker's words, for a shape or a word the checker would refuse.
 */
export function pickStepState(model: Model, flow: string, index: number, shape: string, state: StateName | ''): Model {
  const before = Object.hasOwn(model.flows, flow) ? model.flows[flow].steps[index]?.states : undefined
  const next: Record<string, string> = {}
  if (isMap(before)) for (const [id, word] of Object.entries(before)) if (id !== shape && typeof word === 'string') own(next, id, word)
  if (state !== '') next[shape] = state
  return setStepStates(model, flow, index, next)
}

/**
 * The connections one line of a view stands for, both ways, with their place in model.connections. `back`: it runs from `to` to `from`,
 * against the way the line is given.
 */
export function connectionsOf(model: Model, view: string, from: string, to: string): { index: number; connection: Connection; back: boolean }[] {
  const line = lineKey(from, to)
  return model.connections.flatMap((connection, index) => {
    const ends = placeEnds(model, view, connection.from, connection.to)
    return ends && lineKey(...ends) === line ? [{ index, connection, back: ends[0] !== from }] : []
  })
}

/** How moving from one view to another should feel: into a box inside, out to one around, or across to one beside. */
export type Move = 'in' | 'out' | 'across'

/**
 * Which way `to` lies from `from` in the nesting. Opening an outsider that sits beside the box you're
 * in (a sibling, or a cousin further out) is across, so going there and back never dives in twice.
 */
export function moveBetween(model: Model, from: string, to: string): Move {
  if (chain(model, to).includes(from)) return 'in'
  if (chain(model, from).includes(to)) return 'out'
  return 'across'
}

/** A line touching a box, as the canvas draws it where the box sits: the box at its other end, and the connections it stands for. */
export type BoxLine = { from: string; to: string; other: string; connections: Connection[] }

/**
 * The lines touching box `id` in the view it sits in, going out and coming in. A line between two
 * boxes that open can stand for several connections between what's inside them, each with its own label.
 */
export function linesOf(model: Model, id: string): { out: BoxLine[]; in: BoxLine[] } {
  const view = parentOf(model, id)
  // One pass, grouped by where each connection lands: asking connectionsOf per line rescans every connection each time.
  const byEnds = new Map<string, BoxLine>()
  for (const c of model.connections) {
    const ends = placeEnds(model, view, c.from, c.to)
    if (!ends || (ends[0] !== id && ends[1] !== id)) continue
    const key = JSON.stringify(ends)
    const line = byEnds.get(key) ?? { from: ends[0], to: ends[1], other: ends[0] === id ? ends[1] : ends[0], connections: [] }
    line.connections.push(c)
    byEnds.set(key, line)
  }
  const lines = [...byEnds.values()]
  return { out: lines.filter(l => l.from === id), in: lines.filter(l => l.to === id) }
}

/** Where the canvas shows a problem: the view to open, and the box, line or flow step in it. */
export type Spot = { view: string; object?: string; line?: [string, string]; flow?: string; step?: number; failure?: { analysis: string; mode?: string } }

export function locate(model: Model, problem: Problem): Spot {
  if (problem.id !== undefined && getObject(model, problem.id)) return { view: parentOf(model, problem.id), object: problem.id }
  const c = problem.connection === undefined ? undefined : model.connections[problem.connection]
  if (c) {
    const end = [c.from, c.to].find(e => getObject(model, e))
    if (end === undefined) return { view: ROOT }
    // The lowest view, from one end up, that shows the line (a line to a box's own child shows inside that box), else that end's box.
    for (const view of chain(model, end)) {
      const line = placeEnds(model, view, c.from, c.to)
      if (line) return { view, line }
    }
    return { view: parentOf(model, end), object: end }
  }
  const analysis = /^failures\/(.+)\.yaml$/.exec(problem.file)?.[1]
  if (analysis !== undefined && Object.hasOwn(model.failures, analysis)) {
    // A mode's problems start with its id and ": " (the id is no shape id: it never names an object). The longest id that fits is the mode.
    const modes = model.failures[analysis].modes
    const mode = Object.keys(modes).filter(id => problem.message.startsWith(`${id}: `)).sort((a, b) => b.length - a.length)[0]
    return mode === undefined ? { view: ROOT, failure: { analysis } } : { view: homeView(model, modes[mode]), failure: { analysis, mode } }
  }
  const flow = idOfPath(FILE_KINDS.flow, problem.file)
  if (flow !== undefined && Object.hasOwn(model.flows, flow)) {
    const { view } = model.flows[flow]
    return { view: isView(model, view) ? view : ROOT, flow, step: problem.step }
  }
  return { view: ROOT }
}

/** An object's own problems, and those of connections that touch it (a broken connection draws no line to click). */
export function problemsOf(model: Model, problems: Problem[], id: string): Problem[] {
  return problems.filter(p => {
    const c = p.connection === undefined ? undefined : model.connections[p.connection]
    return p.id === id || c?.from === id || c?.to === id
  })
}
