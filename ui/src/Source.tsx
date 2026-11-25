import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { codeRefsOf } from '../../src/core/code.ts'
import type { CodeRef } from '../../src/core/code.ts'
import { Section } from './Chrome.tsx'
import { Dropdown } from './Dropdown.tsx'
import { EDITORS, editorOf, editorUrl } from './editors.ts'
import type { Editor } from './editors.ts'
import { Field } from './forms.tsx'
import { hostFolder, openInBrowser, openInEditor, vscode } from './host.ts'
import { File, FileCode, Folder, GitHub, GitLab } from './icons.tsx'
import { remoteOf } from './repolink.ts'
import type { Remote } from './repolink.ts'
import { usePref } from './store.ts'

/** The words a reader sees on the buttons, the picker and the edit field of a path. One name per thing: the desktop app says the same. */
export const SOURCE_WORDS = {
  title: 'Source',
  open: 'Open',
  side: 'Right-click: Open to the side',
  editor: 'Editor',
  field: 'Files and folders (one per line)',
  example: 'src/api/orders.ts:42',
}

/** What the editor button does on this page: the VS Code panel's own editor, an editor the system opens by address, or there is none. */
type Opener = { kind: 'host'; folder?: string } | { kind: 'address'; editor: Editor; root: string } | undefined

type Source = { opener: Opener; remote?: Remote; editor: Editor; pick?: (id: string) => void }

const SourceContext = createContext<Source>({ opener: undefined, editor: EDITORS[0] })

/**
 * Where the page can open a path from. `codeBase` is the repository's page for the folder that holds flowy/ (GitHub or GitLab). `codeRoot` is that
 * folder on disk, which only the local server gives (an exported page never carries it), so only that page offers an editor. In VS Code the panel's
 * own editor opens it. The editor picked is kept across visits.
 */
export function SourceProvider({ codeBase, codeRoot, children }: { codeBase?: string; codeRoot?: string; children: ReactNode }) {
  const [picked, pick] = usePref('code-editor', EDITORS[0].id)
  const value = useMemo<Source>(() => {
    const editor = editorOf(picked)
    const opener: Opener = vscode ? { kind: 'host', folder: hostFolder() } : codeRoot ? { kind: 'address', editor, root: codeRoot } : undefined
    return { opener, remote: remoteOf(codeBase), editor, pick }
    // `pick` is new each render but always does the same thing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, codeBase, codeRoot])
  return <SourceContext.Provider value={value}>{children}</SourceContext.Provider>
}

const RemoteIcon = ({ remote }: { remote: Remote }) => (remote.name === 'GitLab' ? <GitLab size={14} /> : <GitHub size={14} />)

/** The buttons that open one path here: Open in VS Code, the picked editor on a page the local server serves, and GitHub or GitLab. None when there is nowhere to open it. */
export function OpenButtons({ at }: { at: CodeRef }) {
  const { opener, remote } = useContext(SourceContext)
  const folder = at.path.endsWith('/')
  const page = remote?.page(at.path, at.line)
  const line = at.line === undefined ? {} : { line: at.line }
  return (
    <span className="source-open">
      {opener?.kind === 'host' && (
        <button type="button" title={folder ? undefined : SOURCE_WORDS.side} onClick={() => openInEditor(at.path, line)}><FileCode size={14} />{SOURCE_WORDS.open}</button>
      )}
      {opener?.kind === 'address' && !folder && (
        <a className="button" href={editorUrl(opener.editor, opener.root, at.path, at.line)}><FileCode size={14} />{opener.editor.name}</a>
      )}
      {remote && page && (vscode
        // A webview hands any anchor's address to the browser itself, so in VS Code the page asks the extension to open it instead.
        ? <button type="button" onClick={() => openInBrowser(page)}><RemoteIcon remote={remote} />{remote.name}</button>
        : <a className="button" href={page} target="_blank" rel="noreferrer"><RemoteIcon remote={remote} />{remote.name}</a>)}
    </span>
  )
}

/**
 * What a right-click on a row hands VS Code, which opens its own menu with Open and Open to the side (vscode/package.json, webview/context): the folder
 * the panel shows and the path. Undefined on any other page.
 */
export function useRowContext(at: CodeRef): string | undefined {
  const { opener } = useContext(SourceContext)
  if (opener?.kind !== 'host' || !opener.folder) return undefined
  return JSON.stringify({ webviewSection: 'codePath', folder: opener.folder, path: at.path, ...(at.line === undefined ? {} : { line: at.line }) })
}

function Row({ at }: { at: CodeRef }) {
  return (
    <li data-vscode-context={useRowContext(at)}>
      {at.path.endsWith('/') ? <Folder size={16} /> : <File size={16} />}
      <code className="source-path">{at.path}{at.line !== undefined && <span className="muted">:{at.line}</span>}</code>
      <OpenButtons at={at} />
    </li>
  )
}

/**
 * The paths a `code` list holds, each as text with the buttons that open it (see OpenButtons), under a Source heading, or none with `bare` (under a
 * step, which already says what it is). The editor picker sits under a list in a panel; the player's card leaves it out (`inCard`) to keep its size.
 * Anything in the list that is not a path is left to the problem list. Nothing at all for an empty list.
 */
export function SourceList({ code, title = SOURCE_WORDS.title, bare, inCard }: { code: unknown; title?: string; bare?: boolean; inCard?: boolean }) {
  const { opener, editor, pick } = useContext(SourceContext)
  const refs = codeRefsOf(code)
  if (refs.length === 0) return null
  return (
    <section className={bare ? 'source-list bare' : 'source-list'} aria-label={title}>
      {!bare && <Section icon={Folder} title={title} count={refs.length} />}
      <ul className="code-list">
        {refs.map((r, i) => <Row key={i} at={r} />)}
      </ul>
      {!bare && !inCard && opener?.kind === 'address' && pick && refs.some(r => !r.path.endsWith('/')) && (
        <div className="source-editor">
          <span className="muted" aria-hidden="true">{SOURCE_WORDS.editor}</span>
          <Dropdown label={SOURCE_WORDS.editor} title={SOURCE_WORDS.editor} options={EDITORS.map(e => [e.id, e.name])} value={editor.id} onChange={pick} />
        </div>
      )}
    </section>
  )
}

/** The edit field of a `code` list: one path per line, `path:line` for a line of a file. A blank line is no path; an empty field takes the list off. */
export function SourceField({ code, onSave }: { code: unknown; onSave: (code: string[]) => Promise<boolean> }) {
  const text = Array.isArray(code) ? code.filter((c): c is string => typeof c === 'string').join('\n') : ''
  return <Field label={SOURCE_WORDS.field} value={text} multiline placeholder={SOURCE_WORDS.example} onSave={value => onSave(value.split('\n').map(line => line.trim()).filter(Boolean))} />
}
