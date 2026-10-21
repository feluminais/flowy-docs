import { useState } from 'react'
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

/** A saved setting, or null when there is none or storage is blocked (private windows, some exported pages). */
export function readPref(key: string): string | null {
  try {
    return store.get(key)
  } catch {
    return null
  }
}

/** Remember a setting, or forget it with undefined. When storage is blocked there is nothing to do: the choice still holds in this page. */
export function writePref(key: string, value: string | undefined): void {
  try {
    if (value === undefined) store.remove(key)
    else store.set(key, value)
  } catch {
    // not remembered
  }
}

/** A setting kept across visits, as state: what was saved last time, else `fallback`; setting it saves it. */
export function usePref(key: string, fallback: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => readPref(key) ?? fallback)
  return [value, next => { setValue(next); writePref(key, next) }]
}
