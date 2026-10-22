import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// The project's UI text rules allow no en or em dash in anything a person reads.
test('the Failures tab\'s text has no en or em dash', async () => {
  for (const file of ['Failures.tsx', 'FailuresEdit.tsx', 'failuresview.ts']) {
    const text = await readFile(new URL(`../ui/src/${file}`, import.meta.url), 'utf8')
    const lines = text.split(/\r?\n/).flatMap((line, i) => (/[–—]/.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []))
    assert.deepEqual(lines, [])
  }
})
