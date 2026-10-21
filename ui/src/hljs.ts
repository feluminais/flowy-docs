import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// The one place that says which languages highlight.js knows here. The canvas imports it, and so does the script that builds the copy the desktop
// app runs (desktop/tools/make-hljs-bundle.ts), so the two colour code with the same grammars.

/** The grammar of highlight.js that colours each of our languages. HTML is XML to it. */
const GRAMMARS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  typescript, javascript, json, yaml, csharp, java, kotlin, python, go, rust, sql, bash, powershell, html: xml, xml, css, dockerfile, markdown, c, cpp, php, ruby, swift,
}
for (const [id, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(id, grammar)

/** The code as the HTML highlight.js writes (text, with `<span class="hljs-keyword">` round stretches), or undefined for a language it has no grammar for. Never throws. */
export function highlightHtml(text: string, language: string): string | undefined {
  if (!hljs.getLanguage(language)) return undefined
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    return undefined
  }
}
