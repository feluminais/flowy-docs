import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeLists, codePaths, codeProblems, codeRefsOf, codeText, MAX_CODE_LINE, readCodeRef } from '../../src/core/code.ts'
import { modelOf } from '../../src/core/state.ts'
import { loadState } from '../../src/node/files.ts'

// How an entry of a `code` list reads (a path, or a file and a line) and what is wrong with a list. The C# tests read the same cases (CodeRefsTests).

const root = fileURLToPath(new URL('../../', import.meta.url))

/** Entries, in the order the C# test reports a failure in. The ones that end in "gone" don't exist. */
const ENTRIES = [
  'src/api.ts', 'src/api.ts:1', 'src/api.ts:42', `src/api.ts:${MAX_CODE_LINE}`, `src/api.ts:${MAX_CODE_LINE + 1}`, 'src/api.ts:0', 'src/api.ts:007', 'src/api.ts:-3',
  'src/', 'src/:3', 'src:3', 'a:b.ts', 'a:b.ts:4', 'src/api.ts:4:2', '../x.ts:3', '/abs.ts:3', 'C:/x.ts', 'a\\b.ts:2', 'a\nb.ts:2', 'a\u2028b.ts:2', ':3', 'gone.ts:9', 'gone/',
  '', ' src/api.ts', 'src/api.ts ', 'x.ts:1e3', 'x.ts:٣', 'x.ts:１',
]

const LISTS: unknown[] = [undefined, 'src/api.ts', ['src/api.ts', 3], [], ENTRIES]

export async function dumpCode() {
  const model = modelOf(await loadStateOrThrow())
  const gone = new Set(['gone.ts', 'gone/'])
  return {
    max: MAX_CODE_LINE,
    entries: ENTRIES.map(entry => ({ entry, ref: readCodeRef(entry) ?? null, text: readCodeRef(entry) ? codeText(readCodeRef(entry)!) : null, problems: codeProblems([entry], gone) })),
    lists: LISTS.map(code => ({ code: code === undefined ? '(none)' : code, refs: codeRefsOf(code), problems: codeProblems(code, gone) })),
    model: { lists: codeLists(model).length, paths: codePaths(model).sort() },
  }
}

async function loadStateOrThrow() {
  const state = await loadState(join(root, 'desktop/fixtures/cases/links/flowy'))
  if ('parseError' in state) throw new Error("the links case can't be read")
  return state
}
