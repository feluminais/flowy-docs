import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { isSketchId } from '../core/sketches.ts'
import type { Model } from '../core/model.ts'
import { modelFiles } from '../core/modelfiles.ts'
import { hasSketch, sketchDir } from './sketches.ts'
import { saveFiles } from './files.ts'

/** Writes sketch `id` of the model folder `dir` as `model`'s files, in `sketches/`. Refused when the sketch is there already (in `sketches/` or the old `drafts/`) or the id can't be a folder name. */
export async function createSketch(dir: string, id: string, model: Model): Promise<void> {
  if (!isSketchId(id)) throw new Error(`"${id}" can't be a sketch id: use lowercase letters, digits and dashes, not starting with a dash.`)
  if (hasSketch(dir, id) || existsSync(sketchDir(dir, id))) throw new Error(`There is a sketch "${id}" already.`)
  const at = sketchDir(dir, id) // not made yet, so this is where a new sketch goes
  await mkdir(at, { recursive: true })
  try {
    await saveFiles(at, Object.entries(modelFiles(model)).map(([rel, text]) => ({ rel, text, expected: null })))
  } catch (e) {
    await rm(at, { recursive: true, force: true })
    throw e
  }
}

/** Removes sketch `id` of the model folder `dir` with every file in it, in `sketches/` and in the old `drafts/` if both hold it. Refused when there is no such sketch. */
export async function deleteSketch(dir: string, id: string): Promise<void> {
  if (!hasSketch(dir, id)) throw new Error(`There is no sketch "${id}".`)
  while (hasSketch(dir, id)) await rm(sketchDir(dir, id), { recursive: true })
}
