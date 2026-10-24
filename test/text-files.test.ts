import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

// git calls a file with a NUL byte or a lone CR binary, and GitHub then shows no diff or blame for it.
test('tracked source and docs are stored as text with LF line ends', () => {
  const rows = execFileSync('git', ['ls-files', '--eol', '--', '*.ts', '*.tsx', '*.cs', '*.axaml', '*.css', '*.md', '*.yaml', '*.json', '*.mjs'], {
    cwd: import.meta.dirname, encoding: 'utf-8',
  })
  const wrong = rows.split('\n').filter(row => row !== '' && !/^i\/(lf|none) /.test(row)).map(row => row.split('\t')[1])
  assert.deepEqual(wrong, [])
})
