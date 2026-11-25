/**
 * The editors a page in the browser can open a file in, by the address each one registers with the system (`vscode://file/...`). Only a page the
 * local server serves knows where the repo is on disk, so only it offers them; an exported page has the repository's page alone.
 */
export const EDITORS = [
  { id: 'vscode', name: 'VS Code', scheme: 'vscode' },
  { id: 'cursor', name: 'Cursor', scheme: 'cursor' },
  { id: 'windsurf', name: 'Windsurf', scheme: 'windsurf' },
  { id: 'vscodium', name: 'VSCodium', scheme: 'vscodium' },
  { id: 'zed', name: 'Zed', scheme: 'zed' },
] as const

export type Editor = (typeof EDITORS)[number]

/** The editor saved under `id`, or VS Code for one this list doesn't have. */
export const editorOf = (id: string): Editor => EDITORS.find(e => e.id === id) ?? EDITORS[0]

/** One part of a path made safe for an address, with a drive's colon kept ("M:"), which every one of these editors reads back. */
const part = (p: string) => encodeURIComponent(p).replace(/%3A/gi, ':')

/**
 * The address that opens `path` (a file in the repo as `code` lists it, the line left off) in `editor`, at `line` when there is one. `root` is the folder
 * that holds flowy/, as the server gives it: "M:\\Projects\\shop" or "/home/me/shop".
 */
export function editorUrl(editor: Editor, root: string, path: string, line?: number): string {
  const full = `${root.replace(/\\/g, '/').replace(/\/+$/, '')}/${path}`
  const encoded = full.split('/').map(part).join('/')
  return `${editor.scheme}://file${encoded.startsWith('/') ? '' : '/'}${encoded}${line === undefined ? '' : `:${line}`}`
}
