import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { encodePath } from '../core/paths.ts'

const run = promisify(execFile)

/**
 * The web address `code` paths link to, from the origin's URL, the branch (or commit) and the folder's
 * place in the repo (`git rev-parse --show-prefix`, "" at the top). Only github.com and gitlab.com.
 */
export function codeBaseFrom(remote: string, branch: string, prefix: string): string | undefined {
  const found = /^(?:https:\/\/(?:[^@/]+@)?|git@|ssh:\/\/git@)(github\.com|gitlab\.com)[:/](.+?)(?:\.git)?\/?$/.exec(remote.trim())
  if (!found) return undefined
  const [, host, repo] = found
  return `https://${host}/${repo}/${host === 'gitlab.com' ? '-/' : ''}tree/${encodePath(branch)}/${encodePath(prefix)}`
}

// Known limit: worked out once per folder per process, so a branch switch or a new origin shows after a restart; drop the cache if that bites.
const bases = new Map<string, Promise<string | undefined>>()

/** Where `code` paths under `root` link to, or undefined when git or the remote can't say. */
export function codeBase(root: string): Promise<string | undefined> {
  let base = bases.get(root)
  if (!base) {
    const git = async (...args: string[]) => (await run('git', ['-C', root, ...args], { timeout: 5000 })).stdout.trim()
    base = (async () => {
      try {
        const branch = await git('rev-parse', '--abbrev-ref', 'HEAD')
        return codeBaseFrom(await git('remote', 'get-url', 'origin'), branch === 'HEAD' ? await git('rev-parse', 'HEAD') : branch, await git('rev-parse', '--show-prefix'))
      } catch {
        return undefined // not a repo, no origin, or no git
      }
    })()
    bases.set(root, base)
  }
  return base
}
