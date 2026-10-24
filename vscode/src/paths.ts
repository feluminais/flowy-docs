import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isRepoPath } from '../../src/core/paths.ts'

/** Whether `target` is `root` or somewhere under it, compared as written. */
const isInside = (root: string, target: string) => {
  const rel = relative(root, target)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) // a folder may be called ..cache
}

/** `path` with every link in it followed, as far as it exists; the part that doesn't exist yet stays as written. */
function followed(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(followed(parent), basename(path))
  }
}

/**
 * The place on disk of a path in the repo as a shape's `code` lists it (relative, "/" between folders, a trailing "/" for
 * a folder), or undefined when it isn't such a path or would land outside `root`, the folder that holds flowy/, also through a
 * link inside the repo that points out of it.
 */
export function repoFile(root: string, path: string): string | undefined {
  if (!isRepoPath(path)) return undefined
  const target = resolve(root, ...path.split('/').filter(Boolean))
  return target !== resolve(root) && isInside(root, target) && isInside(followed(root), followed(target)) ? target : undefined
}

/** The path in the repo of a file on disk, with "/" between folders, or undefined when it is outside `root` or is `root`. */
export function repoPath(root: string, file: string): string | undefined {
  const target = resolve(file)
  if (target === resolve(root) || !isInside(root, target)) return undefined
  return relative(root, target).split(/[\\/]/).join('/')
}
