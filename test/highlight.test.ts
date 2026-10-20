import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LANGUAGES } from '../src/core/snippets.ts'
import { detectLanguage, highlight, runsFromHtml, TOKEN_KINDS } from '../ui/src/highlight.ts'

const text = (runs: { text: string }[]) => runs.map(r => r.text).join('')

test('highlight.js html becomes runs: text unescaped, the innermost kind wins, and a kind it has no name for is the one round it', () => {
  assert.deepEqual(runsFromHtml('<span class="hljs-keyword">const</span> a = <span class="hljs-string">&quot;x &amp; y&quot;</span>'), [
    { text: 'const', kind: 'keyword' }, { text: ' a = ' }, { text: '"x & y"', kind: 'string' },
  ])
  assert.deepEqual(runsFromHtml('<span class="hljs-title class_">Order</span>'), [{ text: 'Order', kind: 'type' }])
  assert.deepEqual(runsFromHtml('<span class="hljs-string">a<span class="hljs-subst">${b}</span>c</span>'), [
    { text: 'a', kind: 'string' }, { text: '${b}' }, { text: 'c', kind: 'string' },
  ])
  assert.deepEqual(runsFromHtml('<span class="hljs-comment">// <span class="hljs-doctag">TODO</span></span>'), [{ text: '// ', kind: 'comment' }, { text: 'TODO', kind: 'keyword' }])
})

test('neighbouring stretches of one kind are one run', () => {
  assert.deepEqual(runsFromHtml('<span class="hljs-number">1</span><span class="hljs-number">2</span>'), [{ text: '12', kind: 'number' }])
})

test('every language of ours that is coloured draws some keyword or string, and the runs always spell the code back', () => {
  const samples: Record<string, string> = {
    typescript: 'const a: number = 1 // x', javascript: 'const a = "x"', json: '{"a": 1}', yaml: 'a: 1\nb: [x]', csharp: 'public class A { }', java: 'public class A { }',
    kotlin: 'fun a() = 1', python: 'def a():\n    return "x"', go: 'func a() int { return 1 }', rust: 'fn a() -> i32 { 1 }', sql: 'SELECT a FROM b', bash: 'echo "x" | grep y',
    powershell: 'Get-Item -Path "x"', html: '<div class="a">x</div>', xml: '<a b="c"/>', css: 'a { color: red; }', dockerfile: 'FROM node\nRUN npm ci', markdown: '# Title\n\n- item',
    c: 'int a(void) { return 1; }', cpp: 'class A { int a; };', php: '<?php echo "x";', ruby: 'def a\n  "x"\nend', swift: 'func a() -> Int { 1 }',
  }
  for (const l of LANGUAGES) {
    const code = samples[l.id] ?? 'plain'
    const runs = highlight(code, l.id)
    assert.equal(text(runs), code, l.id)
    if (l.id !== 'text') assert.ok(runs.some(r => r.kind !== undefined), `${l.id} has no coloured stretch`)
    else assert.deepEqual(runs, [{ text: code }])
  }
})

test('code that highlight.js cannot make sense of, an unknown language and plain text are drawn plain, never thrown at', () => {
  assert.deepEqual(highlight('whatever', 'klingon'), [{ text: 'whatever' }])
  assert.deepEqual(highlight('<<<>>> ??', 'json'), highlight('<<<>>> ??', 'json'))
  assert.equal(text(highlight('<<<>>> ??', 'json')), '<<<>>> ??')
})

test('the kinds are the ones the stylesheet and the desktop theme colour', () => {
  assert.deepEqual([...TOKEN_KINDS], ['comment', 'keyword', 'string', 'number', 'type', 'function', 'property', 'tag', 'meta'])
})

test('a long enough snippet of a common language is worked out, and a bare word is left plain', () => {
  assert.equal(detectLanguage('export async function price(order: Order): Promise<number> {\n  const fee = base + km * rate\n  return fee\n}')?.id, 'typescript')
  assert.equal(detectLanguage('FROM node:22-alpine\nWORKDIR /app\nCOPY . .\nRUN npm ci\nCMD ["node", "server.js"]')?.id, 'dockerfile')
  assert.equal(detectLanguage('hello'), undefined)
})
