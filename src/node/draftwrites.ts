import { existsSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { isDraftId } from '../core/drafts.ts'
import type { Model } from '../core/model.ts'
import { modelFiles } from '../core/modelfiles.ts'
import { draftDir, hasDraft } from './drafts.ts'
import { saveFiles } from './files.ts'

/** Writes draft `id` of the model folder `dir` as `model`'s files. Refused when the draft is there already or the id can't be a folder name. */
export async function createDraft(dir: string, id: string, model: Model): Promise<void> {
  if (!isDraftId(id)) throw new Error(`"${id}" can't be a draft id: use lowercase letters, digits and dashes, not starting with a dash.`)
  if (existsSync(draftDir(dir, id))) throw new Error(`There is a draft "${id}" already.`)
  await mkdir(draftDir(dir, id), { recursive: true })
  try {
    await saveFiles(draftDir(dir, id), Object.entries(modelFiles(model)).map(([rel, text]) => ({ rel, text, expected: null })))
  } catch (e) {
    await rm(draftDir(dir, id), { recursive: true, force: true })
    throw e
  }
}

/** Removes draft `id` of the model folder `dir` with every file in it. Refused when there is no such draft. */
export async function deleteDraft(dir: string, id: string): Promise<void> {
  if (!hasDraft(dir, id)) throw new Error(`There is no draft "${id}".`)
  await rm(draftDir(dir, id), { recursive: true })
}
