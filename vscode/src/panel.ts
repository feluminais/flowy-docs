import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import * as vscode from 'vscode'
import { changedMessage, pathToOpen, requestOf, responseMessage, revealMessage, textToCopy } from '../../src/core/host.ts'
import type { Request, Target } from '../../src/core/host.ts'
import { applyWrite } from '../../src/node/writes.ts'
import { webviewPage } from './page.ts'
import { repoFile } from './paths.ts'
import { stateOf } from './state.ts'

/** The kind of panel the extension makes, which VS Code remembers across restarts. */
export const VIEW_TYPE = 'flowy.docs'

/** A panel that is showing a folder. */
export type Docs = {
  /** Ask the canvas to show a shape or a flow. Held back until the page has loaded, so asking right after opening is safe. */
  reveal: (target: Target) => void
}

/** The panels that are open, by the folder they show, so a second command reveals the one there is. */
const open = new Map<string, { panel: vscode.WebviewPanel; docs: Docs }>()

/** What the canvas asked for: the folder's State, or a write, answered the way the local server answers it. */
async function answer(dir: string, request: Request): Promise<unknown> {
  if (request.op === 'state') return stateOf(dir)
  return applyWrite(dir, request.method, request.file, request.body)
}

/** Open a path in the repo (a shape's `code`) in the editor, beside the panel; a folder is shown in the Explorer. */
async function openPath(dir: string, path: string): Promise<void> {
  const file = repoFile(dirname(dir), path)
  if (!file) return void vscode.window.showWarningMessage(`Flowy: "${path}" is not a path inside the repo.`)
  const uri = vscode.Uri.file(file)
  let type: vscode.FileType
  try {
    type = (await vscode.workspace.fs.stat(uri)).type
  } catch {
    return void vscode.window.showWarningMessage(`Flowy: ${path} doesn't exist.`)
  }
  if (type & vscode.FileType.Directory) await vscode.commands.executeCommand('revealInExplorer', uri)
  else await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside })
}

/** The built canvas the extension carries, or undefined, after saying what to do, when it isn't there. */
async function loadCanvas(context: vscode.ExtensionContext): Promise<{ media: vscode.Uri; index: string } | undefined> {
  const media = vscode.Uri.joinPath(context.extensionUri, 'media')
  try {
    return { media, index: await readFile(join(media.fsPath, 'index.html'), 'utf8') }
  } catch {
    void vscode.window.showErrorMessage("Flowy: the canvas isn't in the extension. Run npm run build:vscode in the flowy-docs repo.")
    return undefined
  }
}

const titleOf = (dir: string) => `Flowy: ${basename(dirname(dir))}`

/** Fill `panel` with the canvas for the folder `dir`, and keep it talking to the folder until it closes. */
function attach(panel: vscode.WebviewPanel, dir: string, canvas: { media: vscode.Uri; index: string }): Docs {
  panel.webview.html = webviewPage(canvas.index, {
    assetRoot: panel.webview.asWebviewUri(canvas.media).toString(),
    cspSource: panel.webview.cspSource,
    nonce: randomBytes(16).toString('hex'),
    folder: dir,
  })

  // The page can only hear a request once it has loaded, and its first request is the State, so that marks it ready.
  let ready = false
  const waiting: Target[] = []
  const send = (target: Target) => void panel.webview.postMessage(revealMessage(target))
  const docs: Docs = { reveal: target => (ready ? send(target) : void waiting.push(target)) }
  open.set(dir, { panel, docs })

  // What the canvas asks of the editor: the folder's State, a write (its edits), a path to open, and text to copy (its Mermaid button).
  panel.webview.onDidReceiveMessage(async (message: unknown) => {
    const text = textToCopy(message)
    if (text !== undefined) return void vscode.env.clipboard.writeText(text)
    const path = pathToOpen(message)
    if (path !== undefined) return void openPath(dir, path)
    const asked = requestOf(message)
    if (!asked) return
    try {
      await panel.webview.postMessage(responseMessage(asked.id, { value: await answer(dir, asked.request) }))
    } catch (e) {
      // Not a refused write (that is an answer with its own status) but something the disk or the editor did: the page shows the message.
      await panel.webview.postMessage(responseMessage(asked.id, { error: e instanceof Error ? e.message : String(e) }))
    }
    if (asked.request.op === 'state' && !ready) {
      ready = true
      waiting.splice(0).forEach(send)
    }
  })

  // Every save, from this editor, the app, the canvas or Claude, tells the canvas to read the folder again. A burst of events is one.
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, '**'))
  let timer: ReturnType<typeof setTimeout> | undefined
  const changed = (file: vscode.Uri) => {
    if (file.fsPath.endsWith('.tmp')) return // saveFile's temp files; the rename that follows is reported on its own
    clearTimeout(timer)
    timer = setTimeout(() => void panel.webview.postMessage(changedMessage()), 100)
  }
  watcher.onDidChange(changed)
  watcher.onDidCreate(changed)
  watcher.onDidDelete(changed)
  panel.onDidDispose(() => {
    clearTimeout(timer)
    watcher.dispose()
    if (open.get(dir)?.panel === panel) open.delete(dir)
  })
  return docs
}

/** Show the folder `dir` in a panel: the one that is already open for it, or a new one. */
export async function openDocs(context: vscode.ExtensionContext, dir: string): Promise<Docs | undefined> {
  const shown = open.get(dir)
  if (shown) {
    shown.panel.reveal()
    return shown.docs
  }
  const canvas = await loadCanvas(context)
  if (!canvas) return undefined
  // The canvas keeps its place (view, flow, selection, undo) in the page, so a hidden panel is kept alive rather than rebuilt.
  const panel = vscode.window.createWebviewPanel(VIEW_TYPE, titleOf(dir), vscode.ViewColumn.Active, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [canvas.media],
  })
  return attach(panel, dir, canvas)
}

/** Take a panel VS Code brings back after a restart, which shows the folder `dir`. The page restores where the reader was from its own saved state. */
export async function restoreDocs(context: vscode.ExtensionContext, panel: vscode.WebviewPanel, dir: string): Promise<void> {
  const canvas = await loadCanvas(context)
  if (!canvas || open.has(dir)) return panel.dispose() // the same folder is already open in another panel
  panel.webview.options = { enableScripts: true, localResourceRoots: [canvas.media] }
  panel.title = titleOf(dir)
  attach(panel, dir, canvas)
}

/** Close every panel, when the extension goes. */
export function closeAll(): void {
  for (const { panel } of [...open.values()]) panel.dispose()
}
