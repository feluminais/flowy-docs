import { test } from 'node:test'
import assert from 'node:assert/strict'
import { check } from '../src/core/check.ts'
import { parseModelFile, serializeModelFile } from '../src/core/model.ts'
import { describeEdit } from '../src/core/editlabel.ts'
import { putObject } from '../src/core/ops.ts'
import { codeLines, isBlankCode, LANGUAGES, languageOf, SNIPPET_MAX, snippetProblems, snippetsOf, tidySnippets } from '../src/core/snippets.ts'
import { shop } from './fixtures.ts'

const fee = 'const fee = base + km * rate'

test('a language is found by its id, its name or an alias, in any case', () => {
  assert.equal(languageOf('typescript')?.id, 'typescript')
  assert.equal(languageOf('TS')?.id, 'typescript')
  assert.equal(languageOf(' C# ')?.id, 'csharp')
  assert.equal(languageOf('Shell')?.id, 'bash')
  assert.equal(languageOf('c++')?.id, 'cpp')
  assert.equal(languageOf('Plain text')?.id, 'text')
  assert.equal(languageOf('klingon'), undefined)
  assert.equal(languageOf(''), undefined)
  assert.equal(languageOf(7), undefined)
})

test('no id, name or alias belongs to two languages', () => {
  const seen = new Map<string, string>()
  for (const l of LANGUAGES) for (const key of [l.id, l.name.toLowerCase(), ...l.aliases]) {
    assert.equal(seen.get(key) ?? l.id, l.id, `"${key}" is both ${seen.get(key)} and ${l.id}`)
    seen.set(key, l.id)
  }
})

test('the blank lines round a snippet come off, and every kind of line break is one', () => {
  assert.deepEqual(codeLines('\n\n  a\r\n    b\r\n\n'), ['  a', '    b'])
  assert.deepEqual(codeLines('x'), ['x'])
  assert.deepEqual(codeLines('a\rb'), ['a', 'b'])
})

test('snippetsOf keeps the entries with text and drops the rest', () => {
  const list = snippetsOf({ type: 'component', name: 'A', snippets: [{ text: fee }, { title: 'No text' }, { text: ' \n' }, 'plain', { text: 3 }, { text: fee, title: 4 }, { text: fee, language: 'ts', title: 'Fee' }] })
  assert.deepEqual(list, [{ text: fee }, { text: fee, language: 'ts', title: 'Fee' }])
  assert.deepEqual(snippetsOf({ type: 'component', name: 'A' }), [])
  assert.deepEqual(snippetsOf({ type: 'component', name: 'A', snippets: 'x' }), [])
})

test('tidySnippets orders the keys, writes the language as its id and trims what surrounds the code', () => {
  const [one, two] = tidySnippets([
    { language: 'TS', text: `\n${fee}\n\n`, title: '  Fee  ', note: 'kept' },
    { text: 'a\r\nb', title: ' ', language: ' ' },
  ]) as Record<string, string>[]
  assert.deepEqual(one, { title: 'Fee', language: 'typescript', text: fee, note: 'kept' })
  assert.deepEqual(Object.keys(one), ['title', 'language', 'text', 'note'])
  assert.deepEqual(two, { text: 'a\nb' })
})

test('tidySnippets leaves a language it does not know for check to report, and a non-list alone', () => {
  assert.deepEqual(tidySnippets([{ text: 'x', language: 'klingon' }]), [{ language: 'klingon', text: 'x' }])
  assert.equal(tidySnippets('x'), 'x')
})

test('putObject adds snippets after links, tidied, and an empty list removes them', () => {
  const m = putObject(shop(), { id: 'orders', links: [{ url: 'https://example.com' }], snippets: [{ text: fee, language: 'ts' }] })
  assert.deepEqual(m.objects.orders.snippets, [{ language: 'typescript', text: fee }])
  assert.deepEqual(Object.keys(m.objects.orders), ['type', 'in', 'name', 'links', 'snippets'])
  assert.deepEqual(check(m), [])
  assert.equal('snippets' in putObject(m, { id: 'orders', snippets: [] }).objects.orders, false)
})

test('snippets are replaced as a whole, and kept when the input leaves them out', () => {
  const first = putObject(shop(), { id: 'orders', snippets: [{ text: 'a' }, { text: 'b' }] })
  assert.deepEqual((putObject(first, { id: 'orders', snippets: [{ text: 'c' }] }).objects.orders.snippets as { text: string }[]).map(s => s.text), ['c'])
  assert.deepEqual(putObject(first, { id: 'orders', tech: 'Node' }).objects.orders.snippets, first.objects.orders.snippets)
})

test('an edit that only changes the files is named source, and one that only changes the code is named code', () => {
  assert.equal(describeEdit(shop(), putObject(shop(), { id: 'orders', code: ['src/a.ts'] })), "Changed Orders's source")
  assert.equal(describeEdit(shop(), putObject(shop(), { id: 'orders', snippets: [{ text: fee }] })), "Changed Orders's code")
})

test('a well-formed snippet has no problems, a missing language is fine, and every known language is accepted', () => {
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: LANGUAGES.map(l => ({ text: fee, language: l.id })).slice(0, SNIPPET_MAX.snippets) }), [])
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: [{ text: fee }, { text: fee, language: '' }, { text: fee, language: 'C#' }] }), [])
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A' }), [])
})

