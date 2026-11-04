/**
 * Draws the two pictures of the connection kinds guide (docs/guide/kinds.md) from the same primitives the canvas draws with (src/core/kinds.ts and heads.ts), so they cannot
 * drift from it: `connection-kinds.svg` (each kind with its name and the word that picks it) and `connection-marks.svg` (each mark with its name).
 *
 *     node docs/images/kinds-svg.ts
 *
 * Retake them when a kind, a mark or a colour changes. `test/kinds-svg.test.ts` fails when a committed file is not what this makes. Each file follows the system's light or dark theme
 * with the same colours as the app's stylesheet.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { headMatrix } from '../../src/core/heads.ts'
import { DASHES, KIND_IDS, KINDS, MARKS, PLAIN_LOOK, PLAIN_NAME, markPath, markStroke } from '../../src/core/kinds.ts'
import type { LineLook, MarkShape, Pattern } from '../../src/core/kinds.ts'

/** The colours of the sheet: the stylesheet's tokens, light and dark. */
export const SHEET_COLOURS = {
  light: { bg: '#fafaf9', fg: '#1c1917', muted: '#78716c', line: '#d6d3d1', edge: '#78716c' },
  dark: { bg: '#1c1917', fg: '#f5f5f4', muted: '#a8a29e', line: '#57534e', edge: '#78716c' },
} as const

const ROW = 34
const PAD = 12
const SWATCH_FROM = 22
const SWATCH_TO = 118

const style = (): string => {
  const vars = (c: Record<string, string>) => `--bg:${c.bg};--fg:${c.fg};--muted:${c.muted};--line:${c.line};--edge:${c.edge}`
  return [
    `:root{${vars(SHEET_COLOURS.light)}}`,
    `@media (prefers-color-scheme:dark){:root{${vars(SHEET_COLOURS.dark)}}}`,
    '.sheet{fill:var(--bg);stroke:var(--line)}',
    '.stroke-line{stroke:var(--edge);stroke-width:1.5;fill:none}',
    '.fill{fill:var(--edge);stroke:none}',
    '.stroke{fill:none;stroke:var(--edge);stroke-linecap:round;stroke-linejoin:round}',
    '.hollow{fill:var(--bg);stroke:var(--edge);stroke-linecap:round;stroke-linejoin:round}',
    '.name{fill:var(--fg);font:14px system-ui,sans-serif}',
    '.word{fill:var(--muted);font:13px ui-monospace,Consolas,monospace}',
  ].join('\n')
}

const mark = (shape: MarkShape, x: number, dx: number, y: number): string => {
  const paint = MARKS[shape].paint
  const width = markStroke(shape)
  return `<path class="${paint === 'fill' ? 'fill' : paint === 'stroke' ? 'stroke' : 'hollow'}" d="${markPath(shape)}"${width === 0 ? '' : ` stroke-width="${width}"`} transform="matrix(${headMatrix({ x, y }, { x: dx, y: 0 }).join(' ')})"/>`
}

/** One line drawn small, as the key at the canvas foot draws it: its pattern, a head on the right end and a tail on the left, each only when asked for. */
function swatch(y: number, pattern: Pattern, head: LineLook['head'] | undefined, tail: LineLook['tail']): string {
  const dash = DASHES[pattern]
  const parts = [`<line class="stroke-line" x1="${SWATCH_FROM}" y1="${y}" x2="${SWATCH_TO}" y2="${y}"${dash.length === 0 ? '' : ` stroke-dasharray="${dash.join(' ')}"`}/>`]
  if (tail !== 'none') parts.push(mark(tail, SWATCH_FROM, -1, y))
  if (head !== undefined) parts.push(mark(head, SWATCH_TO, 1, y))
  return parts.join('')
}

type Row = { swatch: (y: number) => string; name: string; word?: string }

function sheet(rows: Row[], width: number, wordAt: number, label: string): string {
  const height = PAD * 2 + rows.length * ROW
  const body = rows.map((row, i) => {
    const y = PAD + i * ROW + ROW / 2
    return `<g>${row.swatch(y)}<text class="name" x="140" y="${y}" dominant-baseline="central">${row.name}</text>${row.word === undefined ? '' : `<text class="word" x="${wordAt}" y="${y}" dominant-baseline="central">${row.word}</text>`}</g>`
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}">`,
    `<style>\n${style()}\n</style>`,
    `<rect class="sheet" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10"/>`,
    ...body,
    '</svg>',
    '',
  ].join('\n')
}

/** Each kind with its name and the word that picks it, then the plain line. */
export function kindsSvg(): string {
  const rows: Row[] = KIND_IDS.map(id => ({ swatch: y => swatch(y, KINDS[id].look.pattern, KINDS[id].look.head, KINDS[id].look.tail), name: KINDS[id].name, word: `kind: ${id}` }))
  rows.push({ swatch: y => swatch(y, PLAIN_LOOK.pattern, PLAIN_LOOK.head, PLAIN_LOOK.tail), name: PLAIN_NAME, word: 'no kind' })
  return sheet(rows, 460, 330, 'The six connection kinds and the plain line, each drawn as the canvas draws it, with its name and the kind word that picks it')
}

/** The names of the marks, as the guide says them. */
export const MARK_NAMES = [
  { shape: 'filled', name: 'Sender waits' },
  { shape: 'open', name: 'Just arrives' },
  { shape: 'open', name: 'Answer returns' },
  { shape: 'double', name: 'Answers keep coming' },
  { shape: 'ring', name: 'Keeps last value' },
  { shape: 'diamond', name: 'Holds an object' },
  { shape: 'dashdot', name: 'Plugs in' },
] as const

/** Each mark alone on a plain line: the two heads at the receiving end, the four tails at the sending end, and the dash-dot pattern. */
export function marksSvg(): string {
  const rows: Row[] = MARK_NAMES.map((m, i) => ({
    name: m.name,
    swatch: y => (m.shape === 'dashdot' ? swatch(y, 'dashdot', undefined, 'none') : i < 2 ? swatch(y, 'solid', m.shape as 'filled' | 'open', 'none') : swatch(y, 'solid', undefined, m.shape as 'open' | 'double' | 'ring' | 'diamond')),
  }))
  return sheet(rows, 340, 0, 'The marks on the ends of a connection and the dash-dot pattern, each drawn alone with its name')
}

export const FILES = { 'connection-kinds.svg': kindsSvg, 'connection-marks.svg': marksSvg } as const

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, make] of Object.entries(FILES)) writeFileSync(join(import.meta.dirname, file), make())
}
