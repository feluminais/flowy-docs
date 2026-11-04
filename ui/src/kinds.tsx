import { DASHES, KINDS, MARKS, PLAIN_LOOK, PLAIN_NAME, markPath } from '../../src/core/kinds.ts'
import type { KindId, LineLook, MarkShape } from '../../src/core/kinds.ts'
import { HEAD_PATH, headMatrix } from '../../src/core/heads.ts'
import type { Point } from '../../src/core/heads.ts'
import { HAIRLINE_GAP, LANE_KEY } from '../../src/core/lanes.ts'
import { marksOf } from './kindkey.ts'
import { KeyItem, KeyRow } from './legend.tsx'

/**
 * How the browser draws a connection's kind. The pattern and the marks come from src/core/kinds.ts; the colours are the stylesheet's (`.kmark`), so a drawing here
 * follows the light and dark theme and a line on the canvas takes the colour of its state.
 */

/** A mark's `<path>` as it sits at `at` pointing along `dir` (the unit vector out of the line there), at `scale`: the marks of the canvas and of every swatch are this. */
export function MarkPath({ shape, at, dir, scale = 1, hot }: { shape: MarkShape; at: Point; dir: Point; scale?: number; hot?: boolean }) {
  const mark = MARKS[shape]
  const className = `kmark ${mark.paint === 'fill' ? 'fill' : mark.paint === 'stroke' ? 'stroke' : 'hollow'}${hot ? ' hot' : ''}`
  return <path className={className} d={markPath(shape)} strokeWidth={mark.width === 0 ? undefined : mark.width} transform={`matrix(${headMatrix(at, dir, scale).join(' ')})`} />
}

/**
 * A line drawn small with its pattern and its marks, as the canvas draws it (`marksOf`): a key's swatch, the tile of the kind picker, the mark beside a connection in a panel.
 * `both` is a line that carries connections both ways: a head at each end and no tail, as on the canvas.
 * Decorative (`aria-hidden`); the name beside it is the meaning.
 */
export function LookSwatch({ look, width = 56, height = 18, className, both = false }: { look: LineLook | undefined; width?: number; height?: number; className?: string; both?: boolean }) {
  const l = look ?? PLAIN_LOOK
  const [x0, x1, y] = [3, width - 3, height / 2]
  const dash = DASHES[l.pattern]
  const { head, headAtStart, tail } = marksOf(look, both)
  const headAt = (x: number, dx: number) => head === 'filled'
    ? <path className="kmark fill" d={HEAD_PATH} transform={`matrix(${headMatrix({ x, y }, { x: dx, y: 0 }).join(' ')})`} />
    : <MarkPath shape={head} at={{ x, y }} dir={{ x: dx, y: 0 }} />
  return (
    <svg className={className ? `look-swatch ${className}` : 'look-swatch'} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <line className="look-line" x1={x0} y1={y} x2={x1} y2={y} strokeDasharray={dash.length === 0 ? undefined : dash.join(' ')} />
      {tail && <MarkPath shape={tail} at={{ x: x0, y }} dir={{ x: -1, y: 0 }} />}
      {headAt(x1, 1)}
      {headAtStart && headAt(x0, -1)}
    </svg>
  )
}

/** The number of connections a trunk holds, on a chip on the middle of its line. It is part of the line (it fades with it and takes its colour) and takes no clicks. */
export function TrunkChip({ size, at }: { size: number; at: Point }) {
  const width = Math.max(CHIP_HEIGHT, 8 + 6 * String(size).length)
  return (
    <g className="trunk-chip" aria-hidden="true" transform={`translate(${at.x} ${at.y})`}>
      <rect x={-width / 2} y={-CHIP_HEIGHT / 2} width={width} height={CHIP_HEIGHT} rx={CHIP_HEIGHT / 2} />
      <text textAnchor="middle" dominantBaseline="central">{size}</text>
    </g>
  )
}

/** How tall the chip of a trunk is (and the least it is wide). */
export const CHIP_HEIGHT = 16

/** A lane a step plays on, as the canvas draws it: in the accent colour, a little thicker, with its head. */
function InUseSwatch() {
  return <LookSwatch look={undefined} className="in-use" />
}

/** A trunk as the canvas draws it: a line with two hairlines behind it and the chip with a number on its middle. */
function StackedSwatch() {
  const [width, height, y] = [56, 22, 7]
  return (
    <svg className="look-swatch" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {[1, 2].map(k => <line key={k} className="trunk-hair" x1={3} y1={y + HAIRLINE_GAP * k} x2={width - 3} y2={y + HAIRLINE_GAP * k} />)}
      <line className="look-line" x1={3} y1={y} x2={width - 3} y2={y} />
      <path className="kmark fill" d={HEAD_PATH} transform={`matrix(${headMatrix({ x: width - 3, y }, { x: 1, y: 0 }).join(' ')})`} />
      <TrunkChip size={3} at={{ x: width / 2, y }} />
    </svg>
  )
}

/**
 * The key of the lines on the canvas, at its foot: one swatch and name for each kind drawn now, in the order of the list, and the plain line when one is drawn too; then, where the
 * canvas draws them, a trunk (`stacked`: "Stacked lines") and a lane a step plays on among others (`inUse`: "In use"). Nothing when there is none of these. With a flow's card at the
 * foot of the canvas (`underPlayer`) the key keeps to the space left of it.
 */
export function KindKey({ kinds, plain, stacked = false, inUse = false, underPlayer }: { kinds: readonly KindId[]; plain: boolean; stacked?: boolean; inUse?: boolean; underPlayer?: boolean }) {
  if (kinds.length === 0 && !stacked && !inUse) return null
  return (
    <div className={underPlayer ? 'kind-key beside-player' : 'kind-key'}>
      <KeyRow>
        {kinds.map(id => <KeyItem key={id} swatch={<LookSwatch look={KINDS[id].look} />}>{KINDS[id].name}</KeyItem>)}
        {plain && kinds.length > 0 && <KeyItem swatch={<LookSwatch look={PLAIN_LOOK} />}>{PLAIN_NAME}</KeyItem>}
        {stacked && <KeyItem swatch={<StackedSwatch />}>{LANE_KEY.stacked}</KeyItem>}
        {inUse && <KeyItem swatch={<InUseSwatch />}>{LANE_KEY.inUse}</KeyItem>}
      </KeyRow>
    </div>
  )
}
