import { encodePath } from '../../src/core/paths.ts'

/**
 * Where a path in the repo leads: `href` is the repo host's page for it, when the origin has one; `editor` is whether the page can ask the
 * editor to open it; `anchor` is the address the link itself carries. In the editor that is never `href`: the webview sends any anchor's
 * address to the browser, whatever the page does with the click, so the page sends the repo host's page by message instead.
 */
export type RepoLink = { href?: string; editor: boolean; anchor: string; title: string }

/** What a click may carry that changes where it goes. */
export type Modifiers = { ctrlKey: boolean; metaKey: boolean }

/**
 * The link a path in the repo is, or undefined when it leads nowhere and is plain text. With an editor to ask (the VS Code webview) it
 * opens there, and with Ctrl or Cmd held opens the repo host's page instead, when there is one; the title says both. Without one it is the repo host's page.
 */
export function repoLink(path: string, codeBase: string | undefined, editor: boolean): RepoLink | undefined {
  const href = codeBase ? codeBase + encodePath(path) : undefined
  if (editor) return { ...(href ? { href } : {}), editor, anchor: '#', title: href ? 'Open in the editor (Ctrl/Cmd-click: open the repository page)' : 'Open in the editor' }
  return href ? { href, editor, anchor: href, title: 'Open the repository page' } : undefined
}

/** Whether a click on `link` goes to the editor rather than the page's href: every click does, except Ctrl or Cmd where there is a page to go to. */
export const opensEditor = (link: RepoLink, { ctrlKey, metaKey }: Modifiers): boolean => link.editor && !(link.href && (ctrlKey || metaKey))
