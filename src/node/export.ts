import { cp, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ParseError } from '../core/model.ts'
import { STATE_ELEMENT } from '../core/state.ts'
import type { State } from '../core/state.ts'
import { loadState } from './files.ts'

/** How an exported page's state starts. It also tells an earlier export from someone else's page. */
const OPEN = `<script type="application/json" id="${STATE_ELEMENT}">`

/**
 * The page with the state in it, as JSON in a script element just before </head>. Every `<` is written
 * as \u003c, so no text in the model can end the element early.
 */
export function inlineState(html: string, state: State): string {
  const at = html.indexOf('</head>')
  if (at === -1) throw new Error('The built index.html has no </head>.')
  const json = JSON.stringify(state).replace(/</g, '\\u003c')
  return `${html.slice(0, at)}${OPEN}${json}</script>\n${html.slice(at)}`
}

/** Whether `child` is `parent` or inside it. Real paths are compared, so a link or a short name can't hide it. */
async function within(child: string, parent: string): Promise<boolean> {
  // ponytail: a folder that doesn't exist yet is compared as written, so a link in its parents slips past. It can't
  // hold the model then, but it can land inside dist/ui; resolve its deepest existing parent if that ever matters.
  const real = (p: string) => realpath(p).catch(() => resolve(p))
  const rel = relative(await real(parent), await real(child))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/**
 * Write a read-only copy of the canvas to `out`: the built canvas in `ui`, with the flowy/ folder `dir`
 * inlined. `out` must be missing, empty (hidden files like .git don't count), or an earlier export. Only
 * what the canvas brings is replaced, so files added next to it (a .git, a CNAME) stay. Throws ParseError
 * when a file can't be read, and writes nothing then.
 */
export async function exportSite({ dir, ui, out }: { dir: string; ui: string; out: string }) {
  if (await within(dir, out)) throw new Error(`${out} holds the flowy folder, so it can't take an export. Pick another --out.`)
  if ((await within(out, ui)) || (await within(ui, out))) throw new Error(`${out} overlaps the built canvas in ${ui}. Pick another --out.`)
  const state = await loadState(dir)
  if ('parseError' in state) {
    const { file, line, message } = state.parseError
    throw new ParseError(file, message, line)
  }
  // loadDir reads a missing folder as an empty model, which is right for the canvas but would put an empty site over a real one.
  if (Object.values(state.versions).every(v => v === null)) throw new Error(`${dir} has no model.yaml or flows. Pick the flowy folder with --dir.`)
  const html = await readFile(join(ui, 'index.html'), 'utf8').catch((e: NodeJS.ErrnoException) => {
    throw e.code === 'ENOENT' ? new Error('The canvas is not built yet. Run: npm run build:ui') : e
  })
  const page = inlineState(html, state)
  const entries = await readdir(out).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return []
    if (e.code === 'ENOTDIR') throw new Error(`${out} is a file. Pick a folder with --out.`)
    throw e
  })
  if (entries.some(name => !name.startsWith('.'))) {
    const earlier = await readFile(join(out, 'index.html'), 'utf8').catch(() => '')
    if (!earlier.includes(OPEN)) throw new Error(`${out} has other files in it. Pick a new or empty folder, or an earlier export, with --out.`)
  }
  // The page goes first, so an export that stops part-way still looks like one and can simply run again.
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'index.html'), page)
  for (const name of await readdir(ui)) {
    if (name === 'index.html') continue
    await rm(join(out, name), { recursive: true, force: true })
    await cp(join(ui, name), join(out, name), { recursive: true })
  }
  return { boxes: Object.keys(state.model.objects).length, flows: Object.keys(state.flows).length, problems: state.problems.length }
}
