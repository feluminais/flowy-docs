import { emptyModel, getObject, isValidId } from './model.ts'
import type { Model } from './model.ts'
import { isMap } from './text.ts'

/**
 * A draft is a model of its own in `drafts/<id>/` of the model folder: the same files, read and written the same way. The model never reads
 * it, so a draft can't change or break the model. It starts empty or as a copy of shapes of the model, and a copy stays as it was when the
 * model changes later.
 */
export const DRAFTS_FOLDER = 'drafts'

/** One draft as a list of them shows it: its folder name and the `name:` of its model.yaml (the id when it has none). */
export type DraftInfo = { id: string; name: string }

/** The folder of draft `id`, from the model folder. */
export const draftFolder = (id: string): string => `${DRAFTS_FOLDER}/${id}`

/** What a draft id may be: the same as a shape's or a flow's, since it is a folder name. */
export const isDraftId = (id: unknown): id is string => typeof id === 'string' && isValidId(id)

/** The served model id of draft `id` of the model served as `model` (`""` for the one model of --dir). */
export const draftModelId = (model: string, id: string): string => (model === '' ? draftFolder(id) : `${model}/${draftFolder(id)}`)

/** The model id and draft id a served model id names, when it names a draft: `<model>/drafts/<id>`, or `drafts/<id>` of the first model. */
export function splitDraftModelId(served: string): { model: string; id: string } | undefined {
  const m = /^(?:(.*)\/)?drafts\/([^/]+)$/.exec(served)
  return m && isDraftId(m[2]) ? { model: m[1] ?? '', id: m[2] } : undefined
}

/**
 * A new draft's model: `name` and `about`, and a copy of the shapes `copy` names with the shapes they sit in (so each keeps its place)
 * and the lines between any two of them. The model's own icons and line style come along, since the copies may use them. Throws when
 * `copy` names a shape the model doesn't have.
 */
export function newDraft(model: Model, { name, about, copy = [] }: { name: string; about?: string; copy?: readonly string[] }): Model {
  const draft = emptyModel()
  draft.meta.name = name
  if (about !== undefined && about.trim() !== '') draft.meta.about = about
  if (copy.length === 0) return draft
  const missing = copy.filter(id => getObject(model, id) === undefined)
  if (missing.length > 0) throw new Error(`The model has no shape ${missing.map(id => `"${id}"`).join(', ')}.`)
  const kept = new Set<string>()
  for (const id of copy) {
    for (let at: string | undefined = id; at !== undefined && !kept.has(at) && getObject(model, at) !== undefined; at = model.objects[at].in) kept.add(at)
  }
  // In the model's order, so the copy reads like the model.
  for (const [id, o] of Object.entries(model.objects)) if (kept.has(id)) draft.objects[id] = structuredClone(o)
  draft.connections = model.connections.filter(c => kept.has(c.from) && kept.has(c.to)).map(c => structuredClone(c))
  if (isMap(model.meta.icons)) draft.meta.icons = structuredClone(model.meta.icons)
  if (model.meta.lines !== undefined) draft.meta.lines = model.meta.lines
  return draft
}
