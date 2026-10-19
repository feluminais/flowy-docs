import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { State } from '../src/core/state.ts'
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

const state: State = {
  model: { objects: { shop: { type: 'system', name: 'Shop </script><b>' } }, connections: [], meta: {} },
  layout: {}, flows: {}, problems: [], versions: { 'model.yaml': 'abc' },
}
const options = { assetRoot: 'https://file+.vscode-resource.vscode-cdn.net/ext/media', cspSource: 'https://*.vscode-cdn.net', nonce: 'N0nce', state }

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

test('the page starts with the state in it, and no text in the model can end its script', () => {
  const page = webviewPage(built, options)
  const found = /<script type="application\/json" id="flowy-state">(.*?)<\/script>/s.exec(page)
  assert.ok(found, 'no state in the page')
  assert.deepEqual(JSON.parse(found[1]), state)
  assert.ok(page.indexOf('flowy-state') < page.indexOf('</head>'))
})

test('a page that is not the built canvas is refused', () => {
  assert.throws(() => webviewPage('<html><head></head><body></body></html>', options), /canvas/)
})
