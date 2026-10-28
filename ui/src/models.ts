import { draftModelId, splitDraftModelId } from '../../src/core/drafts.ts'
import type { ModelList } from '../../src/core/modellist.ts'
import { apiUrl } from './apiurl.ts'

export type { ModelInfo, ModelList } from '../../src/core/modellist.ts'

/** The model this page was opened for, from `?model=`; undefined on the first one. */
export const modelOfPage = (search = location.search): string | undefined => new URLSearchParams(search).get('model') ?? undefined

/** The address of the same page on another model. The view and flow in the hash belong to one model, so they are left behind. */
export const addressOf = (id: string, current: { pathname: string } = location): string => `${current.pathname}${apiUrl('', '', id)}`

/** The address of draft `id` of the model on this page. Left out, `?model=` names the server's first model, and so does a draft id with no model in it. */
export const draftAddress = (id: string, page = modelOfPage(), current: { pathname: string } = location): string => addressOf(draftModelId(page ?? '', id), current)

/** The address of the model the draft on this page belongs to: the page with no `?model=` when that is the server's first model. */
export function ownerAddress(page = modelOfPage(), current: { pathname: string } = location): string {
  const named = page === undefined ? undefined : splitDraftModelId(page)
  return named === undefined || named.model === '' ? current.pathname : addressOf(named.model, current)
}

/** Makes an empty draft called `name` of the model on this page; resolves to its address, or throws with the server's reason. */
export async function makeDraft(id: string, name: string, base = ''): Promise<string> {
  const res = await fetch(apiUrl(base, '/api/drafts', modelOfPage()), { method: 'POST', headers: { 'X-Flowy': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name }) })
  const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string }
  if (!res.ok || body.id === undefined) throw new Error(body.error ?? `the server answered ${res.status}`)
  return addressOf(body.id)
}

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
