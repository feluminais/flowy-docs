import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { DRAFTS_FOLDER, isDraftId } from '../core/drafts.ts'
import type { DraftInfo } from '../core/drafts.ts'
import { projectName } from '../core/model.ts'
import { parseModelFile } from '../core/modelfiles.ts'

/** The model folder a draft folder belongs to: `dir` is `<model>/drafts/<id>` and `<model>` holds a model.yaml. Undefined when `dir` is no draft. */
export function modelOfDraft(dir: string): string | undefined {
  const full = resolve(dir)
  const drafts = dirname(full)
  if (basename(drafts) !== DRAFTS_FOLDER || !isDraftId(basename(full))) return undefined
  const model = dirname(drafts)
  return existsSync(join(model, 'model.yaml')) ? model : undefined
}

/** The folder a shape's `code` and `links` paths start from: the one that holds the model folder, which for a draft is the one that holds its model's. */
export const repoOf = (dir: string): string => dirname(modelOfDraft(dir) ?? resolve(dir))

/** The folder of draft `id` of the model folder `dir`. */
export const draftDir = (dir: string, id: string): string => join(resolve(dir), DRAFTS_FOLDER, id)

/** Whether the model folder `dir` has draft `id`: its folder holds a model.yaml. */
export const hasDraft = (dir: string, id: string): boolean => isDraftId(id) && existsSync(join(draftDir(dir, id), 'model.yaml'))

/** The `name:` of the model.yaml in the model folder `dir`: "" when it has none or can't be read. */
export async function nameOfModel(dir: string): Promise<string> {
  try {
    return projectName(parseModelFile(await readFile(join(dir, 'model.yaml'), 'utf8')))
  } catch {
    return ''
  }
}

/** The name a draft's model.yaml gives it, or its id when the file has none or can't be read. */
const nameOf = async (dir: string, id: string): Promise<string> => (await nameOfModel(draftDir(dir, id))) || id

/** The drafts of the model folder `dir`, by id: each folder in `drafts/` whose name is an id and that holds a model.yaml. None when there is no `drafts/`. */
export async function listDrafts(dir: string): Promise<DraftInfo[]> {
  const entries = await readdir(join(resolve(dir), DRAFTS_FOLDER), { withFileTypes: true }).catch(() => [])
  const ids = entries.filter(e => e.isDirectory() && isDraftId(e.name) && hasDraft(dir, e.name)).map(e => e.name).sort()
  return await Promise.all(ids.map(async id => ({ id, name: await nameOf(dir, id) })))
}
