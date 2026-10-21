import type { ReactNode } from 'react'
import { linksOf } from '../../src/core/model.ts'
import type { FlowyObject, Link } from '../../src/core/model.ts'
import { isRepoPath, isWebAddress } from '../../src/core/paths.ts'
import { openInBrowser, openInEditor, vscode } from './host.ts'
import { opensEditor, repoLink } from './repolink.ts'
import { Section } from './Chrome.tsx'
import { Code, File, Folder, Link as LinkIcon } from './icons.tsx'

/**
 * A path in the repo, as the link its text is. In VS Code it opens in the editor (with Ctrl or Cmd held, the repo host's page
 * instead, when there is one, as its tooltip says). Anywhere else it is the repo host's page when the repo is on GitHub or GitLab, and plain text otherwise.
 */
export function RepoPath({ path, codeBase, children }: { path: string; codeBase?: string; children: ReactNode }) {
  const link = repoLink(path, codeBase, vscode !== undefined)
  if (!link) return <span>{children}</span>
  return (
    <a href={link.anchor} target={link.editor ? undefined : '_blank'} rel="noreferrer" title={link.title}
      onClick={link.editor ? e => {
        e.preventDefault()
        if (opensEditor(link, e)) openInEditor(path)
        else if (link.href) openInBrowser(link.href)
      } : undefined}>
      {children}
    </a>
  )
}

/** The paths an object's `code` lists, as links to the editor in VS Code and to the repo host when it is GitHub or GitLab. Anything else in `code` is left to the problem list. */
export function CodeList({ object, codeBase }: { object: FlowyObject; codeBase?: string }) {
  const paths = Array.isArray(object.code) ? object.code.filter((p): p is string => typeof p === 'string') : []
  if (paths.length === 0) return null
  return (
    <>
      <Section icon={Folder} title="Source" count={paths.length} />
      <ul className="code-list" aria-label="Source">
        {paths.map((p, i) => (
          <li key={i}>
            {p.endsWith('/') ? <Folder size={16} /> : <File size={16} />}
            <RepoPath path={p} codeBase={codeBase}><code>{p}</code></RepoPath>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * The links an object lists. A web address opens in a new tab. A path in the repo opens in the editor in VS Code, links to the repo
 * host when the origin is GitHub or GitLab, and is plain text otherwise; check() reports one that doesn't exist. Anything else in `links` is left to the problem list.
 */
export function LinkList({ object, codeBase }: { object: FlowyObject; codeBase?: string }) {
  const links = linksOf(object)
  if (links.length === 0) return null
  return (
    <section className="link-list" aria-label="Links">
      <Section icon={LinkIcon} title="Links" count={links.length} />
      <ul>
        {links.map((l, i) => {
          const web = isWebAddress(l.url)
          const text = l.title || l.url
          return (
            <li key={i}>
              <LinkIcon size={16} />
              {web ? <a href={l.url} target="_blank" rel="noreferrer">{text}</a> : isRepoPath(l.url) ? <RepoPath path={l.url} codeBase={codeBase}>{text}</RepoPath> : <span>{text}</span>}
              {!web && l.title && <code className="muted">{l.url}</code>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export const linkLine = (l: Link) => (l.title ? `${l.title} | ${l.url}` : l.url)

/**
 * One link per line, as "Title | address" or just an address. The last " | " splits, so a title may hold a bar and an address may
 * too. A link keeps the extra keys it had, found by its address.
 */
export function parseLinks(text: string, old: Link[]): Link[] {
  const byUrl = new Map(old.map(l => [l.url, l]))
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const cut = line.lastIndexOf(' | ')
    const title = cut === -1 ? '' : line.slice(0, cut).trim()
    const url = (cut === -1 ? line : line.slice(cut + 3)).trim()
    const { title: _title, url: _url, ...extra } = byUrl.get(url) ?? { url }
    return { ...(title ? { title } : {}), url, ...extra }
  })
}
