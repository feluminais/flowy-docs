import { emptyModel, getObject, isValidId } from './model.ts'
import type { Model } from './model.ts'
import { isMap } from './text.ts'

/**
 * A sketch is a model of its own in `sketches/<id>/` of the model folder: the same files, read and written the same way. The model never reads
 * it, so a sketch can't change or break the model. It starts empty or as a copy of shapes of the model, and a copy stays as it was when the
 * model changes later.
 *
 * Sketches used to be called drafts and lived in `drafts/<id>/`. That folder is still read, and a sketch found there is a sketch like any other;
 * new ones are written to `sketches/`. When both folders hold an id, the one in `sketches/` is the sketch.
 */
export const SKETCHES_FOLDER = 'sketches'

/** The folder sketches had before the rename. Read, never written to. */
export const LEGACY_DRAFTS_FOLDER = 'drafts'

/** One sketch as a list of them shows it: its folder name and the `name:` of its model.yaml (the id when it has none). */
export type SketchInfo = { id: string; name: string }

/** The folder new sketch `id` is written to, from the model folder. */
export const sketchFolder = (id: string): string => `${SKETCHES_FOLDER}/${id}`

/** What a sketch id may be: the same as a shape's or a flow's, since it is a folder name. */
export const isSketchId = (id: unknown): id is string => typeof id === 'string' && isValidId(id)

/** The served model id of sketch `id` of the model served as `model` (`""` for the one model of --dir). */
export const sketchModelId = (model: string, id: string): string => (model === '' ? sketchFolder(id) : `${model}/${sketchFolder(id)}`)

/** The model id and sketch id a served model id names, when it names a sketch: `<model>/sketches/<id>`, or `sketches/<id>` of the first model. The old `drafts/<id>` forms name the same sketches. */
export function splitSketchModelId(served: string): { model: string; id: string } | undefined {
  const m = /^(?:(.*)\/)?(?:sketches|drafts)\/([^/]+)$/.exec(served)
  return m && isSketchId(m[2]) ? { model: m[1] ?? '', id: m[2] } : undefined
}

/** A deep copy of plain file data (text, lists and mappings), so a sketch's copy and the model share nothing. */
const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * A new sketch's model: `name` and `about`, `pairs: separate` (a line for each connection, where the model draws one line between two shapes), and a copy of the shapes `copy` names with the shapes they sit in (so each keeps its place)
 * and the lines between any two of them. The model's own icons, payloads and line style come along, since the copies may use them. Throws when
 * `copy` names a shape the model doesn't have.
 */
export function newSketch(model: Model, { name, about, copy = [] }: { name: string; about?: string; copy?: readonly string[] }): Model {
  const sketch = emptyModel()
  sketch.meta.name = name
  if (about !== undefined && about.trim() !== '') sketch.meta.about = about
  sketch.meta.pairs = 'separate' // before the early return: an empty sketch gets a line for each connection too
  if (copy.length === 0) return sketch
  const missing = copy.filter(id => getObject(model, id) === undefined)
  if (missing.length > 0) throw new Error(`The model has no shape ${missing.map(id => `"${id}"`).join(', ')}.`)
  const kept = new Set<string>()
  for (const id of copy) {
    for (let at: string | undefined = id; at !== undefined && !kept.has(at) && getObject(model, at) !== undefined; at = model.objects[at].in) kept.add(at)
  }
  // In the model's order, so the copy reads like the model.
  for (const [id, o] of Object.entries(model.objects)) if (kept.has(id)) sketch.objects[id] = deepCopy(o)
  sketch.connections = model.connections.filter(c => kept.has(c.from) && kept.has(c.to)).map(c => deepCopy(c))
  if (isMap(model.meta.icons)) sketch.meta.icons = deepCopy(model.meta.icons)
  if (isMap(model.meta.payloads)) sketch.meta.payloads = deepCopy(model.meta.payloads) // the copied lines may name them
  if (model.meta.lines !== undefined) sketch.meta.lines = model.meta.lines
  return sketch
}
