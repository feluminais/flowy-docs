/** The theme a VS Code webview is in, and the maths of reading it. No DOM in here; hosttheme.ts has the page's side. */

export type Theme = 'dark' | 'light'

/**
 * The theme a VS Code webview is in, from the class VS Code keeps on its body, or undefined for any other page.
 * A webview's own `prefers-color-scheme` follows the system, not the editor's theme.
 */
export function themeOf(bodyClass: string): Theme | undefined {
  const names = bodyClass.split(/\s+/)
  if (names.includes('vscode-light') || names.includes('vscode-high-contrast-light')) return 'light'
  if (names.includes('vscode-dark') || names.includes('vscode-high-contrast')) return 'dark'
  return undefined
}
