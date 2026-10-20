import { isMap } from './model.ts'
import type { FlowyObject } from './model.ts'

/** How much code a shape holds, so the panel stays a picture of a few lines that matter and never a copy of the repo (files belong under Source). */
export const SNIPPET_MAX = { snippets: 6, lines: 40 } as const

/**
 * A language a snippet can be coloured as. `id` is what the file holds, `name` is what a reader sees, and `aliases` are the other names people
 * write for it (a fence in a description says ```ts, a person typing in the form says "c#"). `text` is not a language: it says "no colours".
 */
export type Language = { id: string; name: string; aliases: readonly string[] }

export const LANGUAGES: readonly Language[] = [
  { id: 'typescript', name: 'TypeScript', aliases: ['ts', 'tsx'] },
  { id: 'javascript', name: 'JavaScript', aliases: ['js', 'jsx', 'mjs', 'cjs', 'node'] },
  { id: 'json', name: 'JSON', aliases: ['jsonc', 'json5'] },
  { id: 'yaml', name: 'YAML', aliases: ['yml'] },
  { id: 'csharp', name: 'C#', aliases: ['cs', 'c#', 'dotnet'] },
  { id: 'java', name: 'Java', aliases: [] },
  { id: 'kotlin', name: 'Kotlin', aliases: ['kt', 'kts'] },
  { id: 'python', name: 'Python', aliases: ['py'] },
  { id: 'go', name: 'Go', aliases: ['golang'] },
  { id: 'rust', name: 'Rust', aliases: ['rs'] },
  { id: 'sql', name: 'SQL', aliases: ['postgres', 'postgresql', 'mysql', 'sqlite', 'tsql', 'plsql'] },
  { id: 'bash', name: 'Shell', aliases: ['sh', 'shell', 'zsh', 'console', 'terminal'] },
  { id: 'powershell', name: 'PowerShell', aliases: ['ps1', 'pwsh', 'ps'] },
  { id: 'html', name: 'HTML', aliases: ['htm'] },
  { id: 'xml', name: 'XML', aliases: ['xsd', 'xsl', 'svg', 'csproj'] },
  { id: 'css', name: 'CSS', aliases: ['scss', 'less'] },
  { id: 'dockerfile', name: 'Dockerfile', aliases: ['docker'] },
  { id: 'markdown', name: 'Markdown', aliases: ['md'] },
  { id: 'c', name: 'C', aliases: ['h'] },
  { id: 'cpp', name: 'C++', aliases: ['c++', 'cc', 'cxx', 'hpp'] },
  { id: 'php', name: 'PHP', aliases: [] },
  { id: 'ruby', name: 'Ruby', aliases: ['rb'] },
  { id: 'swift', name: 'Swift', aliases: [] },
  { id: 'text', name: 'Plain text', aliases: ['txt', 'plain', 'plaintext', 'none'] },
]

/** A language by the id, the name or any alias, in any case. Undefined for anything else, which check() reports. */
export function languageOf(tag: unknown): Language | undefined {
  if (typeof tag !== 'string') return undefined
  const key = tag.trim().toLowerCase()
  if (key === '') return undefined
  return LANGUAGES.find(l => l.id === key || l.name.toLowerCase() === key || l.aliases.includes(key))
}

/** One entry of an object's `snippets`: a few lines of code, with a title and a language if you like. Extra keys are kept. Without a language, it is worked out from the code. */
export type Snippet = { text: string; title?: string; language?: string; [extra: string]: unknown }

/** A snippet as put_object gives it. */
export type SnippetInput = { text: string; title?: string; language?: string; [extra: string]: unknown }

const isSnippet = (s: unknown): s is Snippet =>
  isMap(s) && typeof s.text === 'string' && !isBlankCode(s.text) && (s.title === undefined || typeof s.title === 'string') && (s.language === undefined || typeof s.language === 'string')

/** The well-formed entries of an object's `snippets` (a mapping with text). check() reports anything else. */
export function snippetsOf(o: FlowyObject): Snippet[] {
  return Array.isArray(o.snippets) ? o.snippets.filter(isSnippet) : []
}

/**
 * The lines of some code with the blank lines before and after it taken off, and a carriage return read as a line break. Only spaces, tabs
 * and line breaks count as blank, so the desktop app (Snippets.CodeLines) agrees with this to the character.
 */
export function codeLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/^(?:[\t ]*\n)+/, '').replace(/[\t \n]+$/, '').split('\n')
}

/** Whether some code is nothing but blank lines. */
export const isBlankCode = (text: string): boolean => codeLines(text).join('') === ''

/**
 * What an object's `snippets` hold, as text to put in a file: line breaks as `\n`, no blank lines around the code, a blank title and a
 * blank language left out, a language written as its id ("ts" becomes "typescript"; one that isn't known stays, for check() to report),
 * and the keys in the order title, language, text, then the extra ones.
 */
export function tidySnippets(input: SnippetInput[]): unknown[]
export function tidySnippets(input: unknown): unknown
export function tidySnippets(input: unknown): unknown {
  if (!Array.isArray(input)) return input
  return input.map(entry => {
    if (!isMap(entry)) return entry
    const { title, language, text, ...extra } = entry
    const out: Record<string, unknown> = {}
    if (typeof title === 'string' && title.trim() !== '') out.title = title.trim()
    if (typeof language === 'string' && language.trim() !== '') out.language = languageOf(language)?.id ?? language.trim()
    else if (language !== undefined && typeof language !== 'string') out.language = language
    if (text !== undefined) out.text = typeof text === 'string' ? codeLines(text).join('\n') : text
    return Object.assign(out, extra)
  })
}

/** What is wrong with an object's `snippets`, one message each, without the object's name. Nothing in a message depends on the code itself. */
export function snippetProblems(o: FlowyObject): string[] {
  if (o.snippets === undefined) return []
  const list = o.snippets
  if (!Array.isArray(list)) return ['snippets must be a list of entries with text and, if you like, a title and a language']
  const out: string[] = []
  list.forEach((s, i) => {
    const at = `snippet ${i + 1}`
    if (!isMap(s)) return void out.push(`${at} must be a mapping with text`)
    if (s.text === undefined || (typeof s.text === 'string' && isBlankCode(s.text))) out.push(`${at} has no text`)
    else if (typeof s.text !== 'string') out.push(`${at}: text must be plain text`)
    else {
      const lines = codeLines(s.text).length
      if (lines > SNIPPET_MAX.lines) out.push(`${at} is ${lines} lines, at most ${SNIPPET_MAX.lines}. Put long code in a file and list it under Source.`)
    }
    if (s.title !== undefined && typeof s.title !== 'string') out.push(`${at}: title must be plain text`)
    if (s.language !== undefined && s.language !== '') {
      if (typeof s.language !== 'string') out.push(`${at}: language must be plain text`)
      else if (!languageOf(s.language)) out.push(`${at}: unknown language "${s.language}" (use ${LANGUAGES.map(l => l.id).join(', ')}, or leave it out to have it worked out)`)
    }
  })
  if (list.length > SNIPPET_MAX.snippets) out.push(`${list.length} snippets, at most ${SNIPPET_MAX.snippets}`)
  return out
}
