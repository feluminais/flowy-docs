import type { Problem } from '../../src/core/check.ts'
import { changedFiles, fileData, getObject, isValidId, ROOT, serializeLayout } from '../../src/core/model.ts'
import type { Connection, Model } from '../../src/core/model.ts'
import { chain, computeView, isView, parentOf, placeEnds } from '../../src/core/views.ts'

export const nameOf = (model: Model, id: string) => (id === ROOT ? 'Overview' : getObject(model, id)?.name || id)

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

/** The connections one line of a view stands for, with their place in model.connections. */
export function connectionsOf(model: Model, view: string, from: string, to: string): { index: number; connection: Connection }[] {
  return model.connections.flatMap((connection, index) => {
    const ends = placeEnds(model, view, connection.from, connection.to)
    return ends?.[0] === from && ends[1] === to ? [{ index, connection }] : []
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
  const lines = computeView(model, view).edges
    .filter(e => e.from !== e.to && (e.from === id || e.to === id))
    .map(e => ({ from: e.from, to: e.to, other: e.from === id ? e.to : e.from, connections: connectionsOf(model, view, e.from, e.to).map(c => c.connection) }))
  return { out: lines.filter(l => l.from === id), in: lines.filter(l => l.to === id) }
}

/** Where the canvas shows a problem: the view to open, and the box, line or flow step in it. */
export type Spot = { view: string; object?: string; line?: [string, string]; flow?: string; step?: number }

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
  const flow = /^flows\/(.+)\.yaml$/.exec(problem.file)?.[1]
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
