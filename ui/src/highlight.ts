import { guessLanguage } from '../../src/core/detect.ts'
import { languageOf } from '../../src/core/snippets.ts'
import type { Language } from '../../src/core/snippets.ts'
import { highlightHtml } from './hljs.ts'

/** What a stretch of code is, for colouring. A stretch of none of these is drawn plain. */
export const TOKEN_KINDS = ['comment', 'keyword', 'string', 'number', 'type', 'function', 'property', 'tag', 'meta'] as const
export type TokenKind = (typeof TOKEN_KINDS)[number]
/** A stretch of code and what it is, if it is any of the kinds. */
export type Run = { text: string; kind?: TokenKind }

/** The kind each class highlight.js puts on a stretch stands for. A class that isn't here is drawn as the stretch around it; `subst` (code inside a string) is plain. */
const KINDS: Record<string, TokenKind | 'plain'> = {
  comment: 'comment', quote: 'comment',
  keyword: 'keyword', doctag: 'keyword', 'meta-keyword': 'keyword',
  string: 'string', regexp: 'string', 'meta-string': 'string', link: 'string', template_string: 'string',
  number: 'number', literal: 'number', symbol: 'number', bullet: 'number',
  type: 'type', built_in: 'type', class_: 'type',
  function_: 'function',
  attr: 'property', attribute: 'property', property: 'property', variable: 'property', 'template-variable': 'property',
  tag: 'tag', name: 'tag', section: 'tag', 'selector-tag': 'tag', 'selector-id': 'tag', 'selector-class': 'tag', 'selector-attr': 'tag', 'selector-pseudo': 'tag',
  meta: 'meta',
  subst: 'plain', params: 'plain', operator: 'plain', punctuation: 'plain',
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" }
const unescape = (text: string) => text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, e => ENTITIES[e])

/**
 * The HTML highlight.js writes (text with `<span class="hljs-keyword">` round stretches, which can nest) as runs: each stretch of text with
 * the kind of the innermost span that has one. Adjacent runs of the same kind are one. CodeRuns.FromHtml in the desktop app does the same.
 */
export function runsFromHtml(html: string): Run[] {
  const runs: Run[] = []
  const stack: (TokenKind | 'plain' | undefined)[] = []
  const push = (text: string) => {
    if (text === '') return
    const inherited = [...stack].reverse().find(k => k !== undefined)
    const kind = inherited === 'plain' ? undefined : inherited
    const last = runs.at(-1)
    if (last && last.kind === kind) last.text += text
    else runs.push(kind === undefined ? { text } : { text, kind })
  }
  for (const part of html.split(/(<span class="[^"]*">|<\/span>)/)) {
    const open = /^<span class="([^"]*)">$/.exec(part)
    if (open) {
      const classes = open[1].split(/\s+/).map(c => c.replace(/^hljs-/, '')).filter(Boolean)
      stack.push(classes.map(c => KINDS[c]).find(k => k !== undefined))
    } else if (part === '</span>') stack.pop()
    else push(unescape(part))
  }
  return runs
}

/** The code as runs for the language, or one plain run when the language isn't coloured (plain text, or one that highlight.js has no grammar for). Never throws. */
export function highlight(text: string, language: string): Run[] {
  if (language === 'text') return [{ text }]
  const html = highlightHtml(text, language)
  return html === undefined ? [{ text }] : runsFromHtml(html)
}

/**
 * The language the code is most likely written in (the cues of src/core/detect.ts), or undefined when it is too short or too plain to tell,
 * which is drawn as plain text. A short snippet may be wrong, and the reader can pick the right language.
 */
export function detectLanguage(text: string): Language | undefined {
  return languageOf(guessLanguage(text))
}
