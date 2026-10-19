import { randomBytes } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import * as vscode from 'vscode'
import { textToCopy } from '../../src/core/host.ts'
import { stateMessage } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { loadState } from '../../src/node/files.ts'
import { webviewPage } from './page.ts'

const exists = (path: string) => access(path).then(() => true, () => false)

/** The folder as the canvas reads it. A failure that isn't a broken file (no permission, say) shows as one, so the panel can say so. */
const stateOf = (dir: string): Promise<State> =>
  loadState(dir).catch((e: unknown) => ({ parseError: { file: dir, message: e instanceof Error ? e.message : String(e) } }))

/**
 * The flowy/ folders to offer. One at the top of a workspace folder is that repo's docs; only when there is none
 * is the workspace searched deeper, for a monorepo, nearest the top first.
 */
async function findFolders(): Promise<string[]> {
  const top: string[] = []
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const dir = join(folder.uri.fsPath, 'flowy')
    if (await exists(join(dir, 'model.yaml'))) top.push(dir)
  }
  if (top.length > 0) return top
  const found = await vscode.workspace.findFiles('**/flowy/model.yaml', '**/node_modules/**', 100)
  const depth = (dir: string) => dir.split(sep).length
  return found.map(file => dirname(file.fsPath)).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
}

async function chooseFolder(): Promise<string | undefined> {
  const folders = await findFolders()
  if (folders.length === 0) {
    void vscode.window.showInformationMessage('No flowy/ folder with a model.yaml in this workspace. Ask Claude to map the repo into Flowy, or add one by hand.')
    return undefined
  }
  if (folders.length === 1) return folders[0]
  const picked = await vscode.window.showQuickPick(
    folders.map(dir => ({ label: vscode.workspace.asRelativePath(dir), dir })),
    { placeHolder: 'Which flowy/ folder?' },
  )
  return picked?.dir
}

/** The panels that are open, by the folder they show, so a second command reveals the one there is. */
const panels = new Map<string, vscode.WebviewPanel>()

async function openDocs(context: vscode.ExtensionContext) {
  const dir = await chooseFolder()
  if (dir === undefined) return
  const shown = panels.get(dir)
  if (shown) return shown.reveal()

  const media = vscode.Uri.joinPath(context.extensionUri, 'media')
  let index: string
  try {
    index = await readFile(join(media.fsPath, 'index.html'), 'utf8')
  } catch {
    void vscode.window.showErrorMessage("Flowy: the canvas isn't in the extension. Run npm run build:vscode in the flowy-docs repo.")
    return
  }

  // The canvas keeps its place (view, flow, selection) in the page, so a hidden panel is kept alive rather than rebuilt.
  const panel = vscode.window.createWebviewPanel('flowy.docs', `Flowy: ${basename(dirname(dir))}`, vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [media],
  })
  panels.set(dir, panel)
  panel.webview.html = webviewPage(index, {
    assetRoot: panel.webview.asWebviewUri(media).toString(),
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
    state: await stateOf(dir),
  })

  // What the canvas asks of the editor: for now, only to copy text (its Mermaid button).
  panel.webview.onDidReceiveMessage((message: unknown) => {
    const text = textToCopy(message)
    if (text !== undefined) void vscode.env.clipboard.writeText(text)
  })

  // Every save, from this editor, the app or Claude, shows on the canvas. A burst of events is one read.
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '**'))
  let timer: ReturnType<typeof setTimeout> | undefined
  let latest = 0
  const changed = (file: vscode.Uri) => {
    if (file.fsPath.endsWith('.tmp')) return // saveFile's temp files; the rename that follows is reported on its own
    clearTimeout(timer)
    timer = setTimeout(async () => {
      const call = ++latest
      const state = await stateOf(dir)
      if (call === latest) void panel.webview.postMessage(stateMessage(state))
    }, 100)
  }
  watcher.onDidChange(changed)
  watcher.onDidCreate(changed)
  watcher.onDidDelete(changed)
  panel.onDidDispose(() => {
    clearTimeout(timer)
    latest++ // a read still running has nowhere to go
    watcher.dispose()
    panels.delete(dir)
  })
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowy.open', () => openDocs(context)),
    { dispose: () => [...panels.values()].forEach(panel => panel.dispose()) },
  )
}
