import * as vscode from 'vscode'
import type { Model } from '../../src/core/model.ts'
import { modelOf as modelOfState } from '../../src/core/state.ts'
import type { State } from '../../src/core/state.ts'
import { loadState } from '../../src/node/files.ts'

/** The folder as the canvas reads it. A failure that isn't a broken file (no permission, say) shows as one, so the panel can say so. */
export const stateOf = (dir: string): Promise<State> =>
  loadState(dir).catch((e: unknown) => ({ parseError: { file: dir, message: e instanceof Error ? e.message : String(e) } }))

/** The folder as a model, or undefined, after telling the reader why, when a file in it can't be read. */
export async function modelOf(dir: string): Promise<Model | undefined> {
  const state = await stateOf(dir)
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    void vscode.window.showErrorMessage(`Flowy can't read ${file}${line === undefined ? '' : ` (line ${line})`}: ${message}`)
    return undefined
  }
  return modelOfState(state)
}
