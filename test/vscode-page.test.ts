import { test } from 'node:test'
import assert from 'node:assert/strict'
import { webviewPage } from '../vscode/src/page.ts'

/** What `vite build` writes for the canvas, with the file names it picks. */
const built = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Flowy Docs</title>
    <script type="module" crossorigin src="./assets/index-ABC.js"></script>
    <link rel="stylesheet" crossorigin href="./assets/index-XYZ.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

const options = { assetRoot: 'https://file+.vscode-resource.vscode-cdn.net/ext/media', cspSource: 'https://*.vscode-cdn.net', nonce: 'N0nce', folder: 'M:\work\shop\flowy' }

test("the canvas's files load from the extension's media folder", () => {
  const page = webviewPage(built, options)
  assert.ok(page.includes('src="https://file+.vscode-resource.vscode-cdn.net/ext/media/assets/index-ABC.js"'))
  assert.ok(page.includes('href="https://file+.vscode-resource.vscode-cdn.net/ext/media/assets/index-XYZ.css"'))
  assert.ok(!page.includes('"./assets/'))
})

test('only the canvas script runs, and nothing else can load or connect', () => {
  const page = webviewPage(built, options)
  assert.ok(page.includes('<script nonce="N0nce" type="module"'), 'the canvas script has the nonce')
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(page)?.[1]
  assert.ok(csp, 'no Content-Security-Policy')
  const rules = Object.fromEntries(csp.split(';').map(r => r.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
  assert.deepEqual(rules['default-src'], ["'none'"])
  assert.deepEqual(rules['script-src'], ["'nonce-N0nce'"])
  assert.deepEqual(rules['style-src'], ['https://*.vscode-cdn.net', "'unsafe-inline'"]) // the canvas positions its shapes with style attributes
  assert.deepEqual(rules['img-src'], ['https://*.vscode-cdn.net', 'data:'])
  assert.equal(rules['connect-src'], undefined)
})

test('the page carries no model: the canvas asks the extension for it', () => {
  assert.ok(!webviewPage(built, options).includes('flowy-state'))
})

/** What the page's script finds: the folder named in its <meta>, read back the way a browser would. */
const folderIn = (page: string) => /<meta name="flowy-folder" content="([^"]*)">/.exec(page)?.[1]
  ?.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

test('the page names its folder, so a panel VS Code restores knows which one it showed', () => {
  assert.equal(folderIn(webviewPage(built, options)), 'M:\work\shop\flowy')
})

test('a folder name cannot break out of the attribute that carries it', () => {
  const folder = '/tmp/a"><script>alert(1)</script>&x'
  const page = webviewPage(built, { ...options, folder })
  assert.equal(folderIn(page), folder)
  assert.ok(!page.includes('<script>alert'))
})

test('a page that is not the built canvas is refused', () => {
  assert.throws(() => webviewPage('<html><head></head><body></body></html>', options), /canvas/)
})
