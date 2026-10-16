import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ParseError } from '../core/model.ts'
import { STATE_ELEMENT } from '../core/state.ts'
import type { State } from '../core/state.ts'
import { loadState } from './files.ts'

const MARK = `id="${STATE_ELEMENT}"`

/**
 * The page with the state in it, as JSON in a script element just before </head>. Every `<` is written
 * as <, so no text in the model can end the element early.
 */
export function inlineState(html: string, state: State): string {
  const at = html.indexOf('</head>')
  if (at === -1) throw new Error('index.html has no </head>')
  const json = JSON.stringify(state).replace(/</g, '\\u003c')
  return `${html.slice(0, at)}<script type="application/json" ${MARK}>${json}</script>\n${html.slice(at)}`
}

/** Whether `child` is `parent` or somewhere inside it. */
function within(child: string, parent: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Write a read-only copy of the canvas to `out`: the built canvas in `ui`, with the flowy/ folder `dir`
 * inlined. `out` must be missing, empty, or an earlier export, which is replaced. Throws ParseError when
 * a file can't be read, and writes nothing then.
 */
export async function exportSite({ dir, ui, out }: { dir: string; ui: string; out: string }) {
  const state = await loadState(dir)
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    throw new ParseError(file, message, line)
  }
  const html = await readFile(join(ui, 'index.html'), 'utf8').catch(() => {
    throw new Error('The canvas is not built yet. Run: npm run build:ui')
  })
  const page = inlineState(html, state)
  if (within(resolve(dir), resolve(out))) throw new Error(`${out} holds the flowy folder, so it can't take an export. Pick another --out.`)
  const entries = await readdir(out).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return []
    throw e
  })
  if (entries.length > 0) {
    const earlier = await readFile(join(out, 'index.html'), 'utf8').catch(() => '')
    if (!earlier.includes(MARK)) throw new Error(`${out} has other files in it. Pick a new or empty folder with --out.`)
    await rm(out, { recursive: true, force: true })
  }
  await cp(ui, out, { recursive: true })
  await writeFile(join(out, 'index.html'), page)
  return { boxes: Object.keys(state.model.objects).length, flows: Object.keys(state.flows).length, problems: state.problems.length }
}
