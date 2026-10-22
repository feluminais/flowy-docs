import { apiUrl } from './apiurl.ts'

/** A model the local server shows: `id` is what `?model=` names, `where` is its folder in the repo. */
export type ModelInfo = { id: string; name: string; where: string }

/** The model this page was opened for, from `?model=`; undefined on the first one. */
export const modelOfPage = (search = location.search): string | undefined => new URLSearchParams(search).get('model') ?? undefined

/** The address of the same page on another model. The view and flow in the hash belong to one model, so they are left behind. */
export const addressOf = (id: string, current: { pathname: string } = location): string => `${current.pathname}${apiUrl('', '', id)}`

/** The models the server shows. One or none (a server of its own folder, an exported page, VS Code) means there is nothing to switch. */
export async function fetchModels(base = ''): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${base}/api/models`)
    return res.ok ? ((await res.json()) as ModelInfo[]) : []
  } catch {
    return []
  }
}

/** What a switcher shows for a model: its name, and its folder too when another model has the same name. */
export const labelOf = (models: ModelInfo[], m: ModelInfo): string => (models.some(o => o !== m && o.name === m.name) ? `${m.name} (${m.where})` : m.name)