test('check names what is wrong with a snippet by its number, without quoting the code', () => {
  const o = (snippets: unknown) => ({ type: 'component' as const, name: 'A', snippets })
  assert.match(snippetProblems(o('x'))[0], /snippets must be a list/)
  assert.deepEqual(snippetProblems(o(['plain'])), ['snippet 1 must be a mapping with text'])
  assert.deepEqual(snippetProblems(o([{ title: 'T' }, { text: '  \n' }])), ['snippet 1 has no text', 'snippet 2 has no text'])
  assert.deepEqual(snippetProblems(o([{ text: 5 }])), ['snippet 1: text must be plain text'])
  assert.deepEqual(snippetProblems(o([{ text: 'x', title: ['a'] }])), ['snippet 1: title must be plain text'])
  assert.match(snippetProblems(o([{ text: 'x', language: 'klingon' }]))[0], /^snippet 1: unknown language "klingon" \(use typescript, /)
  assert.deepEqual(snippetProblems(o([{ text: 'x', language: ['ts'] }])), ['snippet 1: language must be plain text'])
})

test('a snippet over the line limit, and too many snippets, are problems', () => {
  const long = Array.from({ length: SNIPPET_MAX.lines + 1 }, (_, i) => `line ${i}`).join('\n')
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: [{ text: long }] }), [`snippet 1 is ${SNIPPET_MAX.lines + 1} lines, at most ${SNIPPET_MAX.lines}. Put long code in a file and list it under Source.`])
  assert.equal(snippetProblems({ type: 'component', name: 'A', snippets: [{ text: `${long}\n\n\n` }] }).length, 1)
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: Array.from({ length: SNIPPET_MAX.snippets + 1 }, () => ({ text: 'x' })) }), [`${SNIPPET_MAX.snippets + 1} snippets, at most ${SNIPPET_MAX.snippets}`])
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: [{ text: Array.from({ length: SNIPPET_MAX.lines }, () => 'x').join('\n') }] }), [])
})

test('check reports a snippet problem on the object, with the object\'s id', () => {
  const m = shop()
  m.objects.orders.snippets = [{ text: 'x', language: 'klingon' }]
  const [problem] = check(m)
  assert.equal(problem.id, 'orders')
  assert.match(problem.message, /^orders: snippet 1: unknown language "klingon"/)
})

const awkward = [
  'const fee = base + km * rate',
  '  indented first line\n    and a deeper one',
  '# a comment first\nkey: value\n- item',
  'line with trailing space \n\ttabbed line\n\nblank above',
  'say "hi" and \'bye\'\nurl: http://x.test/a#b',
  '{\n  "a": [1, 2],\n  "b": null\n}',
  '| a | b |\n|---|---|',
  '>\n!tag &anchor *alias',
  'x',
]

test('code comes back from the file exactly as it went in, whatever it holds', () => {
  for (const text of awkward) {
    const m = putObject(shop(), { id: 'orders', snippets: [{ text, language: 'ts', title: 'T' }] })
    const back = parseModelFile(serializeModelFile(m)).objects.orders.snippets as { text: string }[]
    assert.equal(back[0].text, codeLines(text).join('\n'), JSON.stringify(text))
    assert.deepEqual(check({ ...m, objects: parseModelFile(serializeModelFile(m)).objects }), [], JSON.stringify(text))
  }
})

test('code is written as a block of lines, one to a line', () => {
  const file = serializeModelFile(putObject(shop(), { id: 'orders', snippets: [{ title: 'Fee', text: 'a = 1\nb = 2' }] }))
  assert.match(file, /^ {4}snippets:\n {6}- title: Fee\n {8}text: \|-\n {10}a = 1\n {10}b = 2$/m)
})

test('code is blank when it holds nothing but spaces, tabs and line breaks, and only those come off its ends', () => {
  assert.equal(isBlankCode(' \t\n\r\n '), true)
  assert.equal(isBlankCode('\u00a0'), false)
  assert.deepEqual(codeLines('a  \n \t\n'), ['a'])
  assert.deepEqual(codeLines('\n \t\n  a\n'), ['  a'])
})

const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const NEL = String.fromCharCode(0x85)

test('the line and paragraph separators and NEL are line breaks, and control characters are left out', () => {
  assert.deepEqual(codeLines(`a${LS}b${PS}c${NEL}d\u0007e\u007f`), ['a', 'b', 'c', 'de'])
  assert.deepEqual(codeLines('x\ty'), ['x\ty'])
})

test('code that holds those characters is written as plain lines and reads back the same', () => {
  const text = `const a = 1${LS}const b = 2\n  indented\u0007\n\n`
  const m = putObject(shop(), { id: 'orders', snippets: [{ text }] })
  assert.equal((m.objects.orders.snippets as { text: string }[])[0].text, 'const a = 1\nconst b = 2\n  indented')
  const back = parseModelFile(serializeModelFile(m)).objects.orders.snippets as { text: string }[]
  assert.equal(back[0].text, 'const a = 1\nconst b = 2\n  indented')
})

test('a snippet over the character limit is a problem, and a very long line is trimmed in no time', () => {
  const long = 'x'.repeat(SNIPPET_MAX.chars + 1)
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: [{ text: long }] }), [`snippet 1 is ${SNIPPET_MAX.chars + 1} characters, at most ${SNIPPET_MAX.chars}. Put long code in a file and list it under Source.`])
  assert.deepEqual(snippetProblems({ type: 'component', name: 'A', snippets: [{ text: 'x'.repeat(SNIPPET_MAX.chars) }] }), [])
  const clock = Date.now()
  assert.equal(codeLines(`a${' '.repeat(400_000)}`).length, 1)
  assert.ok(Date.now() - clock < 1000, 'trimming 400,000 spaces took too long')
})
