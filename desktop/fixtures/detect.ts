import { readFileSync } from 'node:fs'
import { guessLanguage } from '../../src/core/detect.ts'
import { highlightHtml } from '../../ui/src/hljs.ts'
import { runsFromHtml } from '../../ui/src/highlight.ts'
import { LANGUAGES } from '../../src/core/snippets.ts'

// What the native app must say about code: which language the cues name (Detect.cs), the HTML highlight.js writes for a snippet (the copy the app
// runs in-process, Hljs.cs), and how that HTML becomes runs (CodeRuns.cs). Every answer is the TypeScript side's.

type Sample = { language: string | null; size: string; text: string }

const read = (name: string): Sample[] => JSON.parse(readFileSync(new URL(`../../test/${name}`, import.meta.url), 'utf8')) as Sample[]

const NBSP = String.fromCharCode(0xa0)
const IDEOGRAPHIC = String.fromCharCode(0x3000)

/** Every snippet the two sides are asked about: the test sets, then odd input a model file may hold. */
export function samples(): string[] {
  const odd = [
    '', ' ', '\n\n', 'x', 'hello', 'Total: 5', '[1, 2', '{"a": }', '  [ {"id": 1}, {"id": 2} ]', '{\n  "a": [1, 2],\n  "b": null\n}',
    '<?xml version="1.0"?>\n<Project Sdk="Microsoft.NET.Sdk"></Project>', '<?xml version="1.0"?><!DOCTYPE html><html></html>',
    'tab\there\t=> x', 'ünïcödé = "ß"', 'line one\n\nline three\n',
    // Other kinds of space, which JavaScript's \s takes and .NET's ECMAScript \s does not.
    `.card {${NBSP}display: grid;${NBSP}gap: 8px; }`, `FROM${NBSP}node:22\nRUN${NBSP}npm ci`, `SELECT${IDEOGRAPHIC}id${IDEOGRAPHIC}FROM${IDEOGRAPHIC}orders`, `def${NBSP}f(x):\n${NBSP}${NBSP}return x`,
    // Nesting a parser may refuse.
    '['.repeat(70) + ']'.repeat(70),
  ]
  return [...read('detect-corpus.json'), ...read('detect-holdout.json'), ...read('detect-blind.json'), ...read('detect-blind2.json')].map(s => s.text).concat(odd)
}

export function dumpDetect() {
  return samples().map(text => ({ text, guess: guessLanguage(text) ?? null }))
}

/** How highlight.js's HTML becomes runs, on hand-made HTML that has every shape the converter handles. */
const HTML_CASES = [
  '',
  'plain',
  '<span class="hljs-keyword">const</span> a = <span class="hljs-string">&quot;x &amp; y&quot;</span>',
  '<span class="hljs-title class_">Order</span>',
  '<span class="hljs-title function_">price</span>(<span class="hljs-params">a</span>)',
  '<span class="hljs-string">a<span class="hljs-subst">${b}</span>c</span>',
  '<span class="hljs-comment">// <span class="hljs-doctag">TODO</span> later</span>',
  '<span class="hljs-number">1</span><span class="hljs-number">2</span>',
  '<span class="hljs-unknown">kept as it is</span>',
  '<span class="hljs-attr">a</span>=<span class="hljs-string">&#x27;b&#39;</span> &lt;&gt;',
  '<span class="hljs-meta"><span class="hljs-keyword">#include</span> <span class="hljs-string">&lt;stdio.h&gt;</span></span>',
  '</span>stray close',
]

export function dumpHighlight() {
  const first = new Map<string, string>()
  for (const s of [...read('detect-corpus.json'), ...read('detect-holdout.json')]) {
    if (s.language && LANGUAGES.some(l => l.id === s.language) && !first.has(s.language)) first.set(s.language, s.text)
  }
  return {
    htmlCases: HTML_CASES.map(html => ({ html, runs: runsFromHtml(html) })),
    snippets: [...first].map(([language, text]) => ({ language, text, html: highlightHtml(text, language) ?? null })),
    unknown: { language: 'klingon', html: highlightHtml('x', 'klingon') ?? null },
  }
}
