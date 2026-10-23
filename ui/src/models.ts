import type { ModelList } from '../../src/core/modellist.ts'
import { apiUrl } from './apiurl.ts'

export type { ModelInfo, ModelList } from '../../src/core/modellist.ts'

/** The model this page was opened for, from `?model=`; undefined on the first one. */
export const modelOfPage = (search = location.search): string | undefined => new URLSearchParams(search).get('model') ?? undefined

/** The address of the same page on another model. The view and flow in the hash belong to one model, so they are left behind. */
export const addressOf = (id: string, current: { pathname: string } = location): string => `${current.pathname}${apiUrl('', '', id)}`

/** What the local server lists and how its search went, or nothing when there is no such server (an exported page, VS Code). */
export async function fetchModels(base = ''): Promise<ModelList | undefined> {
  return await ask('GET', base)
}

/** Starts the deeper search of the folder flowy was started in; the answer says it is running. */
export async function scanDeeper(base = ''): Promise<ModelList | undefined> {
  return await ask('POST', base)
}

/** Stops the search that is running, keeping what it found. */
export async function stopScan(base = ''): Promise<ModelList | undefined> {
  return await ask('DELETE', base)
}

async function ask(method: 'GET' | 'POST' | 'DELETE', base: string): Promise<ModelList | undefined> {
  try {
    const res = await fetch(method === 'GET' ? `${base}/api/models` : `${base}/api/models/scan`, { method, ...(method === 'GET' ? {} : { headers: { 'X-Flowy': '1' } }) })
    return res.ok ? ((await res.json()) as ModelList) : undefined
  } catch {
    return undefined
  }
}
