import { access } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import * as vscode from 'vscode'
import { repoPath } from './paths.ts'

export const exists = (path: string) => access(path).then(() => true, () => false)

/**
 * The flowy/ folders to offer. One at the top of a workspace folder is that repo's docs; only when there is none
 * is the workspace searched deeper, for a monorepo, nearest the top first.
 */
export async function findFolders(): Promise<string[]> {
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

/** The flowy/ folder to work with: the only one, or the one the reader picks. Tells the reader when there is none. */
export async function chooseFolder(): Promise<string | undefined> {
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

/** The flowy/ folder that documents the repo `file` is in: the one nearest the file, when a workspace holds several. */
export async function folderHolding(file: string): Promise<string | undefined> {
  const holding = (await findFolders()).filter(dir => repoPath(dirname(dir), file) !== undefined)
  return holding.sort((a, b) => b.length - a.length)[0]
}
