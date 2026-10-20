import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderDetectData } from '../desktop/tools/make-detect-data.ts'
import { renderHljsBundle } from '../desktop/tools/make-hljs-bundle.ts'
import { CUES, guessLanguage } from '../src/core/detect.ts'
import { codeLines, languageOf } from '../src/core/snippets.ts'

type Sample = { language: string | null; size: string; text: string }

const sets = async (): Promise<Record<string, Sample[]>> => {
  const read = async (name: string) => JSON.parse(await readFile(new URL(`./${name}`, import.meta.url), 'utf8')) as Sample[]
  return { corpus: await read('detect-corpus.json'), holdout: await read('detect-holdout.json'), blind: await read('detect-blind.json'), blind2: await read('detect-blind2.json') }
}

/** TypeScript and JavaScript, C and C++, and HTML and XML are told apart by too little to hold a guess against each other. */
const family = (id: string | null | undefined) => ({ xml: 'html', typescript: 'jsts', javascript: 'jsts', c: 'cfam', cpp: 'cfam' } as Record<string, string>)[id ?? ''] ?? id ?? null

test('every language the cues can name is one Flowy has an id for, and never plain text', () => {
  for (const { language } of CUES) assert.ok(languageOf(language) && language !== 'text', language)
  for (const id of ['json', 'c']) assert.ok(languageOf(id), id)
})

test('the cues tell most code apart on the test sets, and leave what is not code plain', async () => {
  for (const [name, set] of Object.entries(await sets())) {
    const code = set.filter(s => s.language !== null)
    const right = code.filter(s => family(guessLanguage(codeLines(s.text).join('\n'))) === family(s.language))
    assert.ok(right.length / code.length >= 0.9, `${name}: ${right.length} of ${code.length} code snippets`)
    const short = code.filter(s => s.size === 'short')
    assert.ok(short.filter(s => right.includes(s)).length / short.length >= 0.75, `${name}: short code`)
    const prose = set.filter(s => s.language === null)
    assert.ok(prose.filter(s => guessLanguage(s.text) === undefined).length >= prose.length * 0.9, `${name}: non-code left plain`)
  }
})

test('JSON is JSON when it parses, and not when it only starts like it', () => {
  assert.equal(guessLanguage('{\n  "id": 1,\n  "tags": ["a"]\n}'), 'json')
  assert.equal(guessLanguage('  [1, 2, 3]'), 'json')
  assert.notEqual(guessLanguage('{"id": }'), 'json')
  assert.equal(guessLanguage('[1, 2'), undefined)
})

test('a word, a number, nothing and prose are left to be drawn plain', () => {
  for (const text of ['', ' ', 'hello', '42', 'Total: 5', 'The order is placed.', 'v1.4.2']) assert.equal(guessLanguage(text), undefined, JSON.stringify(text))
})

test('a few unmistakable lines are named', () => {
  assert.equal(guessLanguage('FROM node:22-alpine\nWORKDIR /app\nCOPY . .'), 'dockerfile')
  assert.equal(guessLanguage('SELECT id, total FROM orders WHERE status = \'placed\''), 'sql')
  assert.equal(guessLanguage('<?xml version="1.0"?>\n<Project Sdk="Microsoft.NET.Sdk"></Project>'), 'xml')
  assert.equal(guessLanguage('<!DOCTYPE html>\n<html><body><p>Hi</p></body></html>'), 'html')
  assert.equal(guessLanguage('#!/usr/bin/env bash\nset -e\necho "done"'), 'bash')
  assert.equal(guessLanguage('#include <stdio.h>\nint main(void) { return 0; }'), 'c')
  assert.equal(guessLanguage('#include <iostream>\nint main() { std::cout << "hi"; }'), 'cpp')
  assert.equal(guessLanguage('def fee(km):\n    return 2 + km * 0.5\n'), 'python')
})

test('the C# cue table is the one written from this table', async () => {
  const file = await readFile(new URL('../desktop/Flowy.Core/DetectData.cs', import.meta.url), 'utf8')
  assert.equal(file.replace(/\r\n/g, '\n'), renderDetectData(), 'run: node desktop/tools/make-detect-data.ts')
})

test('the copy of highlight.js the desktop app runs is the one built from the canvas grammars', async () => {
  const file = await readFile(new URL('../desktop/Flowy.App/Assets/hljs.js', import.meta.url), 'utf8')
  assert.equal(file.replace(/\r\n/g, '\n'), await renderHljsBundle(), 'run: node desktop/tools/make-hljs-bundle.ts')
})
