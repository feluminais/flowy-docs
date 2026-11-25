import { linksOf } from '../../src/core/model.ts'
import type { FlowyObject, Link } from '../../src/core/model.ts'
import { isRepoPath, isWebAddress } from '../../src/core/paths.ts'
import { Section } from './Chrome.tsx'
import { Link as LinkIcon } from './icons.tsx'
import { OpenButtons, useRowContext } from './Source.tsx'

/** A link that is a path in the repo: its title as text, then the buttons that open the path, as a path under Source has. */
function RepoLinkRow({ link }: { link: Link }) {
  return (
    <li data-vscode-context={useRowContext({ path: link.url })}>
      <LinkIcon size={16} />
      <span>{link.title || link.url}</span>
      {link.title && <code className="muted">{link.url}</code>}
      <OpenButtons at={{ path: link.url }} />
    </li>
  )
}

/**
 * The links an object lists. A web address opens in a new tab. A path in the repo is its title with the buttons that open it (see OpenButtons);
 * check() reports one that doesn't exist. Anything else in `links` is left to the problem list.
 */
export function LinkList({ object }: { object: FlowyObject }) {
  const links = linksOf(object)
  if (links.length === 0) return null
  return (
    <section className="link-list" aria-label="Links">
      <Section icon={LinkIcon} title="Links" count={links.length} />
      <ul>
        {links.map((l, i) => {
          if (!isWebAddress(l.url) && isRepoPath(l.url)) return <RepoLinkRow key={i} link={l} />
          const web = isWebAddress(l.url)
          const text = l.title || l.url
          return (
            <li key={i}>
              <LinkIcon size={16} />
              {web ? <a href={l.url} target="_blank" rel="noreferrer">{text}</a> : <span>{text}</span>}
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
