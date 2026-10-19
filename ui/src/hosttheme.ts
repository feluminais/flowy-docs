import { useSyncExternalStore } from 'react'
import { vscode } from './host.ts'
import { themeOf } from './theme.ts'
import type { Theme } from './theme.ts'

let current: Theme | undefined
const listeners = new Set<() => void>()

/**
 * In a VS Code webview, mark the page with the editor's theme (`data-theme` on <html>, which style.css reads)
 * and keep it marked as the theme changes. Anywhere else the page follows the system and this does nothing.
 */
export function followHostTheme() {
  if (!vscode) return
  const apply = () => {
    current = themeOf(document.body.className)
    if (current) document.documentElement.dataset.theme = current
    else delete document.documentElement.dataset.theme
    listeners.forEach(listener => listener())
  }
  apply()
  new MutationObserver(apply).observe(document.body, { attributes: true, attributeFilter: ['class'] })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The colour mode React Flow draws its own controls in: the host's theme, or the system's. */
export const useColorMode = (): Theme | 'system' => useSyncExternalStore(subscribe, () => current ?? 'system')
