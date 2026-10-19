import { join } from 'node:path'
import * as vscode from 'vscode'
import { goToShapeCommand, openCommand, openFlowCommand, showFileCommand } from './commands.ts'
import { exists, findFolders } from './folders.ts'
import { closeAll, restoreDocs, VIEW_TYPE } from './panel.ts'

/** Tell VS Code whether this workspace has Flowy docs, so the menus that need them show only then. */
async function updateContext(): Promise<void> {
  await vscode.commands.executeCommand('setContext', 'flowy.hasDocs', (await findFolders()).length > 0)
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('flowy.open', () => openCommand(context)),
    vscode.commands.registerCommand('flowy.openFlow', () => openFlowCommand(context)),
    vscode.commands.registerCommand('flowy.goToShape', () => goToShapeCommand(context)),
    vscode.commands.registerCommand('flowy.showFile', (resource?: vscode.Uri) => showFileCommand(context, resource)),
    // After a restart VS Code brings panels back empty and hands over what their page saved: the folder it showed, and where it was.
    vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      async deserializeWebviewPanel(panel, state: unknown) {
        const folder = (state as { folder?: unknown } | undefined)?.folder
        const ok = typeof folder === 'string' && vscode.workspace.getWorkspaceFolder(vscode.Uri.file(folder)) !== undefined && await exists(join(folder, 'model.yaml'))
        if (ok) await restoreDocs(context, panel, folder)
        else panel.dispose() // the folder is gone, or is no longer in this workspace
      },
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void updateContext()),
    { dispose: closeAll },
  )
  void updateContext()
}
