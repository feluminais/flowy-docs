import { openMessage } from '../../src/core/host.ts'

/** The API VS Code gives a webview's page, which can be asked for once. */
type VsCodeApi = { postMessage: (message: unknown) => void; getState: () => unknown; setState: (state: unknown) => void }
declare function acquireVsCodeApi(): VsCodeApi

/** The way to talk to the VS Code extension that embeds this page, or undefined on any other page. */
export const vscode: VsCodeApi | undefined = 'acquireVsCodeApi' in window ? acquireVsCodeApi() : undefined

/**
 * What a webview keeps for its page: VS Code holds it while the panel is hidden and hands it back when the panel is restored
 * (after the editor restarts, say). `folder` is the flowy/ folder the panel shows, so a restored panel knows which one; `hash` is
 * the address (see hash.ts); `prefs` are the reader's own settings, which `localStorage` would lose, being new each time a webview opens.
 */
type PageState = { folder?: string; hash?: string; prefs?: Record<string, string> }

export function savedState(): PageState {
  const state = vscode?.getState()
  return typeof state === 'object' && state !== null ? (state as PageState) : {}
}

/** Keep `patch` with the rest of the page's state. A page outside VS Code keeps nothing here. */
export function saveState(patch: Partial<PageState>): void {
  if (!vscode) return
  const before = savedState()
  const next = { ...before, ...patch }
  if (JSON.stringify(next) !== JSON.stringify(before)) vscode.setState(next)
}

/**
 * Called once as the page starts. The extension names the folder in the page; keep it, so a panel VS Code restores knows
 * which folder it was showing. A restored panel opens where the reader was: the saved address is put back unless one was given.
 */
export function startFromSavedState(): void {
  if (!vscode) return
  const folder = document.querySelector('meta[name="flowy-folder"]')?.getAttribute('content')
  if (folder) saveState({ folder })
  const { hash } = savedState()
  if (!location.hash && hash && /^#[a-z0-9/-]+$/.test(hash)) history.replaceState(null, '', hash)
}

/** Open a path in the repo in the editor, if this page is in VS Code. Resolves to whether there is an editor to ask. */
export function openInEditor(path: string): boolean {
  if (!vscode) return false
  vscode.postMessage(openMessage(path))
  return true
}
