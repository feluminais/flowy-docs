import { readdir, stat } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'

/** One model folder a repo holds. `id` and `where` are its path from the repo root, with `/`; `name` is what a switcher shows. */
export type ModelEntry = { id: string; name: string; where: string; dir: string }

/** Folders a model is never looked for in: dependencies, build output and the repo's own bookkeeping. */
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'out', 'bin', 'obj', 'target', 'vendor', 'coverage'])
const DEEPEST = 5

/** The model folder at `dir` as an entry: named for the repo folder or system it sits in, like the desktop app's window titles. */
export function entryOf(root: string, dir: string): ModelEntry {
  const full = resolve(dir)
  const where = relative(resolve(root), full).split(sep).join('/')
  const parent = basename(resolve(full, '..'))
  return { id: where, name: basename(full) === 'flowy' && parent !== '' ? parent : basename(full), where, dir: full }
}

/**
 * Every model folder under `root`: a folder called `flowy` that holds a model.yaml, nearest the top first, then by path.
 * Hidden folders and the ones in SKIPPED are not searched, nor deeper than DEEPEST levels. Empty when there is none.
 */
export async function findModels(root: string): Promise<ModelEntry[]> {
  const found: ModelEntry[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let names: import('node:fs').Dirent[]
    try {
      names = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of names) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
      const child = join(dir, entry.name)
      if (entry.name === 'flowy' && (await stat(join(child, 'model.yaml')).then(s => s.isFile(), () => false))) found.push(entryOf(root, child))
      else if (depth < DEEPEST) await walk(child, depth + 1)
    }
  }
  await walk(resolve(root), 1)
  const depth = (e: ModelEntry) => e.where.split('/').length
  return found.sort((a, b) => depth(a) - depth(b) || a.where.localeCompare(b.where))
}
