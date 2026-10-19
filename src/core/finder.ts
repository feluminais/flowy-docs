import { getObject, ROOT } from './model.ts'
import type { Model } from './model.ts'
import { chain, nameOf, parentOf } from './views.ts'

/** Where a view sits, the way the flow list words it: "Shop › Web app", or "Overview" for the top. */
function whereIs(model: Model, view: string): string {
  const names = chain(model, view).filter(id => id !== ROOT).reverse().map(id => nameOf(model, id))
  return names.length === 0 ? 'Overview' : names.join(' › ')
}

const nameOrder = (a: string, b: string) => a.localeCompare(b)

/**
 * The shapes that stand for a file: `path` is the file's place in the repo, relative to the folder that holds flowy/, with
 * "/" between folders. A shape stands for a file it lists, or one inside a folder it lists (a trailing "/" is optional).
 * Only the nearest listing counts, the longest path, so a file inside a component is not also the app that holds it.
 * Shapes that list the same path all count, in id order. A file nothing lists has none.
 */
export function shapesFor(model: Model, path: string): string[] {
  const found: { id: string; length: number }[] = []
  for (const [id, object] of Object.entries(model.objects)) {
    if (!Array.isArray(object.code)) continue
    let best = -1
    for (const entry of object.code) {
      if (typeof entry !== 'string') continue
      const listed = entry.replace(/\/$/, '')
      if (listed !== '' && (path === listed || path.startsWith(`${listed}/`))) best = Math.max(best, listed.length)
    }
    if (best >= 0) found.push({ id, length: best })
  }
  const nearest = Math.max(-1, ...found.map(f => f.length))
  return found.filter(f => f.length === nearest).map(f => f.id).sort()
}

/** What a list of shapes to jump to shows for one: its name, what it is, and the shapes it sits in. */
export type ShapeChoice = { id: string; name: string; type: string; where: string }

/** Every shape, by name. */
export function shapeChoices(model: Model): ShapeChoice[] {
  return Object.keys(model.objects)
    .flatMap(id => {
      const object = getObject(model, id)
      return object ? [{ id, name: nameOf(model, id), type: String(object.type ?? ''), where: whereIs(model, parentOf(model, id)) }] : []
    })
    .sort((a, b) => nameOrder(a.name, b.name) || nameOrder(a.id, b.id))
}

/** What a list of flows to play shows for one: its name, the view it plays in, and how many steps it has. */
export type FlowChoice = { id: string; name: string; where: string; steps: number }

/** The flows that can play (they have steps), the overview's first, then by the view they play in, then by name. A view that isn't there counts as the overview. */
export function flowChoices(model: Model): FlowChoice[] {
  const sortKey = (c: FlowChoice) => (c.where === 'Overview' ? '' : c.where)
  return Object.entries(model.flows)
    .filter(([, flow]) => flow.steps.length > 0)
    .map(([id, flow]) => ({ id, name: flow.name || id, where: whereIs(model, flow.view !== ROOT && getObject(model, flow.view) ? flow.view : ROOT), steps: flow.steps.length }))
    .sort((a, b) => nameOrder(sortKey(a), sortKey(b)) || nameOrder(a.name, b.name) || nameOrder(a.id, b.id))
}
