import type { State } from '../../src/core/state.ts'
import { inlineState } from '../../src/node/export.ts'

export type PageOptions = {
  /** Where the extension's media folder is served from, as `webview.asWebviewUri` writes it, with no trailing slash. */
  assetRoot: string
  /** `webview.cspSource`: the origin the webview loads the extension's files from. */
  cspSource: string
  /** A fresh random value for each page, which the canvas script has to carry to run. */
  nonce: string
  /** What the page shows until the first message. */
  state: State
}

/**
 * The built canvas (`dist/ui/index.html`) as a VS Code webview takes it: its files loaded from the extension's
 * media folder, a policy that lets only the canvas script run and nothing connect anywhere, and the state
 * inlined the way an export does. Throws when `indexHtml` isn't the built canvas.
 */
export function webviewPage(indexHtml: string, { assetRoot, cspSource, nonce, state }: PageOptions): string {
  if (!/<script\b[^>]*\bsrc="\.\/assets\//.test(indexHtml)) throw new Error("The built canvas isn't in the extension's media folder. Run: npm run build")
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`, // the canvas positions its shapes with style attributes
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
  ].join('; ')
  // Function replacers, so a `$` in a value isn't read as a replacement pattern.
  const page = indexHtml
    .replace(/(\s(?:src|href)=")\.\/(assets\/[^"]*")/g, (_, start: string, path: string) => `${start}${assetRoot}/${path}`)
    .replace(/<script\b(?=[^>]*\bsrc=)/g, () => `<script nonce="${nonce}"`)
    .replace('<head>', () => `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}">`)
  return inlineState(page, state)
}
