/**
 * What a reader is told about a stop: the words on the card and on the canvas, and where the stop sits in the progress bar.
 * They are decided here once, so the browser and the desktop app say the same things. Nothing here draws.
 * desktop/Flowy.Core/Captions.cs is a port, and desktop/fixtures/structure.ts keeps the two equal.
 */
import type { Flow } from './model.ts'
import { groupOf } from './structure.ts'
import type { GroupKind, Stop } from './structure.ts'

/**
 * `chip` is the card's words for the group ("" outside one); `text` is the group's own `text`. A branch lists its lanes as `tabs`
 * and says which this stop is in (`tab`, -1 elsewhere). A parallel stop names the lane of each of its steps in `lanes`. `marks` has
 * one short mark for each step of the stop, drawn on its line ("" for none). No glyphs: each reader adds its own icon.
 */
export type Caption = { chip: string; text: string; tabs: string[]; tab: number; lanes: string[]; marks: string[] }

/**
 * What each thing on the card means, in plain words: the legend the card opens. `kind` gives the row its group icon; the bar and the
 * label on a line have none. The wording is here so the browser and the desktop app tell it the same way.
 */
export type LegendRow = { kind: GroupKind | null; title: string; text: string }

export const LEGEND: LegendRow[] = [
  { kind: 'repeat', title: 'Repeat', text: 'The same steps again. A solid line is a set number of times, a dashed one can stop sooner. The chip says how many times, or what stops it.' },
  { kind: 'branch', title: 'Branch', text: 'Only one lane happens. Each row of the bar is a lane, named for what decides it. The lanes you are not in are hollow on the bar and dashed on the canvas.' },
  { kind: 'parallel', title: 'Same time', text: "Lanes that run together. Each stop lights the next step of every lane." },
  { kind: null, title: 'The bar', text: 'One cell for each stop, and a row for each lane of a branch. A box holds the stops of each group, and the line under it says what the group is. Point at one for more.' },
  { kind: null, title: 'The label on a line', text: 'Which lane, or which repeat, the step is in.' },
]

/**
 * What a repeat does, in words. `times` alone is a rule: "3 times". With `until` it is a limit that may not be reached: "up to 3 times,
 * until it works". `until` alone is "until it works", and "" says neither. A heading that starts the line asks for `capital`.
 */
export function repeatWords(g: { times?: string; until?: string } | undefined, capital = false): string {
  const times = g?.times === undefined ? '' : g.until === undefined ? `${g.times} times` : `up to ${g.times} times`
  const words = [times, g?.until === undefined ? '' : `until ${g.until}`].filter(w => w !== '').join(', ')
  return capital ? words.charAt(0).toUpperCase() + words.slice(1) : words
}

export function captionOf(flow: Flow, stop: Stop): Caption {
  const none: Caption = { chip: '', text: '', tabs: [], tab: -1, lanes: [], marks: stop.steps.map(() => '') }
  if (stop.group === undefined || stop.kind === undefined) return none
  const g = groupOf(flow, stop.group)
  const text = g?.text ?? ''
  const labels = stop.laneLabels ?? []
  const laneOf = (i: number): string => labels[stop.lanes?.[i] ?? -1] ?? ''
  if (stop.kind === 'repeat') {
    const times = g?.times ?? ''
    const until = g?.until ?? ''
    const words = repeatWords(g)
    const mark = times !== '' ? (until !== '' ? `up to ${times}` : `×${times}`) : until !== '' ? `until ${until}` : ''
    return { ...none, chip: words === '' ? 'Repeats' : `Repeats ${words}`, text, marks: stop.steps.map(() => mark) }
  }
  if (stop.kind === 'branch') {
    return { ...none, chip: labels.length > 1 ? `One of ${labels.length}` : 'Only if', text, tabs: labels, tab: stop.lanes?.[0] ?? -1, marks: stop.steps.map((_, i) => laneOf(i)) }
  }
  const lanes = stop.steps.map((_, i) => laneOf(i))
  return { ...none, chip: labels.length > 1 ? `At the same time, ${labels.length} lanes` : 'At the same time', text, lanes, marks: lanes }
}

/**
 * The progress bar: a cell for each stop, in `col` and `row`, and a bracket for each group over the columns it covers. A `title` is what a
 * reader sees on hovering a cell (the lane it is in) or a bracket (what the group means). A cell's `group` is the bracket that holds it, -1
 * for none, so a reader can box a group's cells. A branch bracket names its rows in `lanes`, and says nothing in `text`: the names are
 * its words. A repeat is `maybe` when it can stop before its last time (it has an `until`), so a reader draws its line dashed. Most stops take the next
 * column on row 0. The lanes of a branch start in the same column and sit on rows of their own, each lane's stops in the columns after it,
 * and what follows the branch starts after its longest lane. `rows` is the most any branch needs, and at least 1.
 */
export type Progress = {
  cols: number
  rows: number
  cells: { stop: number; col: number; row: number; title: string; group: number }[]
  brackets: { kind: GroupKind; from: number; to: number; text: string; title: string; lanes: string[]; maybe: boolean }[]
}

export function progressOf(flow: Flow, stops: Stop[]): Progress {
  const cells: Progress['cells'] = []
  const brackets: Progress['brackets'] = []
  let col = 0
  let rows = 1
  for (let k = 0; k < stops.length;) {
    const s = stops[k]
    if (s.group === undefined || s.kind === undefined) {
      cells.push({ stop: k, col: col++, row: 0, title: '', group: -1 })
      k++
      continue
    }
    let end = k
    while (end + 1 < stops.length && stops[end + 1].group === s.group) end++
    const start = col
    const group = brackets.length
    if (s.kind === 'branch') {
      const lanes = s.laneLabels?.length ?? 1
      const used: number[] = []
      for (let j = k; j <= end; j++) {
        const lane = stops[j].lanes?.[0] ?? 0
        const at = used[lane] ?? 0
        cells.push({ stop: j, col: start + at, row: lane, title: s.laneLabels?.[lane] ?? '', group })
        used[lane] = at + 1
      }
      const longest = Math.max(1, ...used.map(n => n ?? 0))
      rows = Math.max(rows, lanes)
      const only = s.laneLabels?.[0] ?? ''
      brackets.push({
        kind: 'branch', from: start, to: start + longest - 1,
        text: '',
        title: lanes > 1 ? 'Alternatives: only one of these lanes happens' : only === '' ? 'Happens only sometimes' : `Happens only if: ${only}`,
        lanes: s.laneLabels ?? [], maybe: false,
      })
      col = start + longest
    } else {
      for (let j = k; j <= end; j++) cells.push({ stop: j, col: col++, row: 0, title: stops[j].lanes?.map(l => s.laneLabels?.[l] ?? '').join(' + ') ?? '', group })
      const g = groupOf(flow, s.group)
      const times = g?.times ?? ''
      const maybe = g?.until !== undefined
      const words = repeatWords(g)
      brackets.push(s.kind === 'repeat'
        ? { kind: s.kind, from: start, to: col - 1, text: times === '' ? '' : maybe ? `up to ${times}` : `×${times}`, title: words === '' ? 'Repeats' : `Repeats ${words}`, lanes: [], maybe }
        : { kind: s.kind, from: start, to: col - 1, text: 'same time', title: 'The lanes happen at the same time: each stop shows the next step of every lane', lanes: [], maybe: false })
    }
    k = end + 1
  }
  return { cols: col, rows, cells, brackets }
}
