import { savedState, saveState, vscode } from './host.ts'

/**
 * The reader's own small settings (line style, panel widths, whether the legend is open). In a browser they live in
 * `localStorage`; in a VS Code webview, in the webview's state, because `localStorage` there is empty again each time a panel
 * opens. Either can throw (storage blocked): callers already catch that.
 */
export const store = {
  get(key: string): string | null {
    return vscode ? (savedState().prefs?.[key] ?? null) : localStorage.getItem(key)
  },
  set(key: string, value: string): void {
    if (vscode) saveState({ prefs: { ...savedState().prefs, [key]: value } })
    else localStorage.setItem(key, value)
  },
  remove(key: string): void {
    if (!vscode) return localStorage.removeItem(key)
    const { [key]: _gone, ...rest } = savedState().prefs ?? {}
    saveState({ prefs: rest })
  },
}
