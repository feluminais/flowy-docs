import { useEffect, useMemo, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import { copyMessage } from '../../src/core/host.ts'
import type { FlowyObject } from '../../src/core/model.ts'
import { codeLines, isBlankCode, LANGUAGES, languageOf, SNIPPET_MAX, snippetsOf } from '../../src/core/snippets.ts'
import type { Language, Snippet, SnippetInput } from '../../src/core/snippets.ts'
import { Section } from './Chrome.tsx'
import { detectLanguage, highlight } from './highlight.ts'
import { vscode } from './host.ts'
import { Check, ChevronRight, Code, Copy, Plus, Trash } from './icons.tsx'

/** The language a snippet is shown in: the one it names, or else the one worked out from the code. `auto` says which. Undefined when it can't be told. */
export function languageFor(snippet: Pick<Snippet, 'text' | 'language'>): { language?: Language; auto: boolean } {
  const named = languageOf(snippet.language)
  if (named) return { language: named, auto: false }
  return { language: detectLanguage(codeLines(snippet.text).join('\n')), auto: true }
}

/** Code with its colours. `language` is one of our ids, or nothing for plain text. Text and the colours of its stretches only, so nothing in it is ever run. */
export function CodeBlock({ text, language }: { text: string; language?: string }) {
  const lines = codeLines(text).join('\n')
  const runs = useMemo(() => highlight(lines, language ?? 'text'), [lines, language])
  return (
    <pre className="code-block" tabIndex={0}>
      <code>{runs.map((run, i) => (run.kind ? <span key={i} className={`tok tok-${run.kind}`}>{run.text}</span> : run.text))}</code>
    </pre>
  )
}

/** Puts text on the clipboard: in VS Code the editor writes it (a webview can't count on the clipboard API), anywhere else the page does. */
async function copy(text: string): Promise<boolean> {
  try {
    if (vscode) vscode.postMessage(copyMessage(text))
    else await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button type="button" className="icon code-copy" title={done ? 'Copied' : 'Copy'} aria-label={done ? 'Copied' : 'Copy'}
      onClick={async () => {
        if (!(await copy(codeLines(text).join('\n')))) return
        setDone(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setDone(false), 1500)
      }}>
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

/** One snippet: its title, the language it is shown in, a button that copies it, and the code. */
function SnippetView({ snippet }: { snippet: Snippet }) {
  const { language } = languageFor(snippet)
  return (
    <figure className="code-snippet">
      <figcaption>
        <span className="code-title">{snippet.title}</span>
        {language && <span className="code-lang">{language.name}</span>}
        <CopyButton text={snippet.text} />
      </figcaption>
      <CodeBlock text={snippet.text} language={language?.id} />
    </figure>
  )
}

/** What an object's `snippets` hold, in its panel: nothing for an object with none. */
export function CodeSection({ object }: { object: FlowyObject }) {
  const snippets = snippetsOf(object)
  if (snippets.length === 0) return null
  return (
    <section className="code-section" aria-label="Code">
      <Section icon={Code} title="Code" count={snippets.length} />
      {snippets.map((s, i) => <SnippetView key={`${i}:${s.text}`} snippet={s} />)}
    </section>
  )
}

/**
 * The language of one snippet as a drawn choice: Auto (the one worked out, named beside the label) and every language by name, the chosen one
 * ringed. A closed row shows what is chosen; it opens to the grid, and a pick closes it.
 */
function LanguagePicker({ snippet, onPick }: { snippet: Snippet; onPick: (language: string) => void }) {
  const [open, setOpen] = useState(false)
  const chosen = languageOf(snippet.language)
  const guess = chosen ? undefined : languageFor(snippet).language
  const shown = chosen ? chosen.name : `Auto: ${guess?.name ?? 'Plain text'}`
  const pick = (id: string) => { setOpen(false); if (id !== (chosen?.id ?? '')) onPick(id) }
  return (
    <div className="pick-field" onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) } }}>
      <div className="pick-head"><span>Language</span></div>
      <button type="button" className="pick lang-open" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Code size={16} />
        <span>{shown}</span>
        <ChevronRight size={14} />
      </button>
      {open && (
        <div className="pick-grid langs" role="radiogroup" aria-label="Language">
          <button type="button" role="radio" aria-checked={!chosen} className="pick" onClick={() => pick('')}><span>Auto</span></button>
          {LANGUAGES.map(l => (
            <button key={l.id} type="button" role="radio" aria-checked={l.id === chosen?.id} className="pick" onClick={() => pick(l.id)}><span>{l.name}</span></button>
          ))}
        </div>
      )}
    </div>
  )
}

/** One snippet's fields. A title and the code save when you leave them; a language saves when you pick it. */
function SnippetFields({ snippet, onChange, onRemove }: { snippet: Snippet; onChange: (next: Snippet) => Promise<boolean>; onRemove: () => void }) {
  const blur = (field: 'title' | 'text') => async (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const input = e.currentTarget
    if (input.value === (snippet[field] ?? '')) return
    if (!(await onChange({ ...snippet, [field]: input.value }))) input.value = snippet[field] ?? ''
  }
  return (
    <div className="card code-card">
      <label>
        Title
        <input key={snippet.title ?? ''} defaultValue={snippet.title ?? ''} onBlur={blur('title')} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()} />
      </label>
      <LanguagePicker snippet={snippet} onPick={language => void onChange({ ...snippet, language })} />
      <label>
        Code
        <textarea key={snippet.text} className="code-edit" defaultValue={snippet.text} rows={8} spellCheck={false} wrap="off" onBlur={blur('text')} />
      </label>
      <button type="button" className="danger" onClick={onRemove}><Trash size={16} />Remove</button>
    </div>
  )
}

/**
 * The edit form for an object's snippets: a card each and a button that adds one. A new card is only on this page until it has code, so
 * leaving it empty saves nothing. `onSave` takes the whole list, as put_object does.
 */
export function CodeFields({ object, onSave }: { object: FlowyObject; onSave: (snippets: SnippetInput[]) => Promise<boolean> }) {
  const saved = snippetsOf(object)
  const [draft, setDraft] = useState<Snippet>()
  // A card that has been saved is in the list now.
  useEffect(() => setDraft(undefined), [saved.length])
  const list = draft ? [...saved, draft] : saved
  const full = saved.length >= SNIPPET_MAX.snippets
  const change = async (i: number, next: Snippet): Promise<boolean> => {
    if (i < saved.length) return onSave(saved.map((s, j) => (j === i ? next : s)))
    if (isBlankCode(next.text)) {
      setDraft(next)
      return true
    }
    return onSave([...saved, next])
  }
  const remove = (i: number) => {
    if (i >= saved.length) setDraft(undefined)
    else void onSave(saved.filter((_, j) => j !== i))
  }
  return (
    <>
      {list.map((s, i) => <SnippetFields key={i} snippet={s} onChange={next => change(i, next)} onRemove={() => remove(i)} />)}
      <button type="button" className="add-code" disabled={draft !== undefined || full}
        title={full ? `At most ${SNIPPET_MAX.snippets}` : undefined}
        onClick={() => setDraft({ text: '' })}><Plus size={16} />Add code</button>
    </>
  )
}
