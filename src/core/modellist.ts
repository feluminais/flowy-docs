/** A model the local server lists: `id` is what `?model=` names, `where` is its folder from the folder that was searched, with `/`. */
export type ModelInfo = { id: string; name: string; where: string }

/** Why a search ended before it had looked everywhere: it reached its folder count, its time, or the reader pressed Stop. */
export type StoppedBy = 'folders' | 'time' | 'user'

/**
 * What /api/models answers: the models found so far and how the search went, so the page can say where it looked.
 * `scope` is missing when the models were named with --dir, so nothing was searched.
 */
export type ModelList = {
  models: ModelInfo[]
  scope?: { root: string; depth: number; broad?: 'drive' | 'home' }
  state: 'scanning' | 'done'
  /** How many folders the search has looked in. */
  looked: number
  stoppedBy?: StoppedBy
  /** A deeper search could find more: the last one stopped early or left folders unopened, and it was not already the deeper one. */
  canDeepen: boolean
  deeper: boolean
}

/** One row of the folder view: a folder on the way to a model, which is also a model itself when `model` is set. */
export type FolderNode = { name: string; path: string; model?: ModelInfo; children: FolderNode[] }

/** The folders a model sits in, from the searched folder down. A model is the `flowy` folder inside its place, so that folder is left off. */
const placeOf = (m: ModelInfo): string[] => {
  const parts = m.where === '' ? [] : m.where.split('/')
  return parts[parts.length - 1] === 'flowy' ? parts.slice(0, -1) : parts
}

/**
 * The models as a tree of folders, like a file explorer that shows only what is wanted: a folder is there only when a model sits in it or below it.
 * A model at the top of the searched folder is the first row and the rest hang under it; when there is none the first folders are the top rows.
 * `query` keeps the models whose name or folder contains it, and the folders on the way to them.
 */
export function folderTree(models: ModelInfo[], query = ''): FolderNode[] {
  const q = query.trim().toLowerCase()
  const top: FolderNode = { name: '', path: '', children: [] }
  for (const m of models) {
    if (q !== '' && !`${m.name}/${m.where}`.toLowerCase().includes(q)) continue
    let at = top
    const here: string[] = []
    for (const part of placeOf(m)) {
      here.push(part)
      let next = at.children.find(c => c.name === part)
      if (next === undefined) at.children.push((next = { name: part, path: here.join('/'), children: [] }))
      at = next
    }
    at.model = m
  }
  const sort = (n: FolderNode): FolderNode => ({ ...n, children: n.children.map(sort).sort((a, b) => a.name.localeCompare(b.name)) })
  const sorted = sort(top)
  return sorted.model ? [{ ...sorted, name: sorted.model.name }] : sorted.children
}
