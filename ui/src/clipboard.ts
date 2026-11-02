import { copyMessage } from '../../src/core/host.ts'
import { vscode } from './host.ts'

/**
 * Puts text on the clipboard: in VS Code the editor writes it (a webview can't count on the clipboard API, which wants the page focused),
 * anywhere else the page does. False when the browser blocked it.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (vscode) vscode.postMessage(copyMessage(text))
    else await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
