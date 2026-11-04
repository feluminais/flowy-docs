import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { isSketchId, LEGACY_DRAFTS_FOLDER, SKETCHES_FOLDER } from '../core/sketches.ts'
import type { SketchInfo } from '../core/sketches.ts'
import { projectName } from '../core/model.ts'
import { parseModelFile } from '../core/modelfiles.ts'

/** The folders a sketch can be in: where new ones go first, then the one they had before the rename. */
const FOLDERS = [SKETCHES_FOLDER, LEGACY_DRAFTS_FOLDER] as const

/** The model folder a sketch folder belongs to: `dir` is `<model>/sketches/<id>` (or the old `<model>/drafts/<id>`) and `<model>` holds a model.yaml. Undefined when `dir` is no sketch. */
export function modelOfSketch(dir: string): string | undefined {
  const full = resolve(dir)
  const sketches = dirname(full)
  if (!(FOLDERS as readonly string[]).includes(basename(sketches)) || !isSketchId(basename(full))) return undefined
  const model = dirname(sketches)
  return existsSync(join(model, 'model.yaml')) ? model : undefined
}

/** The folder a shape's `code` and `links` paths start from: the one that holds the model folder, which for a sketch is the one that holds its model's. */
export const repoOf = (dir: string): string => dirname(modelOfSketch(dir) ?? resolve(dir))

/** Where sketch `id` of the model folder `dir` is: in `sketches/`, else in the old `drafts/`. A sketch that is nowhere yet is where it would be made, in `sketches/`. */
export function sketchDir(dir: string, id: string): string {
  for (const folder of FOLDERS) if (existsSync(join(resolve(dir), folder, id, 'model.yaml'))) return join(resolve(dir), folder, id)
  return join(resolve(dir), SKETCHES_FOLDER, id)
}

/** The folder of sketch `id` from the model folder `dir`, as a path in it: `sketches/<id>`, or `drafts/<id>` for a sketch made before the rename. */
export const sketchFolderIn = (dir: string, id: string): string => `${basename(dirname(sketchDir(dir, id)))}/${id}`

/** Whether the model folder `dir` has sketch `id`: its folder holds a model.yaml. */
export const hasSketch = (dir: string, id: string): boolean => isSketchId(id) && FOLDERS.some(folder => existsSync(join(resolve(dir), folder, id, 'model.yaml')))

/** The `name:` of the model.yaml in the model folder `dir`: "" when it has none or can't be read. */
export async function nameOfModel(dir: string): Promise<string> {
  try {
    return projectName(parseModelFile(await readFile(join(dir, 'model.yaml'), 'utf8')))
  } catch {
    return ''
  }
}

/** The name a sketch's model.yaml gives it, or its id when the file has none or can't be read. */
const nameOf = async (dir: string, id: string): Promise<string> => (await nameOfModel(sketchDir(dir, id))) || id

/** The sketches of the model folder `dir`, by id: each folder in `sketches/` or the old `drafts/` whose name is an id and that holds a model.yaml. None when there is neither folder. */
export async function listSketches(dir: string): Promise<SketchInfo[]> {
  const found = new Set<string>()
  for (const folder of FOLDERS) {
    const entries = await readdir(join(resolve(dir), folder), { withFileTypes: true }).catch(() => [])
    for (const e of entries) if (e.isDirectory() && isSketchId(e.name) && hasSketch(dir, e.name)) found.add(e.name)
  }
  return await Promise.all([...found].sort().map(async id => ({ id, name: await nameOf(dir, id) })))
}
