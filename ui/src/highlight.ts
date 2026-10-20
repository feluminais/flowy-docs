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
import { languageOf } from '../../src/core/snippets.ts'
import type { Language } from '../../src/core/snippets.ts'

/** What a stretch of code is, for colouring. A stretch of none of these is drawn plain. */
export const TOKEN_KINDS = ['comment', 'keyword', 'string', 'number', 'type', 'function', 'property', 'tag', 'meta'] as const
export type TokenKind = (typeof TOKEN_KINDS)[number]
/** A stretch of code and what it is, if it is any of the kinds. */
export type Run = { text: string; kind?: TokenKind }

/** The language of highlight.js that colours each of ours. HTML is XML to it. */
const GRAMMARS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  typescript, javascript, json, yaml, csharp, java, kotlin, python, go, rust, sql, bash, powershell, html: xml, xml, css, dockerfile, markdown, c, cpp, php, ruby, swift,
}
for (const [id, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(id, grammar)

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
 * The HTML highlight.js writes (text with `<span class="hljs-keyword">` round stretches, which can nest) as runs: each stretch of text with the
 * kind of the innermost span that has one. Adjacent runs of the same kind are one.
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

/** Whether a language of ours is coloured: every one but plain text. */
const colours = (id: string) => id !== 'text' && hljs.getLanguage(id) !== undefined

/** The code as runs for the language, or one plain run when the language isn't coloured. Never throws. */
export function highlight(text: string, language: string): Run[] {
  if (!colours(language)) return [{ text }]
  try {
    return runsFromHtml(hljs.highlight(text, { language, ignoreIllegals: true }).value)
  } catch {
    return [{ text }]
  }
}

/** The ids of our languages that are coloured (not plain text), which is what the language is worked out from. */
const COLOURED = Object.keys(GRAMMARS)

/**
 * The language the code is most likely written in, or undefined when it is too short or too plain to tell. A guess from highlight.js's own
 * scoring, kept to the languages we know; a short snippet may be wrong, and the reader can pick the right one.
 */
export function detectLanguage(text: string): Language | undefined {
  const { language, relevance } = hljs.highlightAuto(text, COLOURED)
  if (!language || relevance < 5) return undefined
  return languageOf(language === 'xml' && /<(?:!doctype html|html|head|body|div|span|p|a|ul|li|script|style)\b/i.test(text) ? 'html' : language)
}
