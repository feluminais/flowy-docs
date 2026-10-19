import { basename, dirname } from 'node:path'
import * as vscode from 'vscode'
import { flowChoices, shapeChoices, shapesFor } from '../../src/core/finder.ts'
import { chooseFolder, folderHolding } from './folders.ts'
import { openDocs } from './panel.ts'
import { repoPath } from './paths.ts'
import { modelOf } from './state.ts'

/** Flowy: Open Docs. */
export async function openCommand(context: vscode.ExtensionContext): Promise<void> {
  const dir = await chooseFolder()
  if (dir !== undefined) await openDocs(context, dir)
}

/** Flowy: Open Flow…, pick one of the flows and play it on the canvas. */
export async function openFlowCommand(context: vscode.ExtensionContext): Promise<void> {
  const dir = await chooseFolder()
  const model = dir === undefined ? undefined : await modelOf(dir)
  if (dir === undefined || !model) return
  const choices = flowChoices(model)
  if (choices.length === 0) return void vscode.window.showInformationMessage('Flowy: there are no flows to play yet.')
  const picked = await vscode.window.showQuickPick(
    choices.map(c => ({ label: c.name, description: c.where, detail: `${c.steps} ${c.steps === 1 ? 'step' : 'steps'}`, id: c.id })),
    { placeHolder: 'Which flow?', matchOnDescription: true },
  )
  if (picked) (await openDocs(context, dir))?.reveal({ flow: picked.id })
}

/** Flowy: Go to Shape…, pick any shape and see it where it is drawn. */
export async function goToShapeCommand(context: vscode.ExtensionContext): Promise<void> {
  const dir = await chooseFolder()
  const model = dir === undefined ? undefined : await modelOf(dir)
  if (dir === undefined || !model) return
  const choices = shapeChoices(model)
  if (choices.length === 0) return void vscode.window.showInformationMessage('Flowy: there are no shapes yet.')
  const picked = await vscode.window.showQuickPick(
    choices.map(c => ({ label: c.name, description: `${c.type} · ${c.where}`, id: c.id })),
    { placeHolder: 'Which shape?', matchOnDescription: true },
  )
  if (picked) (await openDocs(context, dir))?.reveal({ shape: picked.id })
}

/**
 * Flowy: Show This File in the Docs. The file is the one clicked in the Explorer or the editor, or else the one being edited.
 * It is shown on the shape whose `code` lists it (or the folder it is in); when two shapes list it equally, the reader picks.
 */
export async function showFileCommand(context: vscode.ExtensionContext, resource?: vscode.Uri): Promise<void> {
  const uri = resource ?? vscode.window.activeTextEditor?.document.uri
  if (!uri || uri.scheme !== 'file') return void vscode.window.showInformationMessage('Flowy: open a file in the repo first.')
  const dir = await folderHolding(uri.fsPath)
  const path = dir === undefined ? undefined : repoPath(dirname(dir), uri.fsPath)
  if (dir === undefined || path === undefined) return void vscode.window.showInformationMessage(`Flowy: no flowy/ folder documents ${basename(uri.fsPath)}.`)
  const model = await modelOf(dir)
  if (!model) return
  const ids = shapesFor(model, path)
  if (ids.length === 0) return void vscode.window.showInformationMessage(`Flowy: no shape lists ${path}. Add it to a shape's code in the docs.`)
  let id = ids[0]
  if (ids.length > 1) {
    const choices = shapeChoices(model).filter(c => ids.includes(c.id))
    const picked = await vscode.window.showQuickPick(
      choices.map(c => ({ label: c.name, description: `${c.type} · ${c.where}`, id: c.id })),
      { placeHolder: `${path} is listed by more than one shape. Which one?` },
    )
    if (!picked) return
    id = picked.id
  }
  ;(await openDocs(context, dir))?.reveal({ shape: id })
}
