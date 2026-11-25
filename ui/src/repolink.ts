import { encodePath } from '../../src/core/paths.ts'

/** The repository host `code` paths link to: its name, as its button says it, and the page for a path at a line. */
export type Remote = { name: 'GitHub' | 'GitLab'; page: (path: string, line?: number) => string }

/** The host of `codeBase` (see codeBaseFrom in src/node/git.ts), or undefined when there is none. Both hosts mark a line of a file with #L and its number. */
export function remoteOf(codeBase: string | undefined): Remote | undefined {
  if (!codeBase) return undefined
  const name = new URL(codeBase).hostname === 'gitlab.com' ? 'GitLab' : 'GitHub'
  return { name, page: (path, line) => `${codeBase}${encodePath(path)}${line === undefined ? '' : `#L${line}`}` }
}
