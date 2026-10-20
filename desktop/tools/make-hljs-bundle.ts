// Writes desktop/Flowy.App/Assets/hljs.js: highlight.js with the languages of ui/src/hljs.ts, in one minified script that the desktop app
// runs in-process (Jint), so a snippet is coloured the same in both readers. Run from the repo root after changing ui/src/hljs.ts or
// highlight.js: node desktop/tools/make-hljs-bundle.ts
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

/** The text of hljs.js. A test compares it with the file, so the copy the app runs is always the one the canvas would draw with. */
export async function renderHljsBundle(): Promise<string> {
  const bundle = await rolldown({ input: fileURLToPath(new URL('./hljs-entry.ts', import.meta.url)), logLevel: 'silent' })
  const { output } = await bundle.generate({ format: 'iife', minify: true, comments: { legal: false } })
  await bundle.close()
  return `${output[0].code.trim()}\n`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const code = await renderHljsBundle()
  writeFileSync(new URL('../Flowy.App/Assets/hljs.js', import.meta.url), code)
  console.log(`wrote ${code.length} bytes`)
}
